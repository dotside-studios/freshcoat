import type {
	TemplateWarning,
	VariantElementDelta,
	VisibilityCondition,
} from "@freshcoat-js/coatfile";
import {
	assetUri,
	type PendingAsset,
	parseAssetUri,
} from "@freshcoat-js/coatfile/assets";
import type {
	FigmaConstraints,
	FigmaContainerNode,
	FigmaNode,
	FigmaVectorNode,
} from "../types";
import { isContainerNode, isRectangleNode, isTextNode } from "../types";

const VECTOR_TYPES = new Set([
	"VECTOR",
	"BOOLEAN_OPERATION",
	"STAR",
	"POLYGON",
	"LINE",
	"ELLIPSE",
]);
const isVectorNode = (n: FigmaNode): n is FigmaVectorNode =>
	VECTOR_TYPES.has(n.type);

import {
	buildFieldMeta,
	extractTokens,
	type FieldMeta,
	fieldMetaToSchema,
	inferNodeBinding,
	parseVisibilityMarker,
	storedToNodeBinding,
} from "../binding";
import { transpileBarcode } from "./barcode";
import { isBarcodeLayerName } from "./barcode-name";
import {
	type Classification,
	classify,
	elementBlendMode,
	type FlattenReason,
	hasTextStroke,
	isQrLayerName,
} from "./classify";
import { dedupeFlattenMarkers, type FlattenMarker } from "./coalesce";
import { figmaPaintToFill } from "./colors";
import { elementConstraints, groupConstraints } from "./constraints";
import {
	FlattenFallbackError,
	localAabb,
	placeRasterIn,
	type RasterFrame,
	renderBoundsOf,
	toAuthorSpace,
} from "./coordinates";
import { extractEffects } from "./effects";
import {
	type CanvasSize,
	exactSizeCheck,
	fromDesignSize,
	type SizeIssue,
	SizeMismatchError,
	sizesAgree,
} from "./exact-size";
import { collectFontDescriptors } from "./fonts";
import { layoutChildFromNode, transpileFrame } from "./frame";
import {
	combineGuides,
	readSlotGuides,
	type SlotGuides,
	withoutGuides,
} from "./guides";
import { transpileImage } from "./image";
import { canHoldImage } from "./image-shape";
import { transpileQr } from "./qr";
import { rasterScaleFor } from "./raster-scale";
import {
	isEmptyRaster,
	type RenderImageFn,
	type RenderResult,
	rasterElementId,
	rasterizeMarkers,
} from "./rasterize";
import { transpileRect } from "./rect";
import { textLayoutSizing, transpileText } from "./text";
import { decomposeTransform, nodeExtent } from "./transform";
import { alignInstanceVisibility, uniqueVariantId } from "./variants";
import { transpileVector } from "./vector";

export type FrameSlot = { name: string; label: string; required: true };
export type ProductRegistryEntry = {
	sku: string;
	displayName: string;
	/** Exact print size in pixels (CR80 at ~300 DPI = 1013×638). Under
	 *  sizeMode "exact" frames must measure exactly this (either orientation)
	 *  and template dims are emitted as these ints; under "from-design" it is
	 *  only a seed — the design's own measurement wins. */
	width: number;
	height: number;
	frames: FrameSlot[];
};

/** How the template's canvas is decided.
 *  - "exact": the product declares the print size and every slot frame must
 *    measure it. Card fulfillment prints at the template's native pixels, so
 *    the emitted dims have to be the product's.
 *  - "from-design": no product is pinning a size, so the first slot's own
 *    measurement becomes the canvas and the remaining slots must agree with
 *    it. Backs the plugin's custom export (certificates, posters, anything
 *    rendered through coatfile outside the Davi order pipeline). */
export type SizeMode = "exact" | "from-design";

/** The figma node one frame was read from. */
export type FigmaPick = {
	fileKey: string;
	nodeId: string;
	nodeName: string;
	width: number;
	height: number;
};

export type TemplateMetadata = {
	id: string;
	name: string;
	version: string;
	formatVersion: string;
	description?: string;
	mood?: string;
	author?: { name: string; url?: string };
};

/** What the walk decided about one Figma node, and what it produced. The counts
 *  say how many layers flattened; this says WHICH ones and WHY — the question an
 *  author (or anyone reading a template back) actually has when a shape arrives
 *  as a bitmap. */
export type NodeTrace = {
	slot: string;
	nodeId: string;
	name: string;
	nodeType: string;
	decision: Classification["kind"];
	reason?: FlattenReason;
	/** The element this node produced. Absent when it produced none: a skipped
	 *  layer, a pass-through group, or a raster whose bytes never arrived. Read
	 *  AFTER ids are uniquified, so it matches the emitted template. */
	elementId?: string;
};

/** One line of the same, kept in the template itself for the nodes that did not
 *  come through as authored. Small enough to ride along on every export. */
export type ReportedDecision = Omit<NodeTrace, "slot">;

/** How much of the design survived as native elements vs. had to be flattened
 *  to a raster. The headline number an author judges an import by. */
export type TranspileReport = {
	counts: { native: number; flattened: number; skipped: number };
	durationMs: number;
	/** Every layer that was flattened or skipped, with the reason. Omitted when
	 *  the whole design came through natively. */
	decisions?: ReportedDecision[];
};

export type FetchNodeTreeFn = (
	fileKey: string,
	nodeId: string,
) => Promise<FigmaContainerNode>;

export type ColorwayInput = {
	instanceId: string; // the INSTANCE node the colorway was read from
	label: string;
	perSide: Record<string, FigmaContainerNode>; // side name → instance's side child (fills read)
};

/** Which figma instance produced one emitted variant, keyed by the variant's
 *  id. The counterpart of FigmaPick for colorways. */
export type FigmaVariantPick = {
	instanceId: string;
	label: string;
};

export type TranspileInput = {
	product: ProductRegistryEntry;
	sizeMode?: SizeMode; // default "exact"
	picks: Record<string, FigmaPick>; // base side children (template_data)
	variants?: ColorwayInput[]; // colorway instances (optional; omitted/[] = no colorways)
	metadata: TemplateMetadata;
	fetchNodeTree: FetchNodeTreeFn;
	renderImage: RenderImageFn;
};

export type TranspileOutput = {
	template: unknown;
	pendingAssets: PendingAsset[];
	fieldsInferred: Array<{ id: string; field: Record<string, unknown> }>;
	warnings: TemplateWarning[];
	/** Keyed by emitted variant id. Empty when the card has no colorways; the
	 *  synthesized "default" variant has no instance behind it and is absent. */
	variantPicks: Record<string, FigmaVariantPick>;
	report: TranspileReport;
	/** What the walk decided about every node it reached. The template carries
	 *  only the notable rows (see TranspileReport.decisions); this is the whole
	 *  record, for a diagnostics export to pair with the scene graph it read. */
	trace: NodeTrace[];
};

// A container's rotation in world, degrees. Only ever asked of a frame the walk
// already emitted, so the transform is known to decompose; a matrix that somehow
// doesn't reads as unrotated, which is what the upright placement path assumes
// anyway.
function worldRotationOf(n: FigmaContainerNode): number {
	if (!n.absoluteTransform) return 0;
	const d = decomposeTransform(n.absoluteTransform, nodeExtent(n));
	return d.ok ? d.rotation : 0;
}

function backgroundFromFrame(
	frame: FigmaContainerNode,
	slotName: string,
	authorWidth: number,
	authorHeight: number,
) {
	const fills = (frame.fills ?? []).filter((f) => f.visible !== false);
	const id = frame.name || slotName;
	if (fills.length === 0) {
		return {
			id,
			type: "rect" as const,
			pos: { x: 0, y: 0 },
			size: { width: authorWidth, height: authorHeight },
			properties: { fill: "#ffffff" },
		};
	}
	const result = figmaPaintToFill(fills[0], {
		width: authorWidth,
		height: authorHeight,
	});
	if (result.kind === "solid") {
		return {
			id,
			type: "rect" as const,
			pos: { x: 0, y: 0 },
			size: { width: authorWidth, height: authorHeight },
			properties: { fill: result.hex },
		};
	}
	return {
		id,
		type: "rect" as const,
		pos: { x: 0, y: 0 },
		size: { width: authorWidth, height: authorHeight },
		properties: { fill: result.value },
	};
}

