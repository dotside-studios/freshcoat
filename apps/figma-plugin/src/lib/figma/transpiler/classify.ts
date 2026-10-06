import type { BlendMode } from "@freshcoat-js/coatfile";
import type {
	FigmaBlendMode,
	FigmaEffect,
	FigmaNode,
	FigmaPaint,
	FigmaTextNode,
	FigmaVectorNode,
} from "../types";
import { isContainerNode } from "../types";
import { isBarcodeLayerName } from "./barcode-name";
import { compositeSolids, isMappablePaint, type PaintBox } from "./paint";
import { decomposeTransform, nodeExtent } from "./transform";

export type Classification =
	| { kind: "native-text" }
	| { kind: "native-rect" }
	| { kind: "native-image" }
	| { kind: "native-qr" }
	| { kind: "native-barcode" }
	| { kind: "native-vector" }
	| { kind: "native-frame" }
	| { kind: "container" }
	| { kind: "flatten"; reason: FlattenReason }
	| { kind: "skip" };

export type FlattenReason =
	| "text_mixed_styling_flattened"
	| "effect_flattened"
	| "blend_mode_flattened"
	| "vector_flattened"
	| "clip_overflow_flattened"
	| "transform_undecomposable_flattened"
	| "multi_fill_flattened"
	| "paint_flattened"
	| "stroke_flattened";

// PASS_THROUGH is a container's "no isolation", which is how the painter
// composites a frame already; on anything else it is plain normal.
const BLEND_MODES: Partial<
	Record<FigmaBlendMode, NonNullable<ElementBlendMode> | "normal">
> = {
	NORMAL: "normal",
	PASS_THROUGH: "normal",
	MULTIPLY: "multiply",
	SCREEN: "screen",
	OVERLAY: "overlay",
	DARKEN: "darken",
	LIGHTEN: "lighten",
	LINEAR_DODGE: "plus",
	LINEAR_BURN: "linear-burn",
	COLOR_DODGE: "color-dodge",
	COLOR_BURN: "color-burn",
	HARD_LIGHT: "hard-light",
	SOFT_LIGHT: "soft-light",
	DIFFERENCE: "difference",
	EXCLUSION: "exclusion",
	HUE: "hue",
	SATURATION: "saturation",
	COLOR: "color",
	LUMINOSITY: "luminosity",
};

type ElementBlendMode = Exclude<BlendMode, "normal"> | undefined;

/** The coatfile blend mode a node composites with, or undefined for plain
 *  normal compositing. Only ever called for a node classify already accepted,
 *  so an unrecognized mode reads as normal rather than inventing one. */
export function elementBlendMode(n: FigmaNode): ElementBlendMode {
	const mode = BLEND_MODES[n.blendMode ?? "NORMAL"];
	return mode === "normal" ? undefined : mode;
}

function isBlended(n: FigmaNode): boolean {
	const blend = n.blendMode ?? "NORMAL";
	return blend !== "NORMAL" && blend !== "PASS_THROUGH";
}

function hasVisibleEffects(n: FigmaNode): boolean {
	return (n.effects ?? []).some((e) => e.visible !== false);
}

// Whether a layer inside a container blends with what lies beneath it, seen
// from the container: a blended child counts, and so does one inside a
// pass-through container that does not isolate it on the way up.
function hasBlendedDescendant(n: FigmaNode): boolean {
	if (!isContainerNode(n)) return false;
	return n.children.some((c) => {
		if (c.visible === false || c.opacity === 0) return false;
		if (isBlended(c)) return true;
		const passesThrough =
			(c.blendMode ?? "PASS_THROUGH") === "PASS_THROUGH" &&
			(c.opacity ?? 1) >= 1 &&
			!hasVisibleEffects(c);
		return passesThrough && hasBlendedDescendant(c);
	});
}

// Figma draws a container set to Normal into a layer of its own, so a blended
// layer inside mixes only with the container's own content. The painter gives
// a frame a layer only for opacity, an effect or a blend of its own; without
// one, the blended layer would mix with whatever lies behind the container.
function isolationDiffers(n: FigmaNode): boolean {
	return (
		isContainerNode(n) &&
		n.blendMode === "NORMAL" &&
		(n.opacity ?? 1) >= 1 &&
		!hasVisibleEffects(n) &&
		hasBlendedDescendant(n)
	);
}

