import { clampRasterScale } from "~/lib/figma/transpiler/raster-scale";

/** One node to rasterize, with the export scale its slot calls for. Scale is
 *  per-target because a design drawn smaller than the product's print size has
 *  to be exported proportionally larger to reach the same on-card density, and
 *  slots can be picked from designs of different sizes. */
export type RasterTarget = { nodeId: string; scale: number };

const EXPORT_CONCURRENCY = 3;

/** Export the given nodes to PNG bytes, keyed by id.
 *
 *  A node that fails to export is skipped rather than failing the batch. The
 *  transpiler already handles a missing raster — rasterizeMarkers reports it as
 *  `skipped` and the export carries a `raster_unavailable` warning naming the
 *  layer — so one unexportable blob costs the author that region and a warning
 *  they can click, instead of the whole export.
 *
 *  Up to EXPORT_CONCURRENCY exports run at once; output keeps target order.
 *  `onProgress` is called as each node completes. Rasterizing is the slow part of a
 *  read, and without it a big design is indistinguishable from a hang. */
export async function exportRasters(
	targets: RasterTarget[],
	onProgress?: (done: number, total: number) => void,
): Promise<Array<{ nodeId: string; bytes: number[] }>> {
	let exported = 0;
	const results = await mapLimit(
		targets,
		EXPORT_CONCURRENCY,
		async (target) => {
			const bytes = await exportOne(target.nodeId, (node) => {
				const sized = node as { width?: number; height?: number };
				return {
					format: "PNG",
					constraint: {
						type: "SCALE",
						value: clampRasterScale(
							target.scale,
							sized.width ?? 0,
							sized.height ?? 0,
						),
					},
				};
			});
			if (bytes) exported++;
			onProgress?.(exported, targets.length);
			return bytes ? { nodeId: target.nodeId, bytes } : null;
		},
	);
	return results.filter((r) => r !== null);
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
	const results = await mapLimit(nodeIds, EXPORT_CONCURRENCY, async (id) => {
		const bytes = await exportOne(id, () => ({
			format: "PNG",
			constraint: { type: "WIDTH", value: width },
		}));
		return bytes ? { nodeId: id, bytes } : null;
	});
	return results.filter((r) => r !== null);
}

/** Export one node, or null when it is gone, not exportable, or the export
 *  throws (zero-size, unsupported effect stack). */
async function exportOne(
	nodeId: string,
	settingsFor: (node: BaseNode) => ExportSettingsImage,
): Promise<number[] | null> {
	const node = await figma.getNodeByIdAsync(nodeId);
	if (!node || !("exportAsync" in node)) return null;
	try {
		const bytes = await (node as ExportMixin).exportAsync(settingsFor(node));
		return Array.from(bytes);
	} catch {
		return null;
	}
}

/** Like Promise.all over `items.map(fn)`, with at most `limit` calls in flight.
 *  Results keep input order. */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return out;
}