const TOKEN = /\{\{[^{}]*\}\}/g;

// A text field keeps its runs' styling only when the runs spell out the
// template itself, each token whole inside one run, so every token is filled
// in where it was typed and in that run's style. Otherwise the field's value
// replaces the whole text in the first run's style.
function spansSpellTemplate(spans: unknown, template: string): boolean {
	if (!Array.isArray(spans)) return false;
	const texts = (spans as Array<{ text: string }>).map((s) => s.text);
	if (texts.join("") !== template) return false;
	const whole = texts.reduce((n, t) => n + (t.match(TOKEN)?.length ?? 0), 0);
	return whole === (template.match(TOKEN)?.length ?? 0);
}

// Drive an element from the node's binding (stored pluginData, else live). The
// single source for field registration + value templating across kinds:
//  - text value, text color, shape/frame fill (templated here)
//  - image / qr (the element transpiler already templated src/value; we own the
//    field registration so metadata is uniform)
// A text binding on a non-text element is ignored (inferNodeBinding returns
// nothing for that case). Registers only the field ids actually applied.
function applyBindingOverlay(
	node: FigmaNode,
	el: Record<string, unknown>,
	overlayMeta: Map<string, FieldMeta>,
): void {
	const binding = node.binding
		? storedToNodeBinding(node.binding)
		: inferNodeBinding(node);
	if (!binding) return;

	const props = el.properties as Record<string, unknown>;
	const applied = new Set<string>();
	const mark = (tmpl: string): void => {
		for (const id of extractTokens(tmpl)) applied.add(id);
	};

	if (el.type === "text" && binding.bind.text !== undefined) {
		if (
			props.value !== binding.bind.text &&
			!spansSpellTemplate(props.spans, binding.bind.text)
		) {
			props.value = binding.bind.text;
			delete props.spans;
		}
		mark(binding.bind.text);
	}

	if (el.type === "text" && binding.bind.textColor !== undefined) {
		props.color = binding.bind.textColor;
		delete props.fill;
		if (Array.isArray(props.spans))
			for (const span of props.spans as Array<Record<string, unknown>>)
				delete span.color;
		mark(binding.bind.textColor);
	}
	if (
		(el.type === "rect" || el.type === "frame") &&
		binding.bind.fill !== undefined
	) {
		props.fill = binding.bind.fill;
		mark(binding.bind.fill);
	}
	if (el.type === "image" && binding.bind.image !== undefined) {
		mark(binding.bind.image);
	}
	if (el.type === "qr_code" && binding.bind.qr !== undefined) {
		mark(binding.bind.qr);
	}
	// A placeholder standing in for a barcode that cannot be drawn carries no
	// value, so it asks for no field.
	if (
		el.type === "barcode" &&
		binding.bind.barcode !== undefined &&
		props.value !== ""
	) {
		mark(binding.bind.barcode);
	}

	for (const draft of binding.fields) {
		if (applied.has(draft.id) && !overlayMeta.has(draft.id)) {
			overlayMeta.set(draft.id, buildFieldMeta(draft));
		}
	}
}

// Mutable outputs a side's element production writes into. The base slot
// loop passes the REAL outer accumulators (counts/warnings/overlayMeta feed
// the report + field schema; assets feed pendingAssets); a colorway
// instance's side passes a THROWAWAY sink so variant production doesn't
// double-count, re-warn, re-register fields, or duplicate assets — the
// side's elements are only used locally to diff against the base.
type ElementSink = {
	counts: { native: number; flattened: number; skipped: number };
	warnings: TemplateWarning[];
	overlayMeta: Map<string, FieldMeta>;
	// Fields an `if:` layer names. Those no layer renders become toggles.
	visibilityFields: Set<string>;
	assets: PendingAsset[];
	trace: TraceEntry[];
};

// A trace under construction. `el` is the element object the node produced,
// held by REFERENCE until ids settle: a name that collides with another layer's
// is renamed by uniquifyElementIdsDeep, and this certificate renames a dozen
// (Rectangle_5_2, Blocks_2, …), so an id read at build time names an element
// that is not in the file. Dropped before the trace is returned.
type TraceEntry = NodeTrace & { el?: Record<string, unknown> };

function makeThrowawaySink(): ElementSink {
	return {
		counts: { native: 0, flattened: 0, skipped: 0 },
		warnings: [],
		overlayMeta: new Map(),
		visibilityFields: new Set(),
		assets: [],
		trace: [],
	};
}

