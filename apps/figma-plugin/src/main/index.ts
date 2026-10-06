import {
	loadSettingsAsync,
	saveSettingsAsync,
	showUI,
} from "@create-figma-plugin/utilities";
import {
	bindableProperties,
	buildFieldMeta,
	extractTokens,
	type FieldMeta,
	inferNodeBinding,
	storedToNodeBinding,
} from "~/lib/figma/binding";
import {
	planHarvest,
	renameInMarker,
	type SlotHarvestInput,
} from "~/lib/figma/harvest";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import {
	exactSizeCheck,
	fromDesignSize,
} from "~/lib/figma/transpiler/exact-size";
import { rasterScaleFor } from "~/lib/figma/transpiler/raster-scale";
import { colorwayLabel } from "~/lib/figma/transpiler/variants";
import type { FigmaContainerNode } from "~/lib/figma/types";
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
import { FIELD_KEY, FIELDS_KEY, readPluginData } from "~/main/plugin-data";
import { findUnpostable } from "~/main/postable";
import {
	applyRemoteProducts,
	getProductSpec,
	listProductSpecs,
} from "~/main/product";
import { collectRasterTargets } from "~/main/raster-targets";
import { readFrameTree, readNode } from "~/main/read-scene-graph";
import type {
	CardsMessage,
	CardView,
	ClearBindingMessage,
	ColorwayRead,
	FieldOverviewItem,
	FieldsOverviewMessage,
	NodeCandidate,
	ReadDocumentMessage,
	ReadFailedMessage,
	ReadProgressMessage,
	ResizeNodeMessage,
	SelectionDetail,
	SelectionDetailMessage,
	SetBindingMessage,
	SlotRead,
	TemplateMode,
	ThumbnailsMessage,
	UiToMain,
} from "~/shared/protocol";
import {
	DEFAULT_SETTINGS,
	type PluginSettings,
	type SettingsMessage,
} from "~/shared/protocol";

// 2x the thumbnail box in layout.tsx, so previews stay sharp on retina.
const THUMBNAIL_WIDTH = 128;
const SETTINGS_KEY = "freshcoat_plugin_settings";

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

// The slot frame a node lives in = its top-level ancestor on the current page,
// where template-global field metadata (FIELDS_KEY) is stored.
function slotFrameOf(node: BaseNode): BaseNode | null {
	let n: BaseNode | null = node;
	while (n?.parent && n.parent.type !== "PAGE") n = n.parent;
	return n?.parent?.type === "PAGE" ? n : null;
}

