import type { ElementAdjust, TemplateWarning } from "@freshcoat-js/coatfile";
import type {
	FigmaBoundingBox,
	FigmaImageFilters,
	FigmaImagePaint,
	FigmaRectangleNode,
} from "../types";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";
import { extractTokens, isWholeMustacheToken } from "./fields";

export type TranspileImageContext = {
	frame: FigmaBoundingBox;
	scale: number;
	worldAnchor?: { x: number; y: number };
};

function dynamicImageElement(
	tokenId: string,
	rect: {
		pos: { x: number; y: number };
		size: { width: number; height: number };
	},
	// Undefined for a plain solid-fill rect bound as an image (an `image:`
	// placeholder with no image fill) — default the fit in that case.
	fill: FigmaImagePaint | undefined,
	rotation: number,
	nodeId: string,
	warnings: TemplateWarning[],
) {
	// Field registration (incl. aspect) is done centrally from the node binding.
	const crop =
		fill?.scaleMode === "STRETCH"
			? cropFromTransform(fill.imageTransform, nodeId, warnings)
			: undefined;
	const fit: "cover" | "contain" | "fill" | "tile" = crop
		? "fill"
		: fill?.scaleMode === "FIT"
			? "contain"
			: fill?.scaleMode === "TILE"
				? "tile"
				: "cover";
	const adjust = fill?.filters
		? adjustFromFilters(fill.filters, nodeId, warnings)
		: undefined;
	return {
		id: tokenId,
		type: "image" as const,
		pos: rect.pos,
		size: rect.size,
		...(rotation !== 0 ? { rotation } : {}),
		...(adjust ? { adjust } : {}),
		properties: { src: `{{${tokenId}}}`, fit, ...(crop ? { crop } : {}) },
	};
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

// Figma's crop maps the layer's unit square into the image's, so an upright
// one's scale and translation are the region shown. A turned or skewed crop
// has no coatfile equivalent and falls back to cover.
export function cropFromTransform(
	t: FigmaImagePaint["imageTransform"],
	nodeId: string,
	warnings: TemplateWarning[],
): { x: number; y: number; width: number; height: number } | undefined {
	if (!t) return undefined;
	const [[a, b, tx], [c, d, ty]] = t;
	if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6 || a <= 0 || d <= 0) {
		warnings.push({
			severity: "warn",
			code: "image_crop_unsupported",
			message: "A rotated or skewed image crop was replaced by Fill.",
			nodeId,
		});
		return undefined;
	}
	const x = Math.min(Math.max(tx, 0), 1);
	const y = Math.min(Math.max(ty, 0), 1);
	const width = Math.min(a, 1 - x);
	const height = Math.min(d, 1 - y);
	if (width <= 0 || height <= 0) return undefined;
	if (x === 0 && y === 0 && width === 1 && height === 1) return undefined;
	return {
		x: round4(x),
		y: round4(y),
		width: round4(width),
		height: round4(height),
	};
}

const UNSUPPORTED_FILTERS = [
	"temperature",
	"tint",
	"highlights",
	"shadows",
] as const;

// Figma's exposure, contrast and saturation (each -1 to 1) as coatfile's
// factors. Figma documents no formula, so these are close readings rather
// than exact ones, and the other filters have no counterpart.
export function adjustFromFilters(
	f: FigmaImageFilters,
	nodeId: string,
	warnings: TemplateWarning[],
): ElementAdjust | undefined {
	const out: ElementAdjust = {};
	if (f.saturation) out.saturation = round4(Math.max(0, 1 + f.saturation));
	if (f.contrast) out.contrast = round4(Math.max(0, 1 + f.contrast));
	if (f.exposure) out.brightness = round4(2 ** f.exposure);
	const dropped = UNSUPPORTED_FILTERS.filter((k) => f[k]);
	if (dropped.length > 0)
		warnings.push({
			severity: "warn",
			code: "image_filter_unsupported",
			message: `Image ${dropped.join(", ")} adjustments were left out.`,
			nodeId,
		});
	if (Object.keys(out).length === 0) return undefined;
	warnings.push({
		severity: "info",
		code: "image_filter_approximated",
		message: "Image exposure, contrast and saturation are approximated.",
		nodeId,
	});
	return out;
}

export type TranspileImageResult =
	| {
			kind: "element";
			element: ReturnType<typeof dynamicImageElement>;
			warnings: TemplateWarning[];
	  }
	| { kind: "rasterize"; nodeId: string };

export function transpileImage(
	node: FigmaRectangleNode,
	ctx: TranspileImageContext,
	// The resolved image binding's value template, e.g. "{{avatar}}". Makes the
	// image dynamic regardless of how it was bound (bare-token name, `image:`
	// marker, or stored pluginData) — not just a bare-token layer name.
	imageTemplate?: string,
): TranspileImageResult {
	const fill = (node.fills ?? []).find(
		(f) => f.type === "IMAGE",
	) as FigmaImagePaint;

	const tokenMatch = isWholeMustacheToken(node.name);
	const tokenId =
		extractTokens(imageTemplate ?? "")[0] ??
		(tokenMatch.ok ? tokenMatch.id : undefined);
	if (tokenId) {
		// A dynamic image renders its content at fill time, so it is placed like a
		// native node: unrotated geometry + rotation as a real transform.
		const placed = ctx.worldAnchor
			? placeWorld(node, ctx.worldAnchor, ctx.scale)
			: placeLocal(node, ctx.scale);
		if ("fallback" in placed) throw new FlattenFallbackError(node.id);
		const rect = { pos: placed.pos, size: placed.size };
		const warnings: TemplateWarning[] = [];
		return {
			kind: "element",
			element: dynamicImageElement(
				tokenId,
				rect,
				fill,
				placed.rotation,
				node.id,
				warnings,
			),
			warnings,
		};
	}
	// Static placed image → rasterize this node to its own blob. The caller
	// places the raster at the node's absoluteRenderBounds (the exported region),
	// so no geometry placement is computed here.
	return { kind: "rasterize", nodeId: node.id };
}