// Produces one slot side's background + native elements: walks frame.children
// (flattening groups, classifying native vs. flatten-to-raster vs. skip),
// rasterizes coalesced flatten/static-image markers, and uniquifies element
// ids GLOBALLY across the whole side (top-level and nested frame children —
// see uniquifyElementIdsDeep below). Called once per base slot (with the real
// sink) and once per colorway instance side (with a throwaway sink) — an
// instance mirrors the base's child names/order, so the SAME walk produces
// the SAME id sequence, which is what lets the variant diff below align
// elements by id.
async function buildSideElements(
	frame: FigmaContainerNode,
	slotName: string,
	opts: {
		scale: number;
		fileKey: string;
		authorWidth: number;
		authorHeight: number;
		renderImage: RenderImageFn;
		sink: ElementSink;
	},
): Promise<{
	background: ReturnType<typeof backgroundFromFrame>;
	elements: unknown[];
}> {
	const { scale, fileKey, authorWidth, authorHeight, renderImage, sink } = opts;
	const background = backgroundFromFrame(
		frame,
		slotName,
		authorWidth,
		authorHeight,
	);
	const elements: unknown[] = [];

	// A rasterized region has to paint in the z-order its node occupied — a
	// flattened backdrop belongs UNDER the text drawn over it in Figma, and a
	// batch of rasters appended after the walk would bury every native element
	// on the card. The bytes only arrive after the walk (rasterizing is async and
	// batched per side), so the walk parks a placeholder in the array it is
	// filling and records the slot; the raster drops into that exact position
	// once its bytes land, and an unfilled slot is pruned before the side is
	// emitted.
	type RasterSlot = { container: unknown[]; index: number };
	const reserveSlot = (container: unknown[]): RasterSlot => {
		const index = container.length;
		container.push({ __rasterSlot: true });
		return { container, index };
	};
	// A placeholder collects what the walk knew but the rasterizer doesn't — the
	// layoutChild block its parent's auto-layout pass tagged on, and the opacity
	// owed by flattened-away ancestors. Carry both onto the element taking its
	// place.
	const CARRIED = [
		"layoutChild",
		"opacity",
		"visibleWhen",
		"constraints",
	] as const;
	const fillSlot = (
		slot: RasterSlot,
		element: unknown,
	): Record<string, unknown> => {
		const placeholder = slot.container[slot.index] as Record<string, unknown>;
		const merged = { ...(element as Record<string, unknown>) };
		for (const key of CARRIED) {
			if (placeholder[key] !== undefined) merged[key] = placeholder[key];
		}
		slot.container[slot.index] = merged;
		return merged;
	};

	type SlottedMarker = FlattenMarker & { slot: RasterSlot; entry: TraceEntry };
	const flattenMarkers: SlottedMarker[] = [];
	const staticImageMarkers: Array<{
		nodeId: string;
		pos: { x: number; y: number };
		size: { width: number; height: number };
		rotation: number;
		slot: RasterSlot;
		entry: TraceEntry;
	}> = [];

	// One line per node the walk reached, in visit order. Recorded for EVERY
	// decision, including the ones that produce nothing — "this layer was skipped
	// because it is invisible" is exactly the answer that was missing.
	const record = (
		n: FigmaNode,
		decision: Classification["kind"],
		reason?: FlattenReason,
	): TraceEntry => {
		const entry: TraceEntry = {
			slot: slotName,
			nodeId: n.id,
			name: n.name,
			nodeType: n.type,
			decision,
			...(reason ? { reason } : {}),
		};
		sink.trace.push(entry);
		return entry;
	};

	// Which constraints the node being walked answers to. A frame's children
	// follow their own, against the frame. A group has no box to be constrained
	// against, so its contents follow the group's as one unit. An auto-layout
	// frame places its flow children itself, so only an absolutely positioned
	// one is placed by constraints. The walk is synchronous, so the scope is
	// swapped around each container's children and restored after.
	type ConstraintScope = {
		inherited?: FigmaConstraints;
		autoLayout: boolean;
	};
	let constraintScope: ConstraintScope = { autoLayout: false };
	const withConstraintScope = (next: ConstraintScope, fn: () => void): void => {
		const prev = constraintScope;
		constraintScope = next;
		try {
			fn();
		} finally {
			constraintScope = prev;
		}
	};
	const groupScope = (group: FigmaContainerNode): ConstraintScope => ({
		inherited: constraintScope.inherited ?? groupConstraints(group),
		autoLayout:
			constraintScope.autoLayout && group.layoutPositioning !== "ABSOLUTE",
	});
	const constraintsFor = (
		n: FigmaNode,
	): ReturnType<typeof elementConstraints> => {
		if (constraintScope.autoLayout && n.layoutPositioning !== "ABSOLUTE")
			return undefined;
		const source =
			constraintScope.inherited ??
			(isContainerNode(n) && n.type === "GROUP"
				? groupConstraints(n)
				: n.constraints);
		return elementConstraints(source);
	};
	const applyConstraints = (
		el: Record<string, unknown>,
		n: FigmaNode,
	): void => {
		const c = constraintsFor(n);
		if (c) el.constraints = c;
	};

	// Figma composites every node with its own opacity, on top of whatever its
	// fills already carry. A GROUP applies its opacity to everything inside it,
	// and a group has no element of its own here (it is flattened away for
	// having no coordinate space), so its opacity is folded into each descendant
	// rather than dropped — a background group at 35% whose children are emitted
	// opaque paints roughly three times as strongly as the design does.
	const applyOpacity = (el: Record<string, unknown>, factor: number): void => {
		const combined = factor * ((el.opacity as number) ?? 1);
		if (combined < 1) el.opacity = Math.round(combined * 1000) / 1000;
	};
	const opacityOf = (n: FigmaNode): number =>
		typeof n.opacity === "number" ? n.opacity : 1;

	// Where a node's bitmap goes, for both flattened regions and static placed
	// images. The exported PNG fills the node's RENDERED region
	// (absoluteRenderBounds), with rotation, effects and clipping already baked
	// into the pixels, so it is placed at exactly those bounds — the geometry
	// AABB would stretch the cropped PNG and let it bleed past the canvas.
	//
	// Those bounds are world-axis-aligned; placeRasterIn does whatever the walk's
	// own coordinate frame needs for them to LAND that way (see coordinates.ts).
	// The raster always goes into the target its node was being walked into, so
	// it keeps that frame's z-order and clip.
	const placeRaster = (
		n: FigmaNode,
		coordFrame: RasterFrame,
		target: unknown[],
		// Only what ANCESTORS owe: exportAsync renders the node itself, so its own
		// opacity is already in the pixels and applying it again would double it.
		inheritedOpacity: number,
	) => {
		const placed = placeRasterIn(renderBoundsOf(n), coordFrame, scale);
		// A region with no area draws nothing, and Figma exports it as a 1×1
		// transparent pixel — an element that costs the author a shape and an
		// asset while rendering as a hole. Say so instead of emitting it.
		if (placed.size.width <= 0 || placed.size.height <= 0) {
			sink.warnings.push({
				severity: "warn",
				code: "raster_empty",
				message: `Layer "${n.name}" had to be rasterized but covers no area, so it was skipped.`,
				nodeId: n.id,
			});
			return null;
		}
		const slot = reserveSlot(target);
		const placeholder = slot.container[slot.index] as Record<string, unknown>;
		applyOpacity(placeholder, inheritedOpacity);
		// The bitmap stands in for the node, so it follows the node's constraints.
		applyConstraints(placeholder, n);
		return { ...placed, slot };
	};

	// walkNode takes the local coordinate frame (the space children's pos is
	// measured in — its box, and how that box sits in the world) and the target
	// array to push native elements into.
	const walkNode = (
		n: FigmaNode,
		localFrame: RasterFrame,
		target: unknown[],
		worldAnchor: { x: number; y: number } | null,
		// Opacity owed by ancestors this walk flattened away (GROUPs). A FRAME
		// carries its own on its element, so it resets this to 1 for its subtree.
		inheritedOpacity: number,
	) => {
		const c = classify(n);
		if (c.kind === "skip") {
			sink.counts.skipped++;
			record(n, "skip");
			// A hidden/transparent qr: layer signals clear intent but renders
			// nothing — surface it rather than dropping it silently.
			if (isQrLayerName(n.name)) {
				sink.warnings.push({
					severity: "warn",
					code: "qr_layer_hidden",
					message: `QR layer "${n.name}" is hidden or fully transparent, so it was skipped. Make it visible to include the QR.`,
					nodeId: n.id,
				});
			}
			if (isBarcodeLayerName(n.name)) {
				sink.warnings.push({
					severity: "warn",
					code: "barcode_layer_hidden",
					message: `Barcode layer "${n.name}" is hidden or fully transparent, so it was skipped. Make it visible to include the barcode.`,
					nodeId: n.id,
				});
			}
			return;
		}
		if (c.kind === "container") {
			const containerEntry = record(n, "container");
			if (!isContainerNode(n)) return;
			// A group carrying an effect or a blend mode has to composite as ONE
			// layer — an inner shadow belongs to the silhouette of everything in
			// it, and a Multiply group multiplies its composited content, not each
			// child separately — so it gets an element of its own to hang them on. See groupLayer for the coordinate work that costs.
			const fx = extractEffects(n.effects, scale, localFrame.rotation);
			if (
				fx.shadow !== undefined ||
				fx.blur !== undefined ||
				elementBlendMode(n) !== undefined
			) {
				const el = groupLayer(n, fx, localFrame, worldAnchor, inheritedOpacity);
				if (el) {
					containerEntry.el = el;
					target.push(el);
					return;
				}
			}
			// Otherwise a GROUP is coordinate-transparent: its descendants are
			// anchored to the nearest FRAME ancestor, not the group. Flatten it by
			// recursing its children into the SAME target array with the SAME
			// localFrame / worldAnchor — top-level group → children top-level
			// (placeWorld); nested group → children into the parent frame
			// (placeLocal). The group's own transform is discarded (groups are
			// organizational), so each child composes via its OWN frame-relative
			// transform with no double-count.
			const childOpacity = inheritedOpacity * opacityOf(n);
			withConstraintScope(groupScope(n), () =>
				walkChildren(n.children, localFrame, target, worldAnchor, childOpacity),
			);
			return;
		}
		// Park the node's bitmap where its element would have gone, and record it
		// as flattened. `entry` is reused when the decision was reached AFTER the
		// node had already been recorded as native (see the catch below), so one
		// node still produces exactly one trace line.
		const flattenTo = (reason: FlattenReason, entry: TraceEntry): void => {
			sink.counts.flattened++;
			const placed = placeRaster(n, localFrame, target, inheritedOpacity);
			if (!placed) return;
			flattenMarkers.push({
				nodeId: n.id,
				pos: placed.pos,
				size: placed.size,
				reason,
				rotation: placed.rotation,
				slot: placed.slot,
				entry,
			});
		};

		if (c.kind === "flatten") {
			flattenTo(c.reason, record(n, "flatten", c.reason));
			return;
		}
		sink.counts.native++;
		const entry = record(n, c.kind);
		const anchor = worldAnchor ?? undefined;
		const ctx = { frame: localFrame.box, scale, worldAnchor: anchor };
		let el: Record<string, unknown> | undefined;
		try {
			if (c.kind === "native-text" && isTextNode(n)) {
				// The binding names the element (see transpileText) — resolved the
				// same way the image branch below resolves its own.
				const textBinding = n.binding
					? storedToNodeBinding(n.binding)
					: inferNodeBinding(n);
				el = transpileText(n, ctx, textBinding?.bind.text);
				if (hasTextStroke(n))
					sink.warnings.push({
						severity: "warn",
						code: "text_stroke_unsupported",
						message: `Text layer "${n.name}" has a stroke, which was dropped: it is bound to a field, so it was kept as text instead of rasterized.`,
						nodeId: n.id,
					});
			} else if (c.kind === "native-rect" && isRectangleNode(n))
				el = transpileRect(n, {
					frame: ctx.frame,
					scale: ctx.scale,
					worldAnchor: anchor,
				});
			else if (c.kind === "native-image" && canHoldImage(n)) {
				// Dynamic if the node carries an image binding (stored or inferred),
				// not just a bare-token name. Keeps `image:` markers + Layer-tab
				// image bindings from silently rasterizing.
				const imgBinding = n.binding
					? storedToNodeBinding(n.binding)
					: inferNodeBinding(n);
				const r = transpileImage(n, ctx, imgBinding?.bind.image);
				if (r.kind === "element") {
					el = r.element;
					for (const w of r.warnings) sink.warnings.push(w);
				} else {
					// Static placed image — rasterized, and parked exactly the way a
					// flattened region is.
					const placed = placeRaster(n, localFrame, target, inheritedOpacity);
					if (placed) {
						staticImageMarkers.push({
							nodeId: r.nodeId,
							pos: placed.pos,
							size: placed.size,
							rotation: placed.rotation,
							slot: placed.slot,
							entry,
						});
					}
				}
			} else if (c.kind === "native-qr") el = transpileQr(n, ctx);
			else if (c.kind === "native-barcode") {
				const r = transpileBarcode(n, ctx);
				el = r.element;
				for (const w of r.warnings) sink.warnings.push(w);
			} else if (c.kind === "native-vector" && isVectorNode(n))
				el = transpileVector(n, {
					frame: ctx.frame,
					scale: ctx.scale,
					worldAnchor: anchor,
				});
			else if (c.kind === "native-frame" && isContainerNode(n)) {
				// Frame's pos is in localFrame coords; its children re-anchor to
				// the frame's own bbox so children's pos comes out frame-local.
				// transpileFrame carries the frame's parent-relative rotation; the
				// painter rotates the whole group (background + clip + children,
				// which are upright in local space) around its center, so a rotated
				// frame's background/clip/content all render correctly.
				const frameEl = transpileFrame(n, {
					outerFrame: localFrame.box,
					scale,
					worldAnchor: anchor,
				});
				// The coordinate space this frame opens for its children. Its rotation
				// is measured in WORLD, not against its parent: the slot frame's own
				// rotation is stripped, so every frame element's rotation composes back
				// to exactly this — and a raster parked inside needs the total, since
				// it is the total the painter will apply to it.
				const childFrame: RasterFrame = {
					box: n.absoluteBoundingBox,
					transform: n.absoluteTransform,
					rotation: worldRotationOf(n),
				};
				const parentIsAutoLayout =
					n.layoutMode !== undefined && n.layoutMode !== "NONE";
				// Constraints follow Figma's own reading of the frame: an auto-layout
				// frame's flow children ignore theirs.
				const childScope: ConstraintScope = { autoLayout: parentIsAutoLayout };
				withConstraintScope(childScope, () =>
					walkChildren(
						n.children,
						childFrame,
						frameEl.properties.children,
						null,
						1,
						(child, before) => {
							// Tag every element this child produced with the source child's
							// layoutChild block. A masked run flows as its mask layer.
							if (parentIsAutoLayout) {
								let lc = layoutChildFromNode(child, scale) ?? {};
								if (isTextNode(child)) {
									const ts = textLayoutSizing(child.style.textAutoResize);
									// textAutoResize is the fallback; explicit Figma layoutSizing* wins.
									lc = { width: ts.width, height: ts.height, ...lc };
								}
								for (
									let i = before;
									i < frameEl.properties.children.length;
									i++
								) {
									const produced = frameEl.properties.children[i] as Record<
										string,
										unknown
									>;
									// A rotated child FLOWS, the way Figma flows it: resolveLayout
									// reserves the bounding box of the turn and hands the child its
									// own box back, so a vertical label in a column of horizontal
									// content claims its 16px of height rather than its 331px of
									// length. Nothing to pin.
									//
									// A raster IS pinned: its box comes from the node's rendered
									// bounds, which include effect bleed the layout engine knows
									// nothing about, so letting it into the flow would reserve
									// space for a shadow.
									const pinned = produced.__rasterSlot === true;
									const childLc = pinned ? { ...lc, absolute: true } : lc;
									if (Object.keys(childLc).length > 0) {
										produced.layoutChild = childLc;
									}
								}
							}
						},
					),
				);
				el = frameEl as unknown as Record<string, unknown>;
			}
		} catch (e) {
			if (!(e instanceof FlattenFallbackError)) throw e;
			// classify() is the single gate the walk and the main thread's raster
			// pre-export both consult, and it runs the same decomposition these
			// transpilers do — so landing here means the two disagreed about one
			// node. Rasterize it (the bytes are likely missing, and the caller
			// warns) rather than losing the whole export to one bad matrix.
			sink.counts.native--;
			entry.decision = "flatten";
			entry.reason = "transform_undecomposable_flattened";
			flattenTo("transform_undecomposable_flattened", entry);
			return;
		}
		if (el) {
			// Inside a group given its own layer, placement still measured against
			// the enclosing FRAME (that is where Figma positions a group's
			// children), so shift onto the group's box.
			const off = localFrame.originOffset;
			if (off) {
				const p = el.pos as { x: number; y: number };
				el.pos = { x: p.x - off.x, y: p.y - off.y };
			}
			// What the painter will have turned this element by, all frames above
			// it composed: the space it is emitted into, plus its own rotation.
			const worldRotation =
				localFrame.rotation + ((el.rotation as number | undefined) ?? 0);
			const fx = extractEffects(n.effects, scale, worldRotation);
			if (fx.shadow) el.shadow = fx.shadow;
			if (fx.blur !== undefined) el.blur = fx.blur;
			// classify() declines to rasterize a layer set to Multiply/Screen/…
			// precisely because the element can carry the mode itself. Dropping it
			// here would composite that layer as Normal with nothing to say so —
			// invisible over white, wrong over every colorway.
			const blend = elementBlendMode(n);
			if (blend) el.blendMode = blend;
			// A frame's own opacity rides on its element and the painter applies it
			// to the whole group, so its children were walked with none inherited.
			applyOpacity(el, inheritedOpacity * opacityOf(n));
			applyConstraints(el, n);
			applyBindingOverlay(n, el, sink.overlayMeta);
			entry.el = el;
			target.push(el);
		}
	};

	// A layer named `if:{{field}}` shows only while the field is set. Everything
	// the layer produced takes the condition: a group flattens into its parent's
	// array, so each of its children carries it, and a raster placeholder hands
	// it on to the bitmap that fills it.
	const walk = (...args: Parameters<typeof walkNode>): void => {
		const [n, , target] = args;
		const cond = parseVisibilityMarker(n.name);
		const before = target.length;
		walkNode(...args);
		if (!cond) return;
		sink.visibilityFields.add(cond.field);
		for (let i = before; i < target.length; i++)
			addVisibility(target[i] as Record<string, unknown>, cond);
	};

	// A GROUP that has to composite as one layer, because it carries an effect
	// that belongs to everything in it at once rather than to each child.
	//
	// Figma gives a group NO coordinate space — its children are positioned
	// against the enclosing FRAME — so the box invented for it here is simply the
	// extent it covers in that space, and it is never rotated (an AABB has no
	// rotation; each child still carries its own). Everything inside continues to
	// place exactly as it did, then shifts onto that box via `originOffset`.
	const groupLayer = (
		n: FigmaContainerNode,
		fx: ReturnType<typeof extractEffects>,
		localFrame: RasterFrame,
		worldAnchor: { x: number; y: number } | null,
		inheritedOpacity: number,
	): Record<string, unknown> | undefined => {
		// A slot's direct children place in the stripped world space (the slot's
		// own rotation is discarded), where the group's world AABB already IS its
		// box; deeper down, its footprint in the enclosing frame is.
		const box = worldAnchor
			? toAuthorSpace(n.absoluteBoundingBox, frame.absoluteBoundingBox, scale)
			: localAabb(n, scale);
		if (box.size.width <= 0 || box.size.height <= 0) return undefined;

		const el: Record<string, unknown> = {
			id: n.name.replace(/[^a-zA-Z0-9_]/g, "_") || n.id.replace(":", "_"),
			type: "frame",
			pos: {
				x: box.pos.x - (localFrame.originOffset?.x ?? 0),
				y: box.pos.y - (localFrame.originOffset?.y ?? 0),
			},
			size: box.size,
			properties: { children: [] as unknown[] },
		};
		if (fx.shadow !== undefined) el.shadow = fx.shadow;
		if (fx.blur !== undefined) el.blur = fx.blur;
		const blend = elementBlendMode(n);
		if (blend) el.blendMode = blend;
		// The layer composites its subtree as a whole, so its opacity rides here
		// rather than being folded into each child.
		applyOpacity(el, inheritedOpacity * opacityOf(n));
		applyConstraints(el, n);

		const inner: RasterFrame = { ...localFrame, originOffset: box.pos };
		withConstraintScope(groupScope(n), () =>
			walkChildren(
				n.children,
				inner,
				(el.properties as { children: unknown[] }).children,
				worldAnchor,
				1,
			),
		);
		return el;
	};

	// Walk one parent's children in order, turning each Figma mask run into a
	// mask element. `each` sees the node that led each run (the mask layer, or a
	// lone child) and where in `target` its output starts.
	const walkChildren = (
		children: FigmaNode[],
		localFrame: RasterFrame,
		target: unknown[],
		worldAnchor: { x: number; y: number } | null,
		inheritedOpacity: number,
		each?: (node: FigmaNode, before: number) => void,
	): void => {
		for (const run of maskRuns(children)) {
			const before = target.length;
			if (run.masked)
				maskLayer(
					run.node,
					run.masked,
					localFrame,
					target,
					worldAnchor,
					inheritedOpacity,
				);
			else walk(run.node, localFrame, target, worldAnchor, inheritedOpacity);
			each?.(run.node, before);
		}
	};

	// A Figma mask: the mask layer is not drawn, and its coverage decides how
	// much of the layers above it shows. Its box is the mask element's, and like
	// a group given its own layer, everything inside places against the enclosing
	// frame and then shifts onto that box via `originOffset`. The shape collects
	// into an array for now, since a rasterized one is a slot the bitmap drops
	// into later; finalizeMasks settles it once every raster has landed.
	const maskLayer = (
		maskNode: FigmaNode,
		masked: FigmaNode[],
		localFrame: RasterFrame,
		target: unknown[],
		worldAnchor: { x: number; y: number } | null,
		inheritedOpacity: number,
	): void => {
		const box = worldAnchor
			? toAuthorSpace(
					maskNode.absoluteBoundingBox,
					frame.absoluteBoundingBox,
					scale,
				)
			: localAabb(maskNode, scale);
		// A mask covering nothing shows nothing.
		if (box.size.width <= 0 || box.size.height <= 0) return;

		const shape: unknown[] = [];
		const children: unknown[] = [];
		const el: Record<string, unknown> = {
			id: `${maskNode.name.replace(/[^a-zA-Z0-9_]/g, "_") || maskNode.id.replace(":", "_")}_mask`,
			type: "mask",
			pos: {
				x: box.pos.x - (localFrame.originOffset?.x ?? 0),
				y: box.pos.y - (localFrame.originOffset?.y ?? 0),
			},
			size: box.size,
			properties: {
				mask: shape,
				children,
				...(maskNode.maskType === "LUMINANCE" ? { channel: "luminance" } : {}),
			},
		};
		applyOpacity(el, inheritedOpacity);
		applyConstraints(el, maskNode);
		const inner: RasterFrame = { ...localFrame, originOffset: box.pos };
		walk(maskNode, inner, shape, worldAnchor, 1);
		for (const child of masked) walk(child, inner, children, worldAnchor, 1);
		target.push(el);
	};

	// The slot frame's own rotation is stripped — it becomes the axis-aligned
	// card — so its children live in plain world space, anchored to its AABB.
	const slotFrame: RasterFrame = {
		box: frame.absoluteBoundingBox,
		transform: null,
		rotation: 0,
	};
	walkChildren(
		withoutGuides(frame.children ?? []),
		slotFrame,
		elements,
		{
			x: frame.absoluteBoundingBox.x,
			y: frame.absoluteBoundingBox.y,
		},
		1,
	);

	// The density every raster on this side is exported at. Sized in AUTHOR space
	// so a design drawn smaller than the canvas doesn't quietly hand the card a
	// low-resolution bitmap; the main thread pre-exports at the same scale.
	const renderScale = rasterScaleFor(scale);

	const markers = dedupeFlattenMarkers(flattenMarkers);
	if (markers.length > 0) {
		const rasterized = await rasterizeMarkers({
			fileKey,
			markers,
			scale: renderScale,
			renderImage,
		});
		// rasterizeMarkers answers one entry per marker, in order, so each bitmap
		// goes back into the slot its node reserved. A null entry leaves the slot
		// unfilled, and it is pruned below.
		markers.forEach((m, i) => {
			const el = rasterized.elements[i];
			if (el) m.entry.el = fillSlot(m.slot, el);
		});
		for (const a of rasterized.assets) sink.assets.push(a);
		for (const id of rasterized.skipped) {
			sink.warnings.push({
				severity: "warn",
				code: "raster_unavailable",
				message: `A flattened region (${id}) had no exported raster and was skipped.`,
				nodeId: id,
			});
		}
		for (const id of rasterized.empty) {
			sink.warnings.push({
				severity: "warn",
				code: "raster_empty",
				message: `A flattened region (${id}) exported with nothing in it and was skipped.`,
				nodeId: id,
			});
		}
	}

	for (const m of staticImageMarkers) {
		let res: RenderResult;
		try {
			res = await renderImage({
				fileKey,
				nodeIds: [m.nodeId],
				scale: renderScale,
				format: "png",
			});
		} catch {
			// No pre-exported raster for this static image — skip + warn rather
			// than crashing the whole export.
			sink.warnings.push({
				severity: "warn",
				code: "raster_unavailable",
				message: `A static image (${m.nodeId}) had no exported raster and was skipped.`,
				nodeId: m.nodeId,
			});
			continue;
		}
		if (isEmptyRaster(res)) {
			sink.warnings.push({
				severity: "warn",
				code: "raster_empty",
				message: `A static image (${m.nodeId}) exported with nothing in it and was skipped.`,
				nodeId: m.nodeId,
			});
			continue;
		}
		m.entry.el = fillSlot(m.slot, {
			id: rasterElementId("image", m.nodeId),
			type: "image",
			pos: m.pos,
			size: m.size,
			...(m.rotation !== 0 ? { rotation: m.rotation } : {}),
			properties: { src: assetUri(res.sha256), fit: "fill" },
		});
		sink.assets.push({
			sha256: res.sha256,
			blob: res.blob,
			contentType: "image/png",
		});
	}

	const finalElements = uniquifyElementIdsDeep(
		dropUnfilledSlots(finalizeMasks(elements)),
	);
	// Ids are settled and every placeholder is gone, so an element still held by
	// a trace entry is one that made it into the file under the name it now has.
	for (const entry of sink.trace) {
		if (entry.el && typeof entry.el.id === "string")
			entry.elementId = entry.el.id;
		entry.el = undefined;
	}

	return { background, elements: finalElements };
}