function blendFlattens(n: FigmaNode): boolean {
	if (!BLEND_MODES[n.blendMode ?? "NORMAL"]) return true;
	return isolationDiffers(n);
}

/** The one fill rule every region of a vector's geometry shares: undefined for
 *  nonzero (the default), "evenodd", or null when regions disagree. */
export function vectorFillRule(
	geometry: NonNullable<FigmaVectorNode["fillGeometry"]>,
): "evenodd" | undefined | null {
	const rules = new Set(geometry.map((g) => g.windingRule ?? "NONZERO"));
	if (rules.size > 1) return null;
	return rules.has("EVENODD") ? "evenodd" : undefined;
}

// DROP_SHADOW, INNER_SHADOW and LAYER_BLUR lower to the element's shadow stack
// and blur. BACKGROUND_BLUR samples what is behind the layer, which a filter on
// the layer cannot see. A progressive blur ramps its radius and a shadow with
// its own blend mode composites apart from its layer, neither of which the
// element's blur and shadow can say. Newer kinds (noise, texture, glass) have
// no equivalent.
function isUnsupportedEffect(e: FigmaEffect): boolean {
	if (e.visible === false) return false;
	if (e.type === "LAYER_BLUR") return e.blurType === "PROGRESSIVE";
	if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
		return e.blendMode !== undefined && e.blendMode !== "NORMAL";
	return true;
}

function hasUnsupportedEffects(n: FigmaNode): boolean {
	if (!Array.isArray(n.effects)) return false;
	return n.effects.some(isUnsupportedEffect);
}

// A node whose transform can't be decomposed into rotation + translation
// (skew / non-uniform scale) has no clean {pos,size,rotation} — placeLocal/
// placeWorld return { fallback: "flatten" } and the native transpilers can't
// emit it. Detect it HERE (the single classify decision both the transpiler
// walk and the main-thread `collectRasterTargets` share) so both agree to
// rasterize it — otherwise main never exports the node and the UI-side
// rasterizer has no bytes for it. Checks both the parent-local and world
// transforms since a slot's direct children place via the world one.
function hasUndecomposableTransform(n: FigmaNode): boolean {
	const extent = nodeExtent(n);
	if (
		n.relativeTransform &&
		!decomposeTransform(n.relativeTransform, extent).ok
	) {
		return true;
	}
	if (
		n.absoluteTransform &&
		!decomposeTransform(n.absoluteTransform, extent).ok
	) {
		return true;
	}
	return false;
}

function paintBox(n: FigmaNode): PaintBox {
	return {
		width: n.width ?? n.absoluteBoundingBox.width,
		height: n.height ?? n.absoluteBoundingBox.height,
	};
}

// An image fill has no place in a fill stack, and some paints (a diamond
// gradient, an unevenly swept angular one, a paint with its own blend mode)
// have no coatfile fill at all.
function fillsFlattenReason(
	fills: FigmaPaint[] | undefined,
	box: PaintBox,
): FlattenReason | undefined {
	const visible = (fills ?? []).filter((f) => f.visible !== false);
	if (visible.length > 1 && visible.some((f) => f.type === "IMAGE"))
		return "multi_fill_flattened";
	if (visible.some((f) => !isMappablePaint(f, box))) return "paint_flattened";
	return undefined;
}

// coatfile strokes take one colour, so only solid paints composite into one.
function strokeFlattens(n: {
	strokes?: FigmaPaint[];
	strokeWeight?: number;
}): boolean {
	if (!(n.strokeWeight !== undefined && n.strokeWeight > 0)) return false;
	const visible = (n.strokes ?? []).filter((p) => p.visible !== false);
	return visible.length > 0 && compositeSolids(visible) === null;
}

// coatfile carries a colour per span but a gradient only for the whole
// element, so each run's paints must come down to one colour, or the whole
// text must share one gradient.
function textIsNative(n: FigmaTextNode): boolean {
	const runFills = Object.values(n.styleOverrideTable ?? {})
		.map((o) => o.fills)
		.filter((f): f is FigmaPaint[] => f !== undefined);
	if (compositeSolids(n.fills) !== null)
		return runFills.every((f) => compositeSolids(f) !== null);
	const visible = n.fills.filter((f) => f.visible !== false);
	if (visible.length !== 1 || visible[0].type === "IMAGE") return false;
	if (!isMappablePaint(visible[0], paintBox(n))) return false;
	const base = JSON.stringify(n.fills);
	return runFills.every((f) => JSON.stringify(f) === base);
}

