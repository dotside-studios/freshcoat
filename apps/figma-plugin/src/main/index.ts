import { showUI } from "@create-figma-plugin/utilities";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import {
	exactSizeCheck,
	fromDesignSize,
} from "~/lib/figma/transpiler/exact-size";
import { rasterScaleFor } from "~/lib/figma/transpiler/raster-scale";
import { colorwayLabel } from "~/lib/figma/transpiler/variants";
import type { FigmaContainerNode } from "~/lib/figma/types";
import {
	handleClearBinding,
	handleHarvest,
	handleSetBinding,
	postFieldsOverview,
	postSelectionDetail,
	slotFrameOf,
} from "~/main/bindings";
import { type CardsView, createCardsPublisher } from "~/main/cards-publisher";
import {
	collectColorways,
	type DiscoInstance,
	type DiscoNode,
	detectCards,
} from "~/main/discovery";
import {
	exportRasters,
	exportThumbnails,
	type RasterTarget,
} from "~/main/export-rasters";
import { findUnpostable } from "~/main/postable";
import {
	applyRemoteProducts,
	getProductSpec,
	listProductSpecs,
} from "~/main/product";
import { collectRasterTargets } from "~/main/raster-targets";
import { readFrameTree } from "~/main/read-scene-graph";
import {
	handleSaveSettings,
	loadSettings,
	postSettings,
} from "~/main/settings";
import type {
	CardsMessage,
	CardView,
	ColorwayRead,
	NodeCandidate,
	ReadDocumentMessage,
	ReadFailedMessage,
	ReadProgressMessage,
	ResizeNodeMessage,
	SlotRead,
	TemplateMode,
	ThumbnailsMessage,
	UiToMain,
} from "~/shared/protocol";

// 2x the thumbnail box in layout.tsx, so previews stay sharp on retina.
const THUMBNAIL_WIDTH = 128;

/** Author units per design unit for a slot, mirroring how the transpiler settles
 *  the canvas: a custom export takes the design's own measurement (so the two
 *  spaces coincide), while a product export pins the canvas to the product's
 *  exact print size, which a design drawn at any other size has to scale into.
 *  An off-size frame fails the transpiler's sizing gate anyway; the suggested
 *  dims keep this from dividing by a size that will never be used. */
function authorScaleOf(
	product: ProductRegistryEntry,
	mode: TemplateMode,
	box: { width: number; height: number },
): number {
	if (box.width <= 0) return 1;
	if (mode === "custom")
		return fromDesignSize(box.width, box.height).width / box.width;
	const checked = exactSizeCheck(box.width, box.height, product);
	const canvasWidth = checked.ok ? checked.width : checked.suggestedWidth;
	return canvasWidth / box.width;
}

function pickDefaultSku(): string {
	return listProductSpecs()[0]?.sku ?? "card_cr80";
}

async function computeCardsView(): Promise<CardsView> {
	const product = getProductSpec(pickDefaultSku());
	const sideNames = product
		? product.frames.map((f) => f.name)
		: ["front", "back"];
	const required = product
		? product.frames.filter((f) => f.required).map((f) => f.name)
		: sideNames;

	const topLevel = figma.currentPage.children.filter(
		(n) => n.type === "FRAME" || n.type === "COMPONENT",
	);
	const nodes: DiscoNode[] = topLevel.map((n) => ({
		id: n.id,
		name: n.name,
		type: n.type,
		children:
			"children" in n
				? n.children.map((c) => ({ id: c.id, name: c.name, type: c.type }))
				: [],
	}));

	const instanceNodes = figma.currentPage.findAllWithCriteria({
		types: ["INSTANCE"],
	});
	const instances: DiscoInstance[] = await Promise.all(
		instanceNodes.map(async (inst) => ({
			id: inst.id,
			name: inst.name,
			mainComponentId: (await inst.getMainComponentAsync())?.id ?? null,
		})),
	);

	const discovered = detectCards(nodes, instances, sideNames, required);
	const nameById = new Map(
		figma.currentPage.children.flatMap((n) =>
			"children" in n ? n.children.map((c) => [c.id, c.name] as const) : [],
		),
	);
	const cards: CardView[] = discovered.map((d) => ({
		id: d.id,
		name: d.name,
		sides: sideNames.map((side) => ({
			side,
			nodeId: d.sides[side] ?? null,
			nodeName: d.sides[side]
				? (nameById.get(d.sides[side] as string) ?? null)
				: null,
		})),
		missingRequired: d.missingRequired,
		colorways: d.colorways,
		unmatchedInstances: d.unmatchedInstances,
		canHaveColorways: d.type === "COMPONENT",
	}));

	// Custom-mode candidates: every top-level frame, no side-slot requirement —
	// the frame itself is the template. Colorways still resolve the same way
	// (INSTANCEs of a COMPONENT named `<Name> / <Label>`).
	const candidates: NodeCandidate[] = topLevel.map((n) => {
		const { colorways, unmatchedInstances } = collectColorways(
			{ id: n.id, name: n.name },
			instances,
		);
		return {
			id: n.id,
			name: n.name,
			width: Math.round(n.width),
			height: Math.round(n.height),
			canHaveColorways: n.type === "COMPONENT",
			colorways,
			unmatchedInstances,
		};
	});

	return { cards, nodes: candidates, pageName: figma.currentPage.name };
}