// Figma masks the layers ABOVE a mask layer in the same parent, up to the next
// mask layer. A hidden mask masks nothing, so it is walked (and skipped) like any
// hidden layer.
function maskRuns(
	children: FigmaNode[],
): Array<{ node: FigmaNode; masked?: FigmaNode[] }> {
	const runs: Array<{ node: FigmaNode; masked?: FigmaNode[] }> = [];
	let current: FigmaNode[] | undefined;
	for (const child of children) {
		if (child.isMask && child.visible !== false) {
			current = [];
			runs.push({ node: child, masked: current });
		} else if (current) current.push(child);
		else runs.push({ node: child });
	}
	return runs;
}

// The element arrays nested inside one: a frame's children, and a mask's shape
// and the content it masks. The shape is still an array until finalizeMasks.
function nestedElementArrays(el: Record<string, unknown>): unknown[][] {
	const props = el.properties as
		| { children?: unknown; mask?: unknown }
		| undefined;
	if (el.type !== "frame" && el.type !== "mask") return [];
	const out: unknown[][] = [];
	if (el.type === "mask" && props?.mask)
		out.push(Array.isArray(props.mask) ? props.mask : [props.mask]);
	if (Array.isArray(props?.children)) out.push(props.children);
	return out;
}

// Settle each mask's shape now that every raster has landed: one element as is,
// several wrapped in a frame over the mask's box, none (every part of it was
// hidden or failed to export) and the mask shows nothing, so it goes.
function finalizeMasks(elements: unknown[]): unknown[] {
	const out: unknown[] = [];
	for (const raw of elements) {
		const el = raw as Record<string, unknown>;
		const props = el.properties as
			| { children?: unknown[]; mask?: unknown }
			| undefined;
		if (Array.isArray(props?.children))
			props.children = finalizeMasks(props.children);
		if (el.type === "mask" && props && Array.isArray(props.mask)) {
			const shape = finalizeMasks(dropUnfilledSlots(props.mask as unknown[]));
			if (shape.length === 0) continue;
			props.mask =
				shape.length === 1
					? shape[0]
					: {
							id: `${el.id}_shape`,
							type: "frame",
							pos: { x: 0, y: 0 },
							size: el.size,
							properties: { children: shape },
						};
		}
		out.push(el);
	}
	return out;
}