export function isQrLayerName(name: string): boolean {
	return /^qr:.+/.test(name);
}

export function isImageLayerName(name: string): boolean {
	return /^image:.+/.test(name);
}

export function classify(n: FigmaNode): Classification {
	if (n.visible === false) return { kind: "skip" };
	if (n.opacity === 0) return { kind: "skip" };

	// A `qr:` or `barcode:` name marks a code placeholder: only its name (the
	// encoded value) and bounding box matter — the modules are regenerated at
	// render time, so the node's own type, paint, blend, and effects are
	// irrelevant. Detect them before any of those branches so authors can name
	// *any* layer `qr:…` or `barcode:…`.
	if (isBarcodeLayerName(n.name)) return { kind: "native-barcode" };
	if (isQrLayerName(n.name)) return { kind: "native-qr" };

	if (blendFlattens(n))
		return { kind: "flatten", reason: "blend_mode_flattened" };
	if (hasUnsupportedEffects(n))
		return { kind: "flatten", reason: "effect_flattened" };
	if (hasUndecomposableTransform(n))
		return { kind: "flatten", reason: "transform_undecomposable_flattened" };

	if (n.type === "TEXT") {
		if (!textIsNative(n))
			return { kind: "flatten", reason: "text_mixed_styling_flattened" };
		return { kind: "native-text" };
	}

	if (n.type === "RECTANGLE") {
		// An `image:` marker makes a rect a dynamic image placeholder regardless
		// of its current fill — so a plain solid-gray `{{logo}}`/avatar box binds
		// as an image (the Layer-tab "Image" button writes this marker).
		if (isImageLayerName(n.name)) return { kind: "native-image" };

		const visibleFills = (n.fills ?? []).filter((f) => f.visible !== false);
		if (visibleFills.length === 1 && visibleFills[0].type === "IMAGE") {
			const blend = visibleFills[0].blendMode;
			if (blend && blend !== "NORMAL")
				return { kind: "flatten", reason: "paint_flattened" };
			return { kind: "native-image" };
		}
		const reason = fillsFlattenReason(n.fills, paintBox(n));
		if (reason) return { kind: "flatten", reason };
		if (strokeFlattens(n))
			return { kind: "flatten", reason: "stroke_flattened" };
		return { kind: "native-rect" };
	}

	if (
		n.type === "VECTOR" ||
		n.type === "BOOLEAN_OPERATION" ||
		n.type === "STAR" ||
		n.type === "POLYGON" ||
		n.type === "LINE" ||
		n.type === "ELLIPSE"
	) {
		// Without fillGeometry there's nothing to emit. Every region merges into
		// one `d` under one fill rule, so regions that disagree on theirs cannot.
		if (!Array.isArray(n.fillGeometry) || n.fillGeometry.length === 0) {
			return { kind: "flatten", reason: "vector_flattened" };
		}
		if (vectorFillRule(n.fillGeometry) === null) {
			return { kind: "flatten", reason: "vector_flattened" };
		}
		const reason = fillsFlattenReason(n.fills, paintBox(n));
		if (reason) return { kind: "flatten", reason };
		if (strokeFlattens(n))
			return { kind: "flatten", reason: "stroke_flattened" };
		return { kind: "native-vector" };
	}

	// Remaining: FRAME / GROUP / COMPONENT / INSTANCE / COMPONENT_SET (containers).
	// GROUPs are coordinate-transparent in Figma: a group does NOT establish its
	// own coordinate space, so its descendants' relativeTransform is relative to
	// the nearest FRAME ancestor, not the group. We flatten GROUPs (pass-through)
	// up to the nearest emitted frame — nesting them and placing children parent-
	// local would double-count the group's own offset. FRAME / COMPONENT /
	// INSTANCE / COMPONENT_SET DO establish their own coordinate space, so they
	// nest as frame elements and the painter composes transforms through them.
	if (isContainerNode(n)) {
		if (n.type === "GROUP") return { kind: "container" };
		const reason = fillsFlattenReason(n.fills, paintBox(n));
		if (reason) return { kind: "flatten", reason };
		if (strokeFlattens(n))
			return { kind: "flatten", reason: "stroke_flattened" };
		return { kind: "native-frame" };
	}
	return { kind: "container" };
}
