import type { TemplateWarning } from "@freshcoat-js/coatfile";
import type { PendingAsset } from "@freshcoat-js/coatfile/assets";
import {
	type FieldMeta,
	inferNodeBinding,
	parseVisibilityMarker,
	storedToNodeBinding,
} from "../binding";
import type { FigmaConstraints, FigmaContainerNode, FigmaNode } from "../types";
import {
	isContainerNode,
	isRectangleNode,
	isTextNode,
	isVectorNode,
} from "../types";
import { transpileBarcode } from "./barcode";
import { isBarcodeLayerName } from "./barcode-name";
import { applyBindingOverlay } from "./binding-overlay";
import {
	type Classification,
	classify,
	elementBlendMode,
	type FlattenReason,
	hasTextStroke,
	isQrLayerName,
} from "./classify";
import type { FlattenMarker } from "./coalesce";
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
import { addVisibility, maskRuns } from "./finalize";
import { layoutChildFromNode, transpileFrame } from "./frame";
import { withoutGuides } from "./guides";
import { transpileImage } from "./image";
import { canHoldImage } from "./image-shape";
import { transpileQr } from "./qr";
import { transpileRect } from "./rect";
import { textLayoutSizing, transpileText } from "./text";
import { decomposeTransform, nodeExtent } from "./transform";
import type { NodeTrace } from "./types";
import { transpileVector } from "./vector";