// Nested `if:` layers stack: an element inside two shows only while both hold.
function addVisibility(
	el: Record<string, unknown>,
	cond: VisibilityCondition,
): void {
	const cur = el.visibleWhen as
		| VisibilityCondition
		| VisibilityCondition[]
		| undefined;
	el.visibleWhen = cur ? [...(Array.isArray(cur) ? cur : [cur]), cond] : cond;
}

// Remove the z-order placeholders no raster ever landed in — a marker whose
// bytes were never exported, or one dropped for covering no area. They exist
// only to hold a position during the walk and are not template elements, so
// they must not reach the emitted side. Recurses frame children, since a
// placeholder is reserved in whichever array its node was being walked into.
function dropUnfilledSlots(elements: unknown[]): unknown[] {
	const walk = (els: unknown[]): void => {
		for (let i = els.length - 1; i >= 0; i--) {
			const el = els[i] as Record<string, unknown>;
			if ((el as { __rasterSlot?: boolean }).__rasterSlot === true) {
				els.splice(i, 1);
				continue;
			}
			for (const nested of nestedElementArrays(el)) walk(nested);
		}
	};
	walk(elements);
	return elements;
}

// coatfile's uniquifyElementIds (@freshcoat-js/coatfile/normalize) only
// dedupes the TOP-LEVEL array — it never recurses into a frame element's
// `properties.children`. Figma auto-names layers ("Text", "Rectangle", …),
// so a nested element commonly slugs to the same id as a top-level (or
// sibling-subtree) element, e.g. two "Text" layers both → "text". That
// collision survives past uniquifyElementIds and later breaks
// flattenElementsById: its flat id→element map is last-write-wins, so one
// of the colliding elements silently disappears from the diff, and
// coatfile's `compile.applyElementOverrides` (which itself recurses
// into frame children) applies the resulting delta to BOTH elements that
// share the id — the wrong element gets recolored on the printed card, with
// no warning (the id SETS still compare equal, so variant_structure_mismatch
// never fires).
//
// Fix: assign ids that are unique across the WHOLE side element tree (top-
// level AND every nested frame.properties.children), depth-first in
// traversal order — same collision-suffix scheme as uniquifyElementIds
// (`_2`, `_3`, … skipping ids already taken), just tracked in one Set that
// spans the whole tree instead of one per array. Deliberately kept local to
// the plugin (not folded into coatfile's uniquifyElementIds) since only
// the transpiler's by-id variant diff needs global-per-side uniqueness;
// coatfile's own `validate` only enforces per-frame (top-level)
// uniqueness, so this is strictly more unique and stays valid there.
//
// Because an instance mirrors the base's structure/order, running this SAME
// deterministic walk over the base side and every variant side yields
// identical id sequences, so flattenElementsById becomes collision-free and
// the diff aligns element-for-element.
function uniquifyElementIdsDeep(elements: unknown[]): unknown[] {
	const seen = new Set<string>();
	const walk = (els: unknown[]): void => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			const originalId = typeof el.id === "string" ? el.id : "";
			let id = originalId;
			if (seen.has(id)) {
				let n = 2;
				while (seen.has(`${originalId}_${n}`)) n += 1;
				id = `${originalId}_${n}`;
			}
			seen.add(id);
			el.id = id;
			for (const nested of nestedElementArrays(el)) walk(nested);
		}
	};
	walk(elements);
	return elements;
}