// The card currently highlighted on the canvas = the selection's top-level
// page-child ancestor, if that ancestor is one of the detected cards.
function selectedIdsIn(view: CardsView): {
	selectedCardId: string | null;
	selectedNodeId: string | null;
} {
	const selNode = figma.currentPage.selection[0] ?? null;
	const selTop = selNode ? slotFrameOf(selNode) : null;
	return {
		selectedCardId:
			selTop && view.cards.some((c) => c.id === selTop.id) ? selTop.id : null,
		selectedNodeId:
			selTop && view.nodes.some((c) => c.id === selTop.id) ? selTop.id : null,
	};
}

const cardsPublisher = createCardsPublisher({
	compute: computeCardsView,
	selected: selectedIdsIn,
	post: (msg: CardsMessage) => figma.ui.postMessage(msg),
});

function postCards(): Promise<void> {
	cardsPublisher.invalidate();
	return cardsPublisher.publish();
}

function postReadFailed(message: string): void {
	const msg: ReadFailedMessage = { type: "read-failed", message };
	figma.ui.postMessage(msg);
}

function postReadProgress(text: string): void {
	const msg: ReadProgressMessage = { type: "read-progress", text };
	figma.ui.postMessage(msg);
}

/** Gather everything the UI needs to transpile. Wrapped by readCardIntoSlots,
 *  which owns telling the UI when this ends badly — every `throw` here reaches
 *  the author as a message rather than a permanent spinner. */
async function gatherRead(
	product: ProductRegistryEntry,
	mode: TemplateMode,
	sideAssignment: Record<string, string>,
	cardId: string,
): Promise<ReadDocumentMessage> {
	const slots: SlotRead[] = [];
	// nodeId → export scale. A node reachable from more than one slot (or from a
	// colorway of one) keeps the largest scale asked for, so no slot ends up with
	// a bitmap coarser than it needs.
	const rasterScales = new Map<string, number>();
	const wantRasters = (ids: string[], scale: number): void => {
		for (const id of ids) {
			rasterScales.set(id, Math.max(rasterScales.get(id) ?? 0, scale));
		}
	};
	// Scale per slot, so a colorway instance's rasters match their base side's.
	const slotRasterScale: Record<string, number> = {};

	const frameNodes = await Promise.all(
		product.frames.map((frame) => {
			const nodeId = sideAssignment[frame.name];
			return nodeId ? figma.getNodeByIdAsync(nodeId) : null;
		}),
	);
	for (const [i, frame] of product.frames.entries()) {
		const node = frameNodes[i];
		if (!node || (node.type !== "FRAME" && node.type !== "COMPONENT")) {
			throw new Error(
				`The frame for "${frame.label}" is no longer on the canvas. Pick it again.`,
			);
		}
		const tree = readFrameTree(node as never);
		slots.push({
			slot: frame.name,
			nodeId: node.id,
			nodeName: node.name,
			width: tree.absoluteBoundingBox.width,
			height: tree.absoluteBoundingBox.height,
			tree,
		});
		const scale = rasterScaleFor(
			authorScaleOf(product, mode, tree.absoluteBoundingBox),
		);
		slotRasterScale[frame.name] = scale;
		wantRasters(collectRasterTargets(tree), scale);
	}

	// Colorways: INSTANCEs of the card, named `<Card> / <Label>`. Read each
	// instance's full per-side subtree — the transpiler diffs it against the base
	// to capture per-element overrides (foreground + background), so its
	// flatten/static-image nodes need rasters pre-exported here too.
	const colorways: ColorwayRead[] = [];
	const card = await figma.getNodeByIdAsync(cardId);
	if (card && card.type === "COMPONENT") {
		const instances = figma.currentPage.findAllWithCriteria({
			types: ["INSTANCE"],
		});
		const mains = await Promise.all(
			instances.map((inst) => inst.getMainComponentAsync()),
		);
		for (const [i, inst] of instances.entries()) {
			if (mains[i]?.id !== cardId) continue;
			const label = colorwayLabel(inst.name, card.name);
			if (label === null) continue;
			const perSide: Record<string, FigmaContainerNode> = {};
			let complete = true;
			for (const frame of product.frames) {
				// In custom mode the card has no side children — the instance IS the
				// single frame, so it stands in for the slot directly.
				const child =
					mode === "custom"
						? inst
						: "children" in inst
							? inst.children.find(
									(c) =>
										c.name.trim().toLowerCase() === frame.name.toLowerCase(),
								)
							: undefined;
				if (!child) {
					complete = false;
					break;
				}
				perSide[frame.name] = readFrameTree(child as never);
			}
			if (complete) {
				colorways.push({ instanceId: inst.id, label, perSide });
				for (const [slotName, side] of Object.entries(perSide)) {
					wantRasters(
						collectRasterTargets(side),
						slotRasterScale[slotName] ?? rasterScaleFor(1),
					);
				}
			}
		}
	}

	const targets: RasterTarget[] = [...rasterScales].map(([nodeId, scale]) => ({
		nodeId,
		scale,
	}));
	const rasters = await exportRasters(targets, (done, total) => {
		postReadProgress(`Rasterizing layer ${done} of ${total}…`);
	});
	return { type: "read-document", product, mode, slots, colorways, rasters };
}

