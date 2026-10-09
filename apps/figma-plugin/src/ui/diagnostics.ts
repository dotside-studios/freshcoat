import { parseImageInfo } from "@freshcoat-js/engine/image";
import type { NodeTrace } from "~/lib/figma/transpiler";
import type { ReadDocumentMessage } from "~/shared/protocol";

/** What one pre-exported bitmap came out as. The bytes themselves are megabytes
 *  of noise in a document meant to be read, so only their shape is kept —
 *  enough to spot the 1×1 transparent pixel Figma returns for a node that
 *  renders nothing, which otherwise looks like a perfectly good raster. */
export type RasterDiagnostic = {
	nodeId: string;
	bytes: number;
	width?: number;
	height?: number;
};

/** The plugin's account of one export: what Figma handed it, and what it made
 *  of that.
 *
 *  `scene` is the scene graph VERBATIM — the exact `FigmaContainerNode` trees
 *  the transpiler read, not a summary of them. Anything the transpiler could
 *  see is in here, so a template that came out wrong can be traced back to the
 *  property it came from without re-reading the design or guessing.
 *
 *  `decisions` is the half the scene graph cannot supply: which node became
 *  which element, and why a layer was rasterized or dropped instead of emitted.
 *  Together with the exported template — the sibling file — that closes the loop
 *  from Figma property to rendered pixel. */
export type Diagnostics = {
	kind: "freshcoat-diagnostics";
	version: 1;
	exportedAt: string;
	template: { id: string; name: string; width: number; height: number };
	product: { sku: string; mode: string };
	counts: { native: number; flattened: number; skipped: number };
	scene: ReadDocumentMessage["slots"];
	colorways: Array<{ instanceId: string; label: string; sides: string[] }>;
	decisions: NodeTrace[];
	rasters: RasterDiagnostic[];
};

export function buildDiagnostics(input: {
	msg: ReadDocumentMessage;
	trace: NodeTrace[];
	template: { id: string; name: string; width: number; height: number };
	counts: { native: number; flattened: number; skipped: number };
	exportedAt: string;
}): Diagnostics {
	const { msg, trace, template, counts, exportedAt } = input;
	return {
		kind: "freshcoat-diagnostics",
		version: 1,
		exportedAt,
		template,
		product: { sku: msg.product.sku, mode: msg.mode },
		counts,
		scene: msg.slots,
		colorways: msg.colorways.map((c) => ({
			instanceId: c.instanceId,
			label: c.label,
			sides: Object.keys(c.perSide),
		})),
		decisions: trace,
		rasters: msg.rasters.map((r) => {
			const info = parseImageInfo(r.bytes);
			return {
				nodeId: r.nodeId,
				bytes: r.bytes.length,
				...(info ? { width: info.width, height: info.height } : {}),
			};
		}),
	};
}
