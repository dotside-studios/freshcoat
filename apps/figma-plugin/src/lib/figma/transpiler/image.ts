import { extractTokens } from "../binding";
import type {
	FigmaBoundingBox,
	FigmaImagePaint,
	FigmaRectangleNode,
} from "../types";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";
import { isWholeMustacheToken } from "./fields";

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
) {
	// Field registration (incl. aspect) is done centrally from the node binding.
	const fit: "cover" | "contain" | "tile" =
		fill?.scaleMode === "FIT"
			? "contain"
			: fill?.scaleMode === "TILE"
				? "tile"
				: "cover";
	return {
		id: tokenId,
		type: "image" as const,
		pos: rect.pos,
		size: rect.size,
		...(rotation !== 0 ? { rotation } : {}),
		properties: { src: `{{${tokenId}}}`, fit },
	};
}

export type TranspileImageResult =
	| { kind: "element"; element: ReturnType<typeof dynamicImageElement> }
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
		return {
			kind: "element",
			element: dynamicImageElement(tokenId, rect, fill, placed.rotation),
		};
	}
	// Static placed image → rasterize this node to its own blob. The caller
	// places the raster at the node's absoluteRenderBounds (the exported region),
	// so no geometry placement is computed here.
	return { kind: "rasterize", nodeId: node.id };
}
