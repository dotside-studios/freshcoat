import { describe, expect, it } from "vitest";
import type { NodeTrace } from "~/lib/figma/transpiler";
import type { ReadDocumentMessage } from "~/shared/protocol";
import { buildDiagnostics } from "~/ui/diagnostics";

const TEMPLATE = { id: "cert", name: "Cert", width: 842, height: 595 };
const COUNTS = { native: 2, flattened: 1, skipped: 0 };

/** A 1x1 PNG header — the shape Figma answers with for a node that renders
 *  nothing. Only the IHDR is needed; nothing decodes the pixels. */
function png(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, 13);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

const tree = {
	id: "1:1",
	name: "Front",
	type: "FRAME",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 0, y: 0, width: 842, height: 595 },
	fills: [],
	children: [
		{
			id: "1:2",
			name: "Fog",
			type: "VECTOR",
			visible: true,
			opacity: 0.35,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: -150, y: -8, width: 1080, height: 601 },
			fills: [
				{
					type: "GRADIENT_RADIAL",
					gradientTransform: [
						[0, 1, 0],
						[-1, 0, 1],
					],
					gradientHandlePositions: [{ x: 0.5, y: 0.5 }],
					gradientStops: [],
				},
			],
		},
	],
};

const msg = {
	type: "read-document",
	product: {
		sku: "custom",
		displayName: "Custom",
		width: 842,
		height: 595,
		frames: [{ name: "cert", label: "Cert", required: true }],
	},
	mode: "custom",
	slots: [
		{
			slot: "cert",
			nodeId: "1:1",
			nodeName: "Front",
			width: 842,
			height: 595,
			tree,
		},
	],
	colorways: [
		{
			instanceId: "9:9",
			label: "Dark",
			perSide: { cert: tree },
		},
	],
	rasters: [
		{ nodeId: "1:3", bytes: png(2526, 1337) },
		{ nodeId: "1:4", bytes: png(1, 1) },
	],
} as unknown as ReadDocumentMessage;

const trace: NodeTrace[] = [
	{
		slot: "cert",
		nodeId: "1:2",
		name: "Fog",
		nodeType: "VECTOR",
		decision: "native-vector",
		elementId: "Fog",
	},
	{
		slot: "cert",
		nodeId: "1:3",
		name: "Mountain",
		nodeType: "GROUP",
		decision: "flatten",
		reason: "effect_flattened",
		elementId: "flatten_1_3",
	},
];

const build = () =>
	buildDiagnostics({
		msg,
		trace,
		template: TEMPLATE,
		counts: COUNTS,
		exportedAt: "2026-07-29T00:00:00.000Z",
	});

describe("buildDiagnostics", () => {
	it("carries the scene graph through verbatim", () => {
		// The whole point: what the transpiler read, not a summary of it. A
		// curated view can only show the properties someone thought to include,
		// which is exactly the blind spot this is meant to close.
		expect(build().scene[0].tree).toBe(tree);
	});

	it("keeps a gradient's own transform, which the handles only sample", () => {
		const fills = (
			build().scene[0].tree.children[0] as unknown as {
				fills: Array<{ gradientTransform?: unknown }>;
			}
		).fills;
		expect(fills[0].gradientTransform).toEqual([
			[0, 1, 0],
			[-1, 0, 1],
		]);
	});

	it("records what became of every node the walk reached", () => {
		const d = build().decisions;
		expect(d.map((t) => [t.nodeId, t.decision, t.elementId])).toEqual([
			["1:2", "native-vector", "Fog"],
			["1:3", "flatten", "flatten_1_3"],
		]);
		// The reason a layer was rasterized is the question the scene graph
		// cannot answer on its own.
		expect(d[1].reason).toBe("effect_flattened");
	});

	it("summarizes each raster instead of carrying megabytes of bytes", () => {
		const r = build().rasters;
		expect(r).toEqual([
			{ nodeId: "1:3", bytes: 24, width: 2526, height: 1337 },
			{ nodeId: "1:4", bytes: 24, width: 1, height: 1 },
		]);
	});

	it("names a raster that came back empty by its dimensions", () => {
		// A 1x1 for a region that claimed real area is Figma saying the node
		// renders nothing — indistinguishable from a good raster without this.
		const empty = build().rasters.find((r) => r.nodeId === "1:4");
		expect(empty?.width).toBe(1);
		expect(empty?.height).toBe(1);
	});

	it("lists colorways by side without duplicating their trees", () => {
		expect(build().colorways).toEqual([
			{ instanceId: "9:9", label: "Dark", sides: ["cert"] },
		]);
	});

	it("stamps the export it belongs to", () => {
		const d = build();
		expect(d.kind).toBe("freshcoat-diagnostics");
		expect(d.template).toEqual(TEMPLATE);
		expect(d.product).toEqual({ sku: "custom", mode: "custom" });
		expect(d.counts).toEqual(COUNTS);
		expect(d.exportedAt).toBe("2026-07-29T00:00:00.000Z");
	});
});
