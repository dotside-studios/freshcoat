import type {
	ElementAdjust,
	ImageProperties,
	TemplateWarning,
} from "@freshcoat-js/coatfile";
import type {
	FigmaBoundingBox,
	FigmaImageFilters,
	FigmaImagePaint,
	FigmaRectangleNode,
	FigmaVectorNode,
} from "../types";
import { strokeToElement } from "./colors";
import {
	FlattenFallbackError,
	placeLocal,
	placeWorld,
	translateLocal,
} from "./coordinates";
import { extractTokens, isWholeMustacheToken } from "./fields";
import { scaleCorners } from "./rect";

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
	shape: ImageShape,
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
		properties: {
			src: `{{${tokenId}}}`,
			fit,
			...(crop ? { crop } : {}),
			...shape,
		},
	};
}

type ImageShape = Pick<ImageProperties, "cornerRadius" | "mask" | "stroke">;

function imageShape(
	node: FigmaRectangleNode | FigmaVectorNode,
	size: { width: number; height: number },
	scale: number,
	warnings: TemplateWarning[],
): ImageShape {
	const stroke = strokeToElement(node, scale);
	const stroked =
		(node.strokeWeight ?? 0) > 0 &&
		(node.strokes ?? []).some((p) => p.visible !== false);
	if (!stroke && stroked)
		warnings.push({
			severity: "warn",
			code: "image_stroke_unsupported",
			message: "A gradient or image stroke on an image was left out.",
			nodeId: node.id,
		});
	const clip = imageClip(node, size, scale, warnings);
	return { ...clip, ...(stroke ? { stroke } : {}) };
}

function imageClip(
	node: FigmaRectangleNode | FigmaVectorNode,
	size: { width: number; height: number },
	scale: number,
	warnings: TemplateWarning[],
): Pick<ImageProperties, "cornerRadius" | "mask"> {
	if (node.type === "ELLIPSE")
		return { mask: size.width === size.height ? "circle" : "ellipse" };
	if (node.type === "POLYGON")
		return { mask: { kind: "polygon", sides: node.pointCount ?? 3 } };
	if (node.type !== "RECTANGLE") return {};
	const corners = scaleCorners(node.cornerRadius, scale);
	if (corners === undefined) return {};
	let radius: number;
	if (typeof corners === "number") radius = corners;
	else {
		// An image takes one radius for all four corners.
		radius = Math.max(...corners);
		if (corners.some((c) => c !== radius))
			warnings.push({
				severity: "warn",
				code: "image_corner_radius_approximated",
				message: `Image corners were rounded to ${radius} on every side.`,
				nodeId: node.id,
			});
	}
	if (node.cornerSmoothing) return { mask: { kind: "squircle", radius } };
	return { cornerRadius: radius };
}

// Figma stretches a polygon's vertices to fill its box, while the polygon mask
// puts them on the ellipse inscribed in its own box. This is the box, in the
// node's space, whose mask lands on Figma's vertices.
export function polygonMaskBox(
	sides: number,
	width: number,
	height: number,
): { x: number; y: number; width: number; height: number } {
	const xs: number[] = [];
	const ys: number[] = [];
	for (let i = 0; i < sides; i++) {
		const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
		xs.push(Math.cos(a));
		ys.push(Math.sin(a));
	}
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const spanX = Math.max(...xs) - minX;
	const spanY = Math.max(...ys) - minY;
	return {
		x: ((-minX - 1) * width) / spanX,
		y: ((-minY - 1) * height) / spanY,
		width: (2 * width) / spanX,
		height: (2 * height) / spanY,
	};
}

function maskGeometry<T extends FigmaRectangleNode | FigmaVectorNode>(
	node: T,
): T {
	if (node.type !== "POLYGON" || !node.pointCount) return node;
	const bb = node.absoluteBoundingBox;
	const box = polygonMaskBox(
		node.pointCount,
		node.width ?? bb.width,
		node.height ?? bb.height,
	);
	return {
		...node,
		width: box.width,
		height: box.height,
		absoluteBoundingBox: {
			x: bb.x + box.x,
			y: bb.y + box.y,
			width: box.width,
			height: box.height,
		},
		...(node.relativeTransform
			? {
					relativeTransform: translateLocal(
						node.relativeTransform,
						box.x,
						box.y,
					),
				}
			: {}),
		...(node.absoluteTransform
			? {
					absoluteTransform: translateLocal(
						node.absoluteTransform,
						box.x,
						box.y,
					),
				}
			: {}),
	};
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

// Figma's crop maps the layer's unit square into the image's, so an upright
// one's scale and translation are the region shown. A turned or skewed crop
// has no coatfile equivalent and falls back to cover.
function cropFromTransform(
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
function adjustFromFilters(
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
	node: FigmaRectangleNode | FigmaVectorNode,
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
		const geometry = maskGeometry(node);
		const placed = ctx.worldAnchor
			? placeWorld(geometry, ctx.worldAnchor, ctx.scale)
			: placeLocal(geometry, ctx.scale);
		if ("fallback" in placed) throw new FlattenFallbackError(node.id);
		const rect = { pos: placed.pos, size: placed.size };
		const warnings: TemplateWarning[] = [];
		const shape = imageShape(node, placed.size, ctx.scale, warnings);
		return {
			kind: "element",
			element: dynamicImageElement(
				tokenId,
				rect,
				fill,
				placed.rotation,
				shape,
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