// Mutable outputs a side's element production writes into. The base slot
// loop passes the REAL outer accumulators (counts/warnings/overlayMeta feed
// the report + field schema; assets feed pendingAssets); a colorway
// instance's side passes a THROWAWAY sink so variant production doesn't
// double-count, re-warn, re-register fields, or duplicate assets — the
// side's elements are only used locally to diff against the base.
export type ElementSink = {
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
export type TraceEntry = NodeTrace & { el?: Record<string, unknown> };

export function makeThrowawaySink(): ElementSink {
	return {
		counts: { native: 0, flattened: 0, skipped: 0 },
		warnings: [],
		overlayMeta: new Map(),
		visibilityFields: new Set(),
		assets: [],
		trace: [],
	};
}

// A container's rotation in world, degrees. Only ever asked of a frame the walk
// already emitted, so the transform is known to decompose; a matrix that somehow
// doesn't reads as unrotated, which is what the upright placement path assumes
// anyway.
function worldRotationOf(n: FigmaContainerNode): number {
	if (!n.absoluteTransform) return 0;
	const d = decomposeTransform(n.absoluteTransform, nodeExtent(n));
	return d.ok ? d.rotation : 0;
}

// A rasterized region has to paint in the z-order its node occupied — a
// flattened backdrop belongs UNDER the text drawn over it in Figma, and a
// batch of rasters appended after the walk would bury every native element
// on the card. The bytes only arrive after the walk (rasterizing is async and
// batched per side), so the walk parks a placeholder in the array it is
// filling and records the slot; the raster drops into that exact position
// once its bytes land, and an unfilled slot is pruned before the side is
// emitted.
type RasterSlot = { container: unknown[]; index: number };
function reserveSlot(container: unknown[]): RasterSlot {
	const index = container.length;
	container.push({ __rasterSlot: true });
	return { container, index };
}
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
export function fillSlot(
	slot: RasterSlot,
	element: unknown,
): Record<string, unknown> {
	const placeholder = slot.container[slot.index] as Record<string, unknown>;
	const merged = { ...(element as Record<string, unknown>) };
	for (const key of CARRIED) {
		if (placeholder[key] !== undefined) merged[key] = placeholder[key];
	}
	slot.container[slot.index] = merged;
	return merged;
}

type SlottedMarker = FlattenMarker & { slot: RasterSlot; entry: TraceEntry };
type StaticImageMarker = {
	nodeId: string;
	pos: { x: number; y: number };
	size: { width: number; height: number };
	rotation: number;
	slot: RasterSlot;
	entry: TraceEntry;
};

// The state one side's walk shares across its recursive calls.
export type Walker = {
	frame: FigmaContainerNode;
	slotName: string;
	scale: number;
	sink: ElementSink;
	constraintScope: ConstraintScope;
	flattenMarkers: SlottedMarker[];
	staticImageMarkers: StaticImageMarker[];
};

export function createWalker(
	frame: FigmaContainerNode,
	slotName: string,
	scale: number,
	sink: ElementSink,
): Walker {
	return {
		frame,
		slotName,
		scale,
		sink,
		constraintScope: { autoLayout: false },
		flattenMarkers: [],
		staticImageMarkers: [],
	};
}

// One line per node the walk reached, in visit order. Recorded for EVERY
// decision, including the ones that produce nothing — "this layer was skipped
// because it is invisible" is exactly the answer that was missing.
function record(
	w: Walker,
	n: FigmaNode,
	decision: Classification["kind"],
	reason?: FlattenReason,
): TraceEntry {
	const entry: TraceEntry = {
		slot: w.slotName,
		nodeId: n.id,
		name: n.name,
		nodeType: n.type,
		decision,
		...(reason ? { reason } : {}),
	};
	w.sink.trace.push(entry);
	return entry;
}

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
function withConstraintScope(
	w: Walker,
	next: ConstraintScope,
	fn: () => void,
): void {
	const prev = w.constraintScope;
	w.constraintScope = next;
	try {
		fn();
	} finally {
		w.constraintScope = prev;
	}
}
function groupScope(w: Walker, group: FigmaContainerNode): ConstraintScope {
	return {
		inherited: w.constraintScope.inherited ?? groupConstraints(group),
		autoLayout:
			w.constraintScope.autoLayout && group.layoutPositioning !== "ABSOLUTE",
	};
}
function constraintsFor(
	w: Walker,
	n: FigmaNode,
): ReturnType<typeof elementConstraints> {
	if (w.constraintScope.autoLayout && n.layoutPositioning !== "ABSOLUTE")
		return undefined;
	const source =
		w.constraintScope.inherited ??
		(isContainerNode(n) && n.type === "GROUP"
			? groupConstraints(n)
			: n.constraints);
	return elementConstraints(source);
}
function applyConstraints(
	w: Walker,
	el: Record<string, unknown>,
	n: FigmaNode,
): void {
	const c = constraintsFor(w, n);
	if (c) el.constraints = c;
}

// Figma composites every node with its own opacity, on top of whatever its
// fills already carry. A GROUP applies its opacity to everything inside it,
// and a group has no element of its own here (it is flattened away for
// having no coordinate space), so its opacity is folded into each descendant
// rather than dropped — a background group at 35% whose children are emitted
// opaque paints roughly three times as strongly as the design does.
function applyOpacity(el: Record<string, unknown>, factor: number): void {
	const combined = factor * ((el.opacity as number) ?? 1);
	if (combined < 1) el.opacity = Math.round(combined * 1000) / 1000;
}
function opacityOf(n: FigmaNode): number {
	return typeof n.opacity === "number" ? n.opacity : 1;
}

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
function placeRaster(
	w: Walker,
	n: FigmaNode,
	coordFrame: RasterFrame,
	target: unknown[],
	// Only what ANCESTORS owe: exportAsync renders the node itself, so its own
	// opacity is already in the pixels and applying it again would double it.
	inheritedOpacity: number,
) {
	const placed = placeRasterIn(renderBoundsOf(n), coordFrame, w.scale);
	// A region with no area draws nothing, and Figma exports it as a 1×1
	// transparent pixel — an element that costs the author a shape and an
	// asset while rendering as a hole. Say so instead of emitting it.
	if (placed.size.width <= 0 || placed.size.height <= 0) {
		w.sink.warnings.push({
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
	applyConstraints(w, placeholder, n);
	return { ...placed, slot };
}

// walkNode takes the local coordinate frame (the space children's pos is
// measured in — its box, and how that box sits in the world) and the target
// array to push native elements into.
function walkNode(
	w: Walker,
	n: FigmaNode,
	localFrame: RasterFrame,
	target: unknown[],
	worldAnchor: { x: number; y: number } | null,
	// Opacity owed by ancestors this walk flattened away (GROUPs). A FRAME
	// carries its own on its element, so it resets this to 1 for its subtree.
	inheritedOpacity: number,
) {
	const { scale } = w;
	const c = classify(n);
	if (c.kind === "skip") {
		w.sink.counts.skipped++;
		record(w, n, "skip");
		// A hidden/transparent qr: layer signals clear intent but renders
		// nothing — surface it rather than dropping it silently.
		if (isQrLayerName(n.name)) {
			w.sink.warnings.push({
				severity: "warn",
				code: "qr_layer_hidden",
				message: `QR layer "${n.name}" is hidden or fully transparent, so it was skipped. Make it visible to include the QR.`,
				nodeId: n.id,
			});
		}
		if (isBarcodeLayerName(n.name)) {
			w.sink.warnings.push({
				severity: "warn",
				code: "barcode_layer_hidden",
				message: `Barcode layer "${n.name}" is hidden or fully transparent, so it was skipped. Make it visible to include the barcode.`,
				nodeId: n.id,
			});
		}
		return;
	}
	if (c.kind === "container") {
		const containerEntry = record(w, n, "container");
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
			const el = groupLayer(
				w,
				n,
				fx,
				localFrame,
				worldAnchor,
				inheritedOpacity,
			);
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
		withConstraintScope(w, groupScope(w, n), () =>
			walkChildren(
				w,
				n.children,
				localFrame,
				target,
				worldAnchor,
				childOpacity,
			),
		);
		return;
	}
	// Park the node's bitmap where its element would have gone, and record it
	// as flattened. `entry` is reused when the decision was reached AFTER the
	// node had already been recorded as native (see the catch below), so one
	// node still produces exactly one trace line.
	const flattenTo = (reason: FlattenReason, entry: TraceEntry): void => {
		w.sink.counts.flattened++;
		const placed = placeRaster(w, n, localFrame, target, inheritedOpacity);
		if (!placed) return;
		w.flattenMarkers.push({
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
		flattenTo(c.reason, record(w, n, "flatten", c.reason));
		return;
	}
	w.sink.counts.native++;
	const entry = record(w, n, c.kind);
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
				w.sink.warnings.push({
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
				for (const warning of r.warnings) w.sink.warnings.push(warning);
			} else {
				// Static placed image — rasterized, and parked exactly the way a
				// flattened region is.
				const placed = placeRaster(w, n, localFrame, target, inheritedOpacity);
				if (placed) {
					w.staticImageMarkers.push({
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
			for (const warning of r.warnings) w.sink.warnings.push(warning);
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
			withConstraintScope(w, childScope, () =>
				walkChildren(
					w,
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
		w.sink.counts.native--;
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
		applyConstraints(w, el, n);
		applyBindingOverlay(n, el, w.sink.overlayMeta);
		entry.el = el;
		target.push(el);
	}
}

// A layer named `if:{{field}}` shows only while the field is set. Everything
// the layer produced takes the condition: a group flattens into its parent's
// array, so each of its children carries it, and a raster placeholder hands
// it on to the bitmap that fills it.
function walk(...args: Parameters<typeof walkNode>): void {
	const [w, n, , target] = args;
	const cond = parseVisibilityMarker(n.name);
	const before = target.length;
	walkNode(...args);
	if (!cond) return;
	w.sink.visibilityFields.add(cond.field);
	for (let i = before; i < target.length; i++)
		addVisibility(target[i] as Record<string, unknown>, cond);
}

// A GROUP that has to composite as one layer, because it carries an effect
// that belongs to everything in it at once rather than to each child.
//
// Figma gives a group NO coordinate space — its children are positioned
// against the enclosing FRAME — so the box invented for it here is simply the
// extent it covers in that space, and it is never rotated (an AABB has no
// rotation; each child still carries its own). Everything inside continues to
// place exactly as it did, then shifts onto that box via `originOffset`.
function groupLayer(
	w: Walker,
	n: FigmaContainerNode,
	fx: ReturnType<typeof extractEffects>,
	localFrame: RasterFrame,
	worldAnchor: { x: number; y: number } | null,
	inheritedOpacity: number,
): Record<string, unknown> | undefined {
	const { scale } = w;
	// A slot's direct children place in the stripped world space (the slot's
	// own rotation is discarded), where the group's world AABB already IS its
	// box; deeper down, its footprint in the enclosing frame is.
	const box = worldAnchor
		? toAuthorSpace(n.absoluteBoundingBox, w.frame.absoluteBoundingBox, scale)
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
	applyConstraints(w, el, n);

	const inner: RasterFrame = { ...localFrame, originOffset: box.pos };
	withConstraintScope(w, groupScope(w, n), () =>
		walkChildren(
			w,
			n.children,
			inner,
			(el.properties as { children: unknown[] }).children,
			worldAnchor,
			1,
		),
	);
	return el;
}

// Walk one parent's children in order, turning each Figma mask run into a
// mask element. `each` sees the node that led each run (the mask layer, or a
// lone child) and where in `target` its output starts.
function walkChildren(
	w: Walker,
	children: FigmaNode[],
	localFrame: RasterFrame,
	target: unknown[],
	worldAnchor: { x: number; y: number } | null,
	inheritedOpacity: number,
	each?: (node: FigmaNode, before: number) => void,
): void {
	for (const run of maskRuns(children)) {
		const before = target.length;
		if (run.masked)
			maskLayer(
				w,
				run.node,
				run.masked,
				localFrame,
				target,
				worldAnchor,
				inheritedOpacity,
			);
		else walk(w, run.node, localFrame, target, worldAnchor, inheritedOpacity);
		each?.(run.node, before);
	}
}

// A Figma mask: the mask layer is not drawn, and its coverage decides how
// much of the layers above it shows. Its box is the mask element's, and like
// a group given its own layer, everything inside places against the enclosing
// frame and then shifts onto that box via `originOffset`. The shape collects
// into an array for now, since a rasterized one is a slot the bitmap drops
// into later; finalizeMasks settles it once every raster has landed.
function maskLayer(
	w: Walker,
	maskNode: FigmaNode,
	masked: FigmaNode[],
	localFrame: RasterFrame,
	target: unknown[],
	worldAnchor: { x: number; y: number } | null,
	inheritedOpacity: number,
): void {
	const { scale } = w;
	const box = worldAnchor
		? toAuthorSpace(
				maskNode.absoluteBoundingBox,
				w.frame.absoluteBoundingBox,
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
	applyConstraints(w, el, maskNode);
	const inner: RasterFrame = { ...localFrame, originOffset: box.pos };
	walk(w, maskNode, inner, shape, worldAnchor, 1);
	for (const child of masked) walk(w, child, inner, children, worldAnchor, 1);
	target.push(el);
}

// The slot frame's own rotation is stripped — it becomes the axis-aligned
// card — so its children live in plain world space, anchored to its AABB.
export function walkSide(w: Walker): unknown[] {
	const elements: unknown[] = [];
	const slotFrame: RasterFrame = {
		box: w.frame.absoluteBoundingBox,
		transform: null,
		rotation: 0,
	};
	walkChildren(
		w,
		withoutGuides(w.frame.children ?? []),
		slotFrame,
		elements,
		{
			x: w.frame.absoluteBoundingBox.x,
			y: w.frame.absoluteBoundingBox.y,
		},
		1,
	);
	return elements;
}