// Fill string of a background rect, when it's a plain solid (not a gradient).
function fillOf(bg: unknown): string | undefined {
	const b = bg as { properties?: { fill?: unknown } } | undefined;
	return typeof b?.properties?.fill === "string"
		? (b.properties.fill as string)
		: undefined;
}

function backgroundsDiffer(a: unknown, b: unknown): boolean {
	const ap = (a as { properties?: unknown } | undefined)?.properties;
	const bp = (b as { properties?: unknown } | undefined)?.properties;
	return JSON.stringify(ap) !== JSON.stringify(bp);
}

// Flattens an element tree (frame children nested) into an id → element map,
// so a colorway instance's side can be diffed against the base BY ELEMENT ID.
// Ids are unique per side (uniquifyElementIdsDeep, above, uniquifies across
// the WHOLE tree — top-level and nested frame children), so a single flat
// map is collision-free.
function flattenElementsById(
	elements: unknown[],
): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	const visit = (els: unknown[]) => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			if (typeof el.id === "string") map.set(el.id, el);
			for (const nested of nestedElementArrays(el)) visit(nested);
		}
	};
	visit(elements);
	return map;
}

// Shallow per-key diff of two elements' `properties` — collects only the keys
// whose (serialized) value differs, so an unchanged nested object (e.g. the
// same `font` re-produced by a fresh buildSideElements call) doesn't
// spuriously show up as a delta.
//
// A `frame` element's `properties.children` is EXCLUDED from this diff: every
// descendant is its own entry in flattenElementsById and gets its own,
// correctly-scoped delta from its own call to diffElementProperties. If we
// compared `children` here too, any single descendant change would make the
// whole subtree "differ" on the ancestor frame's key as well — duplicating
// the real per-descendant delta and bloating the emitted override with a
// full-subtree copy that applyElementOverrides doesn't even need (it already
// recurses into frame children independently).
function diffElementProperties(
	base: Record<string, unknown>,
	variant: Record<string, unknown>,
): Record<string, unknown> {
	const baseProps = (base.properties ?? {}) as Record<string, unknown>;
	const variantProps = (variant.properties ?? {}) as Record<string, unknown>;
	const isFrame = base.type === "frame" || variant.type === "frame";
	const isMask = base.type === "mask" || variant.type === "mask";
	const changed: Record<string, unknown> = {};
	for (const key of new Set([
		...Object.keys(baseProps),
		...Object.keys(variantProps),
	])) {
		if ((isFrame || isMask) && key === "children") continue;
		// A mask's shape is its own entry too, diffed by its own id.
		if (isMask && key === "mask") continue;
		if (JSON.stringify(baseProps[key]) !== JSON.stringify(variantProps[key])) {
			changed[key] = variantProps[key];
		}
	}
	return changed;
}

// The base elements a colorway hides, from the base nodes it hides (see
// alignInstanceVisibility) and the element each produced in the base walk.
// `top` holds the outermost of them, which carry `hidden: true`; `within`
// holds those and everything under them, which need no delta of their own
// since hiding an element hides its subtree.
function hiddenElements(
	elements: unknown[],
	trace: NodeTrace[],
	slot: string,
	hiddenNodes: Set<string>,
): { top: Set<string>; within: Set<string> } {
	const hiddenIds = new Set<string>();
	for (const t of trace) {
		if (t.slot === slot && t.elementId && hiddenNodes.has(t.nodeId))
			hiddenIds.add(t.elementId);
	}
	const top = new Set<string>();
	const within = new Set<string>();
	const visit = (els: unknown[], underHidden: boolean): void => {
		for (const raw of els) {
			const el = raw as Record<string, unknown>;
			const id = typeof el.id === "string" ? el.id : "";
			const isHidden = hiddenIds.has(id);
			if (isHidden && !underHidden) top.add(id);
			if (isHidden || underHidden) within.add(id);
			for (const nested of nestedElementArrays(el))
				visit(nested, underHidden || isHidden);
		}
	};
	if (hiddenIds.size > 0) visit(elements, false);
	return { top, within };
}

// The shell fields a variant delta can carry besides `properties`, each with
// the value an element that omits it has.
const SHELL_DEFAULTS = {
	pos: undefined,
	size: undefined,
	rotation: 0,
	opacity: 1,
} as const;