function readFieldsMap(node: BaseNode): Record<string, FieldMeta> {
	const raw = readPluginData(node, FIELDS_KEY);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as Record<string, FieldMeta>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

// main → ui: the binding state of the single selected node (drives the Layer tab).
function postSelectionDetail(): void {
	const sel = figma.currentPage.selection;
	let detail: SelectionDetail | null = null;
	if (sel.length === 1) {
		const node = readNode(sel[0] as never);
		if (node) {
			const binding = node.binding
				? storedToNodeBinding(node.binding)
				: inferNodeBinding(node);
			const slot = slotFrameOf(sel[0]);
			const metas = slot ? readFieldsMap(slot) : {};
			detail = {
				nodeId: node.id,
				name: node.name,
				nodeType: node.type,
				capabilities: bindableProperties(node),
				bind: binding?.bind ?? {},
				fields: (binding?.fields ?? []).map((d) => ({
					id: d.id,
					format: d.format,
					meta: metas[d.id] ?? buildFieldMeta(d),
				})),
			};
		}
	}
	const msg: SelectionDetailMessage = { type: "selection-detail", detail };
	figma.ui.postMessage(msg);
}

// Aggregate every field stored across the page's top-level frames, mapping each
// to the nodes that reference it (for jump-to-canvas). Decoupled from slot
// assignment — any harvested frame carries its own field metadata.
function gatherFieldsOverview(): FieldOverviewItem[] {
	const items: FieldOverviewItem[] = [];
	for (const frame of figma.currentPage.children) {
		if (
			frame.type !== "FRAME" &&
			frame.type !== "COMPONENT" &&
			frame.type !== "COMPONENT_SET"
		) {
			continue;
		}
		const metas = readFieldsMap(frame);
		const ids = Object.keys(metas);
		if (ids.length === 0) continue;

		const refs = new Map<string, string[]>();
		const names = new Map<string, string>();
		for (const node of frame.findAllWithCriteria({
			pluginData: { keys: [FIELD_KEY] },
		})) {
			const raw = readPluginData(node, FIELD_KEY);
			if (!raw) continue;
			try {
				const parsed = JSON.parse(raw) as { bind?: Record<string, string> };
				for (const template of Object.values(parsed.bind ?? {})) {
					for (const id of extractTokens(template)) {
						const list = refs.get(id);
						if (list) list.push(node.id);
						else refs.set(id, [node.id]);
						names.set(node.id, node.name);
					}
				}
			} catch {
				// Malformed pluginData — skip this node.
			}
		}
		for (const id of ids) {
			items.push({
				id,
				meta: metas[id],
				slot: frame.name,
				nodeIds: refs.get(id) ?? [],
				layerNames: (refs.get(id) ?? []).map((n) => names.get(n) ?? ""),
			});
		}
	}
	return items;
}

function postFieldsOverview(): void {
	const msg: FieldsOverviewMessage = {
		type: "fields-overview",
		fields: gatherFieldsOverview(),
	};
	figma.ui.postMessage(msg);
}

async function handleHarvest(
	product: ProductRegistryEntry,
	sideAssignment: Record<string, string>,
	cardId: string,
): Promise<void> {
	const card = await figma.getNodeByIdAsync(cardId);
	if (!card) {
		figma.notify(
			"Could not resolve the card to sync fields to. Re-pick your card.",
		);
		return;
	}
	const cardMeta = readFieldsMap(card);
	const slots: SlotHarvestInput[] = [];
	const frameNodes = await Promise.all(
		product.frames.map((frame) => {
			const nodeId = sideAssignment[frame.name];
			return nodeId ? figma.getNodeByIdAsync(nodeId) : null;
		}),
	);
	for (const node of frameNodes) {
		if (
			!node ||
			(node.type !== "FRAME" &&
				node.type !== "COMPONENT" &&
				node.type !== "COMPONENT_SET")
		) {
			continue;
		}
		slots.push({
			slotId: node.id,
			tree: readFrameTree(node as never),
			existingMeta: cardMeta,
		});
	}
	const plan = planHarvest(slots);
	const bound = await Promise.all(
		plan.nodeBindings.map((nb) => figma.getNodeByIdAsync(nb.nodeId)),
	);
	for (const [i, nb] of plan.nodeBindings.entries()) {
		bound[i]?.setPluginData(FIELD_KEY, JSON.stringify(nb.record));
	}
	if (card) {
		const mergedMeta: Record<string, FieldMeta> = {};
		for (const sm of plan.slotMeta) Object.assign(mergedMeta, sm.meta);
		card.setPluginData(FIELDS_KEY, JSON.stringify(mergedMeta));
	}
	const count = plan.nodeBindings.length;
	figma.notify(`Synced ${count} field${count === 1 ? "" : "s"} to layers.`);
	postSelectionDetail();
	postFieldsOverview();
}

async function handleSetBinding(msg: SetBindingMessage): Promise<void> {
	const node = await figma.getNodeByIdAsync(msg.nodeId);
	if (!node) return;
	if (msg.setName !== undefined) {
		(node as SceneNode).name = msg.setName;
	} else {
		for (const r of msg.renames ?? []) {
			const renamed = renameInMarker(node.name, r.from, r.to);
			if (renamed !== null) (node as SceneNode).name = renamed;
		}
	}
	node.setPluginData(FIELD_KEY, JSON.stringify({ bind: msg.bind }));
	const slot = slotFrameOf(node);
	if (slot) {
		const metas = readFieldsMap(slot);
		for (const id of msg.removedIds ?? []) delete metas[id];
		for (const m of msg.fields) metas[m.id] = m;
		slot.setPluginData(FIELDS_KEY, JSON.stringify(metas));
	}
	postSelectionDetail();
	postFieldsOverview();
}

async function handleClearBinding(msg: ClearBindingMessage): Promise<void> {
	const node = await figma.getNodeByIdAsync(msg.nodeId);
	if (!node) return;
	node.setPluginData(FIELD_KEY, "");
	const slot = slotFrameOf(node);
	if (slot) {
		const metas = readFieldsMap(slot);
		for (const id of msg.removedIds) delete metas[id];
		slot.setPluginData(FIELDS_KEY, JSON.stringify(metas));
	}
	postSelectionDetail();
	postFieldsOverview();
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

// Panel state persisted in clientStorage. Held in memory so a save can merge a
// partial patch without a read round-trip; the UI only ever sends the keys it
// changed.
let settings: PluginSettings = { ...DEFAULT_SETTINGS };

// clientStorage is not guaranteed — a read that throws must cost the author
// their remembered layout, not the whole panel.
async function loadSettings(): Promise<PluginSettings> {
	try {
		settings = await loadSettingsAsync(DEFAULT_SETTINGS, SETTINGS_KEY);
	} catch {
		settings = { ...DEFAULT_SETTINGS };
	}
	return settings;
}

function postSettings(): void {
	const msg: SettingsMessage = { type: "settings", settings };
	figma.ui.postMessage(msg);
}

async function handleSaveSettings(
	patch: Partial<PluginSettings>,
): Promise<void> {
	settings = { ...settings, ...patch };
	try {
		await saveSettingsAsync(settings, SETTINGS_KEY);
	} catch {
		// Preference didn't stick; the in-memory copy still drives this session.
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
		if (msg.type === "request-read")
			void readCardIntoSlots(
				msg.product,
				msg.mode,
				msg.sideAssignment,
				msg.cardId,
			);
		else if (msg.type === "harvest")
			void handleHarvest(msg.product, msg.sideAssignment, msg.cardId);
		else if (msg.type === "set-binding") void handleSetBinding(msg);
		else if (msg.type === "clear-binding") void handleClearBinding(msg);
		else if (msg.type === "focus-node") void handleFocus(msg.nodeId);
		else if (msg.type === "resize-node") void handleResize(msg);
		else if (msg.type === "request-fields") postFieldsOverview();
		else if (msg.type === "request-thumbnails")
			void postThumbnails(msg.nodeIds);
		else if (msg.type === "resize-window")
			figma.ui.resize(msg.width, msg.height);
		else if (msg.type === "save-settings")
			void handleSaveSettings(msg.settings);
		else if (msg.type === "request-settings") postSettings();
		else if (msg.type === "open-external") {
			if (/^https?:\/\//.test(msg.url)) figma.openExternal(msg.url);
		} else if (msg.type === "products-loaded") {
			// The UI fetched the live catalog; overlay it so card detection and
			// reads use the same SKUs/frames, then re-post cards with the new specs.
			applyRemoteProducts(msg.products);
			void postCards();
		}
	};
}
