// Export settings on render(): the compile size decides the layout, each export
// setting decides the density that layout is rasterized at — so one call can
// return the same side at several sizes, each tagged with what it is.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { decodePixels } from "freshcoat";
import { createHeadlessEnv } from "freshcoat/headless";
import { describe, expect, test } from "vitest";
import type { EncodedPaintedFrame } from "../src/render";
import { render } from "../src/render";
import type { Template } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

const side = (name: string, fill: string) => ({
	name,
	background: {
		id: `bg-${name}`,
		type: "rect",
		pos: { x: 0, y: 0 },
		size: { width: 40, height: 20 },
		properties: { fill },
	},
	elements: [],
});

// A two-sided 40×20 card, so frame × export ordering is observable.
const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	description: "d",
	product: "test",
	width: 40,
	height: 20,
	fields: { type: "object", properties: {} },
	template_data: [side("front", "#ffffff"), side("back", "#000000")],
} as unknown as Template;

async function ckInit(): Promise<any> {
	return (await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	})) as unknown;
}

const pngSize = (ck: any, png: Uint8Array) => {
	const d = decodePixels(ck, png);
	if (!d) throw new Error("decode failed");
	return [d.width, d.height];
};

const renderAt = async (
	ck: any,
	exports?: Parameters<typeof render>[2]["exports"],
) =>
	(await render(
		template,
		{},
		{ width: 40, height: 20, exports },
		{ ck, env: createHeadlessEnv() },
	)) as EncodedPaintedFrame[];

describe("render() export settings", () => {
	test("no settings = one 1× result per frame, tagged with its pixel size", async () => {
		const ck = await ckInit();
		const results = await renderAt(ck);
		expect(results.map((r) => [r.name, r.scale, r.width, r.height])).toEqual([
			["front", 1, 40, 20],
			["back", 1, 40, 20],
		]);
		expect(results[0].suffix).toBeUndefined();
		expect(pngSize(ck, results[0].bytes)).toEqual([40, 20]);
	});

	test("each setting paints every frame, and the suffix rides along", async () => {
		const ck = await ckInit();
		const results = await renderAt(ck, [
			{},
			{ constraint: { kind: "scale", value: 2 }, suffix: "@2x" },
			{ constraint: { kind: "width", value: 100 }, suffix: "-wide" },
		]);
		// Grouped by frame, in export order within each.
		expect(
			results.map((r) => [r.name, r.scale, r.suffix, r.width, r.height]),
		).toEqual([
			["front", 1, undefined, 40, 20],
			["front", 2, "@2x", 80, 40],
			["front", 2.5, "-wide", 100, 50],
			["back", 1, undefined, 40, 20],
			["back", 2, "@2x", 80, 40],
			["back", 2.5, "-wide", 100, 50],
		]);
		// The tags describe the actual pixels.
		for (const r of results) {
			expect(pngSize(ck, r.bytes)).toEqual([r.width, r.height]);
		}
	});

	test("the density is per export — the layout is the compile's, unchanged", async () => {
		const ck = await ckInit();
		const [oneX, twoX] = await renderAt(ck, [
			{},
			{ constraint: { kind: "scale", value: 2 } },
		]);
		// Same white front at both densities; only the pixel count differs.
		const px = (r: EncodedPaintedFrame) => {
			const d = decodePixels(ck, r.bytes);
			if (!d) throw new Error("decode failed");
			const o =
				(Math.floor(d.height / 2) * d.width + Math.floor(d.width / 2)) * 4;
			return [d.data[o], d.data[o + 1], d.data[o + 2]];
		};
		expect(px(oneX)).toEqual([255, 255, 255]);
		expect(px(twoX)).toEqual([255, 255, 255]);
	});

	test("supersample raises the sample rate, not the size", async () => {
		const ck = await ckInit();
		const results = await renderAt(ck, [
			{ supersample: 2 },
			{
				constraint: { kind: "scale", value: 2 },
				supersample: 2,
				suffix: "@2x",
			},
		]);
		// Size comes from the constraint alone; the sample rate is orthogonal and
		// reported alongside it.
		expect(
			results.map((r) => [r.name, r.scale, r.supersample, r.width, r.height]),
		).toEqual([
			["front", 1, 2, 40, 20],
			["front", 2, 2, 80, 40],
			["back", 1, 2, 40, 20],
			["back", 2, 2, 80, 40],
		]);
		for (const r of results) {
			expect(pngSize(ck, r.bytes)).toEqual([r.width, r.height]);
		}
	});

	test("a setting with no supersample reports 1, not undefined", async () => {
		const ck = await ckInit();
		const [front] = await renderAt(ck, [{}]);
		expect(front.supersample).toBe(1);
	});

	test("the reported rate is the one rendered, not the one asked for", async () => {
		const ck = await ckInit();
		// 3 is honoured as 2 (the reduction is a chain of halvings), and the tag
		// says 2 rather than echoing the request back. The same resolution is what
		// lowers a rate that would not fit under the max-dimension ceiling.
		const [front] = await renderAt(ck, [{ supersample: 3 }]);
		expect(front.supersample).toBe(2);
		expect([front.width, front.height]).toEqual([40, 20]);
	});

	test("frameNames still restricts which sides are exported", async () => {
		const ck = await ckInit();
		const results = (await render(
			template,
			{},
			{
				width: 40,
				height: 20,
				frameNames: ["back"],
				exports: [{ constraint: { kind: "scale", value: 3 } }],
			},
			{ ck, env: createHeadlessEnv() },
		)) as EncodedPaintedFrame[];
		expect(results.map((r) => [r.name, r.width, r.height])).toEqual([
			["back", 120, 60],
		]);
	});
});
