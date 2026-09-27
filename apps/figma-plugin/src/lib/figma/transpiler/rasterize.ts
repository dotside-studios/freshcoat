import { assetUri, type PendingAsset } from "@freshcoat-js/coatfile/assets";
import type { FlattenMarker } from "./coalesce";

export type RenderRequest = {
	fileKey: string;
	nodeIds: string[];
	scale: number;
	format: "png";
};

export type RenderResult = {
	blob: Blob;
	sha256: string;
	// Pixel dimensions of the returned bitmap, when the caller can supply them
	// cheaply. Lets a marker whose export came back empty be dropped instead of
	// emitted; omitted means "unknown", and no emptiness check runs.
	width?: number;
	height?: number;
};

export type RenderImageFn = (req: RenderRequest) => Promise<RenderResult>;

export type RasterizeInput = {
	fileKey: string;
	markers: FlattenMarker[];
	scale: number;
	renderImage: RenderImageFn;
};

export type RasterElement = {
	id: string;
	type: "image";
	pos: { x: number; y: number };
	size: { width: number; height: number };
	rotation?: number;
	properties: { src: string; fit: "fill" };
};

export type RasterizeOutput = {
	// One entry per input marker, IN ORDER, so a caller can put each bitmap back
	// where its node was. null where the marker produced nothing usable — see
	// `skipped` and `empty` for which.
	elements: Array<RasterElement | null>;
	assets: PendingAsset[];
	// Node ids whose raster was unavailable (renderImage threw — e.g. the main
	// thread didn't pre-export it). The marker is skipped so generation still
	// succeeds; the caller surfaces a warning rather than crashing the export.
	skipped: string[];
	// Node ids whose export came back with no content. The caller warns; the
	// marker is dropped rather than stretching an empty bitmap over the region
	// it claimed.
	empty: string[];
};

/** Whether an export carries no content. Figma answers an export of a node that
 *  renders nothing with a 1×1 transparent pixel instead of an error, and every
 *  raster is exported at a scale of at least 1, so a bitmap this small can only
 *  have come from a region that draws nothing. */
export function isEmptyRaster(result: RenderResult): boolean {
	if (result.width === undefined || result.height === undefined) return false;
	return result.width <= 1 && result.height <= 1;
}

// A colorway INSTANCE's sublayer id is `I<instanceId>;<baseNodeId>`, while the
// base card's node is just `<baseNodeId>`. Key a rasterized element's id on the
// INNERMOST id (after the last `;`) so a flatten/image element aligns between
// the base and its variant instances — otherwise the variant diff sees them as
// different elements and can't override the raster (e.g. a white logo swapped in
// on a dark colorway). Colons → underscores for a valid element id slug. The
// marker's full `nodeId` is still used to look up the pre-exported bytes.
export function rasterElementId(prefix: string, nodeId: string): string {
	const innermost = nodeId.split(";").pop() ?? nodeId;
	return `${prefix}_${innermost.replace(/:/g, "_")}`;
}

export async function rasterizeMarkers(
	input: RasterizeInput,
): Promise<RasterizeOutput> {
	const elements: RasterizeOutput["elements"] = [];
	const assets: PendingAsset[] = [];
	const skipped: string[] = [];
	const empty: string[] = [];

	// Each marker is a single pre-exported node, so render it on its own. A
	// shared batched call returns one image and would stamp the first node's
	// raster onto every marker (distinct flattened regions collapsing to one).
	for (const m of input.markers) {
		let result: RenderResult;
		try {
			result = await input.renderImage({
				fileKey: input.fileKey,
				nodeIds: [m.nodeId],
				scale: input.scale,
				format: "png",
			});
		} catch {
			// No raster for this node (not pre-exported). Skip it rather than
			// failing the whole export; the caller warns.
			skipped.push(m.nodeId);
			elements.push(null);
			continue;
		}
		if (isEmptyRaster(result)) {
			empty.push(m.nodeId);
			elements.push(null);
			continue;
		}
		elements.push({
			id: rasterElementId("flatten", m.nodeId),
			type: "image",
			pos: m.pos,
			size: m.size,
			// The exported bitmap's pixels are world-upright, so the rotation the
			// marker carries is the one that KEEPS them upright under whatever the
			// painter applies to the frame this element sits in — nothing at all in
			// an upright frame, the inverse of the frame's rotation in a rotated one.
			...(m.rotation !== 0 ? { rotation: m.rotation } : {}),
			properties: { src: assetUri(result.sha256), fit: "fill" },
		});
		assets.push({
			sha256: result.sha256,
			blob: result.blob,
			contentType: "image/png",
		});
	}

	return { elements, assets, skipped, empty };
}
