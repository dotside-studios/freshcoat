import { clampRasterScale } from "~/lib/figma/transpiler/raster-scale";

/** One node to rasterize, with the export scale its slot calls for. Scale is
 *  per-target because a design drawn smaller than the product's print size has
 *  to be exported proportionally larger to reach the same on-card density, and
 *  slots can be picked from designs of different sizes. */
export type RasterTarget = { nodeId: string; scale: number };

/** Export the given nodes to PNG bytes, keyed by id.
 *
 *  A node that fails to export is skipped rather than failing the batch. The
 *  transpiler already handles a missing raster — rasterizeMarkers reports it as
 *  `skipped` and the export carries a `raster_unavailable` warning naming the
 *  layer — so one unexportable blob costs the author that region and a warning
 *  they can click, instead of the whole export.
 *
 *  `onProgress` is called after each node. Rasterizing is the slow part of a
 *  read, and without it a big design is indistinguishable from a hang. */
export async function exportRasters(
	targets: RasterTarget[],
	onProgress?: (done: number, total: number) => void,
): Promise<Array<{ nodeId: string; bytes: number[] }>> {
	const out: Array<{ nodeId: string; bytes: number[] }> = [];
	for (const target of targets) {
		const node = await figma.getNodeByIdAsync(target.nodeId);
		if (node && "exportAsync" in node) {
			try {
				const sized = node as { width?: number; height?: number };
				const bytes = await (node as ExportMixin).exportAsync({
					format: "PNG",
					constraint: {
						type: "SCALE",
						value: clampRasterScale(
							target.scale,
							sized.width ?? 0,
							sized.height ?? 0,
						),
					},
				});
				out.push({ nodeId: target.nodeId, bytes: Array.from(bytes) });
			} catch {
				// Unexportable node (zero-size, unsupported effect stack). Leave it
				// out; the transpiler warns rather than dropping it silently.
			}
		}
		onProgress?.(out.length, targets.length);
	}
	return out;
}

/** Export the given nodes as UI previews, each exactly `width` px across.
 *  WIDTH rather than SCALE because these land in one fixed thumbnail box: a
 *  scale factor that suits a CR80 card would make an A4 artboard enormous.
 *  A node that fails to export is skipped — a missing preview must never break
 *  the panel it sits in. */
export async function exportThumbnails(
	nodeIds: string[],
	width: number,
): Promise<Array<{ nodeId: string; bytes: number[] }>> {
	const out: Array<{ nodeId: string; bytes: number[] }> = [];
	for (const id of nodeIds) {
		const node = await figma.getNodeByIdAsync(id);
		if (!node || !("exportAsync" in node)) continue;
		try {
			const bytes = await (node as ExportMixin).exportAsync({
				format: "PNG",
				constraint: { type: "WIDTH", value: width },
			});
			out.push({ nodeId: id, bytes: Array.from(bytes) });
		} catch {
			// Zero-size or otherwise unexportable frame — leave it without a preview.
		}
	}
	return out;
}
