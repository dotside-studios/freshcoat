import type { BlendMode } from "@freshcoat-js/coatfile";
import type { FigmaBlendMode, FigmaNode, FigmaVectorNode } from "../types";
import { isContainerNode } from "../types";
import { isBarcodeLayerName } from "./barcode-name";
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
	| "multi_fill_flattened";

// Blend modes coatfile's element shell can carry, so a layer using one is
// emitted natively instead of rasterized. Everything else flattens.
// PASS_THROUGH is a group/frame's "no isolation", which is normal compositing
// for a single element; NORMAL and PASS_THROUGH both map to no blend at all.
// The coatfile blend mode for each Figma mode it can express. Linear burn
// has no Skia equivalent, so a layer using it is rasterized.
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

/** The coatfile blend mode a node composites with, or undefined for plain
 *  normal compositing. Only ever called for a node classify already accepted,
 *  so an unrecognized mode reads as normal rather than inventing one. */
type ElementBlendMode = Exclude<BlendMode, "normal"> | undefined;

export function elementBlendMode(n: FigmaNode): ElementBlendMode {
	const mode = BLEND_MODES[n.blendMode ?? "NORMAL"];
	return mode === "normal" ? undefined : mode;
}

// DROP_SHADOW, INNER_SHADOW and LAYER_BLUR lower to native coatfile
// primitives (Drawable.shadow — inset or not, with spread, stacked —
// and Drawable.blur). BACKGROUND_BLUR still flattens: it samples what is
// BEHIND the layer, which a per-drawable filter cannot see.
/** The one fill rule every region of a vector's geometry shares: undefined for
 *  nonzero (the default), "evenodd", or null when regions disagree. */
export function vectorFillRule(
	geometry: NonNullable<FigmaVectorNode["fillGeometry"]>,
): "evenodd" | undefined | null {
	const rules = new Set(geometry.map((g) => g.windingRule ?? "NONZERO"));
	if (rules.size > 1) return null;
	return rules.has("EVENODD") ? "evenodd" : undefined;
}

const SUPPORTED_EFFECT_TYPES = new Set([
	"DROP_SHADOW",
	"INNER_SHADOW",
	"LAYER_BLUR",
]);

function hasUnsupportedEffects(n: FigmaNode): boolean {
	if (!Array.isArray(n.effects)) return false;
	return n.effects.some(
		(e) => e.visible !== false && !SUPPORTED_EFFECT_TYPES.has(e.type),
	);
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

	const blend = n.blendMode ?? "NORMAL";
	if (!BLEND_MODES[blend])
		return { kind: "flatten", reason: "blend_mode_flattened" };
	if (hasUnsupportedEffects(n))
		return { kind: "flatten", reason: "effect_flattened" };
	if (hasUndecomposableTransform(n))
		return { kind: "flatten", reason: "transform_undecomposable_flattened" };

	if (n.type === "TEXT") {
		// Per-element fill must still be a single SOLID — coatfile text
		// has one base color (spans inherit it; per-character color overrides
		// aren't in our Figma type model yet).
		if (
			!Array.isArray(n.fills) ||
			n.fills.length !== 1 ||
			n.fills[0].type !== "SOLID"
		) {
			return { kind: "flatten", reason: "text_mixed_styling_flattened" };
		}
		// characterStyleOverrides → spans (coatfile handles font family /
		// size / weight / style / letterSpacing / lineHeight per span).
		return { kind: "native-text" };
	}

	if (n.type === "RECTANGLE") {
		// An `image:` marker makes a rect a dynamic image placeholder regardless
		// of its current fill — so a plain solid-gray `{{logo}}`/avatar box binds
		// as an image (the Layer-tab "Image" button writes this marker).
		if (isImageLayerName(n.name)) return { kind: "native-image" };

		const fills = n.fills ?? [];
		const visibleFills = fills.filter((f) => f.visible !== false);
		if (visibleFills.length === 0) return { kind: "native-rect" };

		// A single image fill is its own shape (native-image). Multiple image
		// fills, or an image fill mixed with other fills, still flatten — the
		// coatfile rect.fills array doesn't include image fills as a Fill
		// kind in v1.
		const imageFills = visibleFills.filter((f) => f.type === "IMAGE");
		if (
			imageFills.length === visibleFills.length &&
			visibleFills.length === 1
		) {
			const fill = visibleFills[0];
			if (fill.type === "IMAGE") {
				if (
					fill.scaleMode === "FILL" ||
					fill.scaleMode === "FIT" ||
					fill.scaleMode === "TILE"
				) {
					return { kind: "native-image" };
				}
				return { kind: "flatten", reason: "multi_fill_flattened" };
			}
		}
		if (imageFills.length > 0) {
			return { kind: "flatten", reason: "multi_fill_flattened" };
		}

		// All paint types here are SOLID / GRADIENT_LINEAR / GRADIENT_RADIAL —
		// multiple of these stack natively as fills[].
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
		return { kind: "native-frame" };
	}
	return { kind: "container" };
}