async function readCardIntoSlots(
	product: ProductRegistryEntry,
	mode: TemplateMode,
	sideAssignment: Record<string, string>,
	cardId: string,
): Promise<void> {
	try {
		const msg = await gatherRead(product, mode, sideAssignment, cardId);
		try {
			figma.ui.postMessage(msg);
		} catch (err) {
			// Figma names neither the property nor the node when it refuses a
			// payload, so locate the offending value before giving up.
			const where = findUnpostable(msg);
			throw new Error(
				where
					? `Could not send the design to the panel — unsupported value at ${where}.`
					: `Could not send the design to the panel: ${(err as Error).message}`,
			);
		}
	} catch (err) {
		const message = (err as Error)?.message ?? "Could not read the document.";
		figma.notify(message);
		postReadFailed(message);
	}
}

async function postThumbnails(nodeIds: string[]): Promise<void> {
	if (nodeIds.length === 0) return;
	const msg: ThumbnailsMessage = {
		type: "thumbnails",
		items: await exportThumbnails(nodeIds, THUMBNAIL_WIDTH),
	};
	figma.ui.postMessage(msg);
}

// Resize a slot frame to the export's canvas. Figma re-flows children per their
// constraints, same as dragging the frame handle — which is the point: the
// author sees the consequence immediately rather than getting a silently
// stretched export.
async function handleResize(msg: ResizeNodeMessage): Promise<void> {
	const node = await figma.getNodeByIdAsync(msg.nodeId);
	if (!node || !("resize" in node)) {
		figma.notify("That frame is no longer on the canvas.");
		return;
	}
	try {
		(node as FrameNode).resize(msg.width, msg.height);
	} catch (err) {
		figma.notify(`Could not resize "${node.name}": ${(err as Error).message}`);
		return;
	}
	figma.notify(`Resized "${node.name}" to ${msg.width}×${msg.height}.`);
	void postCards();
	// The frame just changed shape, so the UI's cached preview of it is wrong.
	// Push a fresh one unprompted rather than waiting to be asked.
	void postThumbnails([msg.nodeId]);
}

async function handleFocus(nodeId: string): Promise<void> {
	const node = await figma.getNodeByIdAsync(nodeId);
	if (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
		const scene = node as SceneNode;
		figma.currentPage.selection = [scene];
		figma.viewport.scrollAndZoomIntoView([scene]);
	}
}

export default async function (): Promise<void> {
	// Size the window from storage BEFORE showing it — resizing after paint
	// makes the panel visibly jump on every open.
	const stored = await loadSettings();
	showUI({ width: stored.windowWidth, height: stored.windowHeight });

	postSettings();
	void postCards();
	postSelectionDetail();
	postFieldsOverview();

	// documentchange would need loadAllPagesAsync under dynamic-page access, so
	// invalidate from the current page's nodechange instead.
	let watchedPage = figma.currentPage;
	const invalidateCards = (): void => cardsPublisher.invalidate();
	watchedPage.on("nodechange", invalidateCards);

	figma.on("selectionchange", () => {
		cardsPublisher.schedule();
		postSelectionDetail();
	});
	figma.on("currentpagechange", () => {
		watchedPage.off("nodechange", invalidateCards);
		watchedPage = figma.currentPage;
		watchedPage.on("nodechange", invalidateCards);
		void postCards();
		postSelectionDetail();
		postFieldsOverview();
	});

	figma.ui.onmessage = (msg: UiToMain) => {
		switch (msg.type) {
			case "request-read":
				void readCardIntoSlots(
					msg.product,
					msg.mode,
					msg.sideAssignment,
					msg.cardId,
				);
				return;
			case "harvest":
				void handleHarvest(msg.product, msg.sideAssignment, msg.cardId);
				return;
			case "set-binding":
				void handleSetBinding(msg);
				return;
			case "clear-binding":
				void handleClearBinding(msg);
				return;
			case "focus-node":
				void handleFocus(msg.nodeId);
				return;
			case "resize-node":
				void handleResize(msg);
				return;
			case "request-fields":
				postFieldsOverview();
				return;
			case "request-thumbnails":
				void postThumbnails(msg.nodeIds);
				return;
			case "resize-window":
				figma.ui.resize(msg.width, msg.height);
				return;
			case "save-settings":
				void handleSaveSettings(msg.settings);
				return;
			case "request-settings":
				postSettings();
				return;
			case "open-external":
				if (/^https?:\/\//.test(msg.url)) figma.openExternal(msg.url);
				return;
			case "products-loaded":
				// The UI fetched the live catalog; overlay it so card detection and
				// reads use the same SKUs/frames, then re-post cards with the new specs.
				applyRemoteProducts(msg.products);
				void postCards();
				return;
			default: {
				const unhandled: never = msg;
				return unhandled;
			}
		}
	};
}