type ShellDelta = Omit<VariantElementDelta, "id" | "properties" | "hidden">;

// Two walks of the same layer can differ in the last bits of a float (the
// instance sits elsewhere on the page), which is not a change.
function sameValue(a: unknown, b: unknown): boolean {
	if (typeof a === "number" && typeof b === "number")
		return Math.abs(a - b) < 1e-6;
	if (a && b && typeof a === "object" && typeof b === "object") {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		for (const k of keys) {
			if (
				!sameValue(
					(a as Record<string, unknown>)[k],
					(b as Record<string, unknown>)[k],
				)
			)
				return false;
		}
		return true;
	}
	return a === b;
}

// The element's `pos`, `size`, `rotation` and `opacity` where the variant's
// differ from the base's. A frame child's position is its own: when a
// colorway resizes a frame, each child it moved differs here too, so it gets
// its own delta and nothing is re-placed from the parent's size.
function diffElementShell(
	base: Record<string, unknown>,
	variant: Record<string, unknown>,
): ShellDelta {
	const changed: Record<string, unknown> = {};
	for (const [key, fallback] of Object.entries(SHELL_DEFAULTS)) {
		const b = base[key] ?? fallback;
		const v = variant[key] ?? fallback;
		if (v !== undefined && !sameValue(b, v)) changed[key] = v;
	}
	return changed as ShellDelta;
}

// Recursively collects every `asset:` reference reachable inside a value (an
// emitted variant override, typically a `src` on a repainted raster image
// element). The kit's collectAssetRefs walks a whole template; this one walks
// an arbitrary override delta, to pin down exactly which of a variant side's
// rasterized assets must ride along in the bundle.
function collectAssetRefsDeep(value: unknown, out: Set<string>): void {
	if (typeof value === "string") {
		const sha = parseAssetUri(value);
		if (sha !== null) out.add(sha);
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) collectAssetRefsDeep(v, out);
		return;
	}
	if (value && typeof value === "object") {
		for (const v of Object.values(value)) collectAssetRefsDeep(v, out);
	}
}

export async function transpile(
	input: TranspileInput,
): Promise<TranspileOutput> {
	const start = Date.now();
	const warnings: TemplateWarning[] = [];
	const counts = { native: 0, flattened: 0, skipped: 0 };
	const allAssets: PendingAsset[] = [];
	// Every decision the walk made, across all slots, in visit order.
	const trace: NodeTrace[] = [];
	// All field metadata is registered here from node bindings (text/image/qr/
	// color), keyed by field id; first-wins across slots (front before back).
	const overlayMeta = new Map<string, FieldMeta>();
	const visibilityFields = new Set<string>();
	// Author-edited field metadata read from the slot frame's pluginData;
	// highest precedence at assembly. First-wins across slots (front before back).
	const storedMeta = new Map<string, FieldMeta>();

	const templateData: Array<{
		name: string;
		background: unknown;
		elements: unknown[];
	}> = [];
	const baseSideFrames: Record<string, FigmaContainerNode> = {};
	const baseElementsBySlot: Record<string, unknown[]> = {};
	const slotScale: Record<string, number> = {};
	const slotFileKey: Record<string, string> = {};
	// The canvas every slot shares. Under "exact" the product defines it and the
	// gate below rejects any frame that doesn't measure it; under "from-design"
	// the first slot's own measurement defines it and later slots must match.
	// Either way all sides end up on one canvas and one orientation.
	const sizeMode: SizeMode = input.sizeMode ?? "exact";
	let authorWidth = input.product.width;
	let authorHeight = input.product.height;

	// Pass 1 — fetch every slot's tree and settle the canvas.
	//
	// Sizing is resolved for ALL slots before any expensive work runs, and every
	// off-canvas frame is collected rather than thrown on sight: an author with
	// two wrong frames should see both, not fix one and re-run to discover the
	// other. The fetched trees are cached for pass 2 so a slot is never read
	// twice (fetchNodeTree is a map lookup in the plugin, but a REST call in
	// principle).
	const trees = new Map<string, FigmaContainerNode>();
	const sizeIssues: SizeIssue[] = [];
	let canvas: CanvasSize | null = null;
	for (const slot of input.product.frames) {
		const pick = input.picks[slot.name];
		if (!pick) {
			warnings.push({
				severity: "error",
				code: "missing_pick",
				message: `slot '${slot.name}' has no Figma pick`,
				slot: slot.name,
			});
			continue;
		}
		const fetched = await input.fetchNodeTree(pick.fileKey, pick.nodeId);
		trees.set(slot.name, fetched);
		const fw = fetched.absoluteBoundingBox.width;
		const fh = fetched.absoluteBoundingBox.height;
		const issue = (expectedWidth: number, expectedHeight: number): void => {
			sizeIssues.push({
				slot: slot.name,
				nodeId: pick.nodeId,
				nodeName: pick.nodeName,
				width: Math.round(fw),
				height: Math.round(fh),
				expectedWidth,
				expectedHeight,
			});
		};

		let size: CanvasSize;
		if (sizeMode === "from-design") {
			size = fromDesignSize(fw, fh);
		} else {
			const checked = exactSizeCheck(fw, fh, input.product);
			if (!checked.ok) {
				issue(checked.suggestedWidth, checked.suggestedHeight);
				continue;
			}
			size = checked;
		}
		// The first slot that resolves sets the canvas; the rest must match it.
		// This subsumes orientation — a portrait side against a landscape canvas
		// reads as "638×1013, resize to 1013×638", which is what the author does
		// about it anyway.
		if (canvas === null) canvas = size;
		else if (!sizesAgree(size, canvas)) issue(canvas.width, canvas.height);
	}
	if (sizeIssues.length > 0) {
		throw new SizeMismatchError(
			sizeMode === "from-design" ? "size_mismatch" : "exact_size",
			sizeIssues,
		);
	}
	if (canvas !== null) {
		authorWidth = canvas.width;
		authorHeight = canvas.height;
	}

	// Pass 2 — produce each slot's elements on the settled canvas.
	const slotGuides: Array<{ slot: string; guides: SlotGuides }> = [];
	for (const slot of input.product.frames) {
		const pick = input.picks[slot.name];
		const frame = trees.get(slot.name);
		if (!pick || !frame) continue; // missing_pick already warned in pass 1
		// Author-edited field metadata lives on the assigned slot root.
		if (frame.fieldMeta) {
			for (const [id, m] of Object.entries(frame.fieldMeta)) {
				if (!storedMeta.has(id)) storedMeta.set(id, m as FieldMeta);
			}
		}
		const scale = authorWidth / frame.absoluteBoundingBox.width;
		baseSideFrames[slot.name] = frame;
		slotScale[slot.name] = scale;
		slotFileKey[slot.name] = pick.fileKey;
		slotGuides.push({
			slot: slot.name,
			guides: readSlotGuides(frame, slot.name, scale, warnings),
		});

		const { background, elements } = await buildSideElements(frame, slot.name, {
			scale,
			fileKey: pick.fileKey,
			authorWidth,
			authorHeight,
			renderImage: input.renderImage,
			sink: {
				counts,
				warnings,
				overlayMeta,
				visibilityFields,
				assets: allAssets,
				trace,
			},
		});
		baseElementsBySlot[slot.name] = elements;

		templateData.push({ name: slot.name, background, elements });
	}
	const { bleed, safeArea } = combineGuides(
		slotGuides,
		{ width: authorWidth, height: authorHeight },
		warnings,
	);

	const variants: unknown[] = [];
	const variantPicks: Record<string, FigmaVariantPick> = {};

	const primarySlotName = input.product.frames[0]?.name;
	const defaultSwatch = primarySlotName
		? fillOf(
				backgroundFromFrame(
					baseSideFrames[primarySlotName],
					primarySlotName,
					authorWidth,
					authorHeight,
				),
			)
		: undefined;

	// Diffs a colorway instance's sides against the base BY ELEMENT ID (see
	// buildSideElements — an instance mirrors the base's child names/order, so
	// the same walk yields the same id sequence). Each side's element
	// production uses a throwaway sink so variant computation never touches
	// the real counts/warnings/field registration/pendingAssets.
	const buildVariantOverrides = async (
		colorway: ColorwayInput,
	): Promise<{
		overrides: Array<{
			name: string;
			background?: unknown;
			elements?: VariantElementDelta[];
		}>;
		swatch?: string;
		assets: PendingAsset[];
	}> => {
		const perSide = colorway.perSide;
		const overrides: Array<{
			name: string;
			background?: unknown;
			elements?: VariantElementDelta[];
		}> = [];
		let swatch = defaultSwatch;
		// A variant side still uses a throwaway sink for counts/warnings/field
		// registration (those belong to the base only), but its RASTERS are
		// real: when a variant repaints a flattened/static image (a recolored
		// icon strip, etc.) buildSideElements produces a fresh PNG with a new
		// sha256 and the diff emits `src: "asset:<newsha>"`. Those bytes must
		// ride along in the bundle or the override resolves to nothing at import
		// (unresolved_asset). Capture every raster produced here, then keep only
		// the ones an emitted override actually references.
		const producedAssets: PendingAsset[] = [];

		for (const slot of input.product.frames) {
			const frame = perSide[slot.name];
			if (!frame) continue;
			const scale =
				slotScale[slot.name] ?? authorWidth / frame.absoluteBoundingBox.width;
			const fileKey = slotFileKey[slot.name] ?? "";
			const baseFrame = baseSideFrames[slot.name];

			// Walk the instance with the base's visibility, so a layer it hides
			// still takes its place in the id sequence, and read what it hid.
			const aligned = baseFrame
				? alignInstanceVisibility(baseFrame, frame)
				: { frame, hiddenBaseNodes: new Set<string>(), unhidden: [] };
			for (const n of aligned.unhidden) {
				warnings.push({
					severity: "warn",
					code: "variant_unhide_unsupported",
					message: `Layer "${n.name}" is hidden on the card and shown in colorway "${colorway.label}". A colorway can hide a layer but not show one, so it stays hidden.`,
					nodeId: n.id,
					slot: slot.name,
				});
			}

			const sideSink = makeThrowawaySink();
			const { background: vBg, elements: vEls } = await buildSideElements(
				aligned.frame,
				slot.name,
				{
					scale,
					fileKey,
					authorWidth,
					authorHeight,
					renderImage: input.renderImage,
					sink: sideSink,
				},
			);
			for (const a of sideSink.assets) producedAssets.push(a);

			if (slot.name === primarySlotName) swatch = fillOf(vBg) ?? swatch;

			const baseBg = backgroundFromFrame(
				baseSideFrames[slot.name],
				slot.name,
				authorWidth,
				authorHeight,
			);
			const bgDiffers = backgroundsDiffer(vBg, baseBg);

			const baseElements = baseElementsBySlot[slot.name] ?? [];
			const hidden = hiddenElements(
				baseElements,
				trace,
				slot.name,
				aligned.hiddenBaseNodes,
			);
			const baseById = flattenElementsById(baseElements);
			const varById = flattenElementsById(vEls);
			// A hidden layer's own element can be missing from the instance's walk
			// (its raster was never exported), which is not a structural change.
			const baseIds = new Set(
				[...baseById.keys()].filter((id) => !hidden.within.has(id)),
			);
			const varIds = new Set(
				[...varById.keys()].filter((id) => !hidden.within.has(id)),
			);
			const sameStructure =
				baseIds.size === varIds.size &&
				[...baseIds].every((id) => varIds.has(id));
			if (!sameStructure) {
				warnings.push({
					severity: "warn",
					code: "variant_structure_mismatch",
					message: `colorway side "${slot.name}" has a different element structure than the base (elements added or removed) — only the elements present on both sides were diffed.`,
					slot: slot.name,
				});
			}

			const elementDeltas: VariantElementDelta[] = [];
			for (const [id, baseEl] of baseById) {
				if (hidden.top.has(id)) {
					elementDeltas.push({ id, properties: {}, hidden: true });
					continue;
				}
				if (hidden.within.has(id)) continue;
				const varEl = varById.get(id);
				if (!varEl) continue;
				const properties = diffElementProperties(baseEl, varEl);
				const shell = diffElementShell(baseEl, varEl);
				if (
					Object.keys(properties).length > 0 ||
					Object.keys(shell).length > 0
				) {
					elementDeltas.push({ id, properties, ...shell });
				}
			}

			if (bgDiffers || elementDeltas.length > 0) {
				overrides.push({
					name: slot.name,
					...(bgDiffers ? { background: vBg } : {}),
					...(elementDeltas.length > 0 ? { elements: elementDeltas } : {}),
				});
			}
		}

		// Only assets an emitted override actually points at need embedding.
		// Rasters whose bytes matched the base (same sha256, no delta emitted)
		// are already carried by the base and would just be de-duped anyway.
		const referenced = new Set<string>();
		for (const ov of overrides) collectAssetRefsDeep(ov, referenced);
		const assets = producedAssets.filter((a) => referenced.has(a.sha256));

		return { overrides, swatch, assets };
	};

	const colorways = input.variants ?? [];
	if (colorways.length > 0) {
		// The base card itself, so a picker has something to switch back to. It is
		// not a colorway instance, so it gets no variantPicks entry.
		variants.push({
			id: "default",
			label: "Default",
			...(defaultSwatch ? { swatch: defaultSwatch } : {}),
			overrides: [],
		});
		const takenIds = new Set(["default"]);
		for (const cw of colorways) {
			const { overrides, swatch, assets } = await buildVariantOverrides(cw);
			// Embed the recolored rasters this variant introduced; assembleBundle
			// de-dupes by sha256, so any that coincide with base rasters collapse.
			for (const a of assets) allAssets.push(a);
			const id = uniqueVariantId(cw.label, takenIds);
			variants.push({
				id,
				label: cw.label,
				...(swatch ? { swatch } : {}),
				overrides,
			});
			variantPicks[id] = { instanceId: cw.instanceId, label: cw.label };
		}
	}

	// Only the layers that did NOT come through as authored ride along in the
	// template: a native element is its own evidence, but a bitmap where a vector
	// was drawn needs to say why, long after the export.
	const decisions: ReportedDecision[] = trace
		.filter((t) => t.decision === "flatten" || t.decision === "skip")
		.map(({ slot: _slot, ...rest }) => rest);

	const fonts = collectFontDescriptors(templateData);

	// A field only an `if:` layer names is a toggle. One a layer also renders
	// keeps that layer's format, and its `if:` layers hide while it is blank.
	for (const id of visibilityFields) {
		if (!overlayMeta.has(id))
			overlayMeta.set(id, buildFieldMeta({ id, format: "boolean" }));
	}

	// Field schema is built from the registered binding metadata, in first-
	// registration (walk) order. Author-edited stored metadata wins over inferred.
	const properties: Record<string, unknown> = {};
	const required: string[] = [];
	for (const [id, inferred] of overlayMeta) {
		const stored = storedMeta.get(id);
		// The widget follows the element the field drives (a barcode's value is
		// entered as one), which stored metadata written before it may lack.
		const meta =
			stored && !stored.widget && inferred.widget && stored.format === "text"
				? { ...stored, widget: inferred.widget }
				: (stored ?? inferred);
		properties[id] = fieldMetaToSchema(meta);
		if (meta.required) required.push(id);
	}
	const fields = { type: "object" as const, properties, required };

	const template = {
		format_version: input.metadata.formatVersion,
		version: input.metadata.version,
		id: input.metadata.id,
		name: input.metadata.name,
		...(input.metadata.description !== undefined
			? { description: input.metadata.description }
			: {}),
		...(input.metadata.mood !== undefined ? { mood: input.metadata.mood } : {}),
		...(input.metadata.author !== undefined
			? { author: input.metadata.author }
			: {}),
		product: input.product.sku,
		width: authorWidth,
		height: authorHeight,
		...(bleed !== undefined ? { bleed } : {}),
		...(safeArea !== undefined ? { safeArea } : {}),
		fields,
		...(fonts.length > 0 ? { fonts } : {}),
		template_data: templateData,
		...(variants.length > 0 ? { variants } : {}),
	};

	return {
		template,
		pendingAssets: allAssets,
		fieldsInferred: Array.from(overlayMeta.entries()).map(([id, m]) => ({
			id,
			field: fieldMetaToSchema(m),
		})),
		warnings,
		variantPicks,
		report: {
			counts,
			durationMs: Date.now() - start,
			...(decisions.length > 0 ? { decisions } : {}),
		},
		trace,
	};
}
