// An analysis cache on the render runtime: a print-analyzed batch samples and
// analyzes each distinct image once, and paints what an uncached render does.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { createPaintCache } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { createAnalysisCache } from "@freshcoat-js/for-print";
import { describe, expect, test } from "vitest";
import { type EncodedPaintedFrame, type RenderRuntime, render } from "../src/render";
import type { Template } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

let ck: any;
async function ckInit(): Promise<any> {
	ck ??= await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
	return ck;
}

function solidPng(ck: any, rgba: [number, number, number, number]) {
	const surface = ck.MakeSurface(8, 8);
	surface.getCanvas().clear(ck.Color(...rgba));
	const img = surface.makeImageSnapshot();
	const bytes = img.encodeToBytes() as Uint8Array;
	img.delete();
	surface.delete();
	return bytes;
}

const image = (id: string, x: number, src: string) => ({
	id,
	type: "image",
	pos: { x, y: 4 },
	size: { width: 12, height: 12 },
	properties: { src, fit: "cover" },
});

const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	description: "d",
	product: "test",
	width: 32,
	height: 20,
	fields: { type: "object", properties: { photo: { type: "string" } } },
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 32, height: 20 },
				properties: { fill: "#ffffff" },
			},
			elements: [image("logo", 2, "logo.png"), image("photo", 18, "{{photo}}")],
		},
	],
} as unknown as Template;

const RECORDS = ["a.png", "b.png", "a.png", "b.png", "a.png", "b.png"].map(
	(photo) => ({ photo }),
);

async function renderAll(runtime: Partial<RenderRuntime> = {}) {
	const ck = await ckInit();
	const images = new Map<string, Uint8Array>([
		["logo.png", solidPng(ck, [20, 160, 60, 255])],
		["a.png", solidPng(ck, [200, 40, 40, 255])],
		["b.png", solidPng(ck, [40, 40, 200, 255])],
	]);
	const loads = new Map<string, number>();
	const env = createHeadlessEnv({ images });
	const load = env.loadImageBytes;
	env.loadImageBytes = (src) => {
		loads.set(src, (loads.get(src) ?? 0) + 1);
		return load(src);
	};
	const paintCache = createPaintCache({ maxImagePixels: 1_000_000 });
	const out: Uint8Array[] = [];
	for (const values of RECORDS) {
		const [frame] = (await render(
			template,
			values,
			{ width: 32, height: 20, print: { analyze: true } },
			{ ck, env, paintCache, ...runtime },
		)) as EncodedPaintedFrame[];
		out.push(frame?.bytes as Uint8Array);
	}
	paintCache.dispose();
	return { out, loads };
}

describe("render() with an analysis cache", () => {
	test("analyzes each distinct image once across many records", async () => {
		const analysisCache = createAnalysisCache(16);
		const { loads } = await renderAll({ analysisCache });
		// One decode to paint, one to sample.
		expect(loads.get("logo.png")).toBe(2);
		expect(loads.get("a.png")).toBe(2);
		expect(loads.get("b.png")).toBe(2);
		expect(analysisCache.size).toBe(3);
	});

	test("keys images by the caller's key", async () => {
		const analysisCache = createAnalysisCache(16);
		await renderAll({
			analysisCache,
			analysisKey: (src) => (src === "logo.png" ? "asset:abc" : undefined),
		});
		const keys = [...analysisCache.keys()];
		expect(keys.some((k) => k.startsWith("asset:abc|"))).toBe(true);
		expect(keys.some((k) => k.startsWith("a.png|"))).toBe(true);
	});

	test("paints the same bytes as an uncached render", async () => {
		const plain = await renderAll();
		expect(plain.loads.get("logo.png")).toBe(RECORDS.length + 1);
		const cached = await renderAll({ analysisCache: createAnalysisCache(16) });
		expect(cached.out).toEqual(plain.out);
	});

	test("a bounded cache drops the least recently used analysis", async () => {
		const analysisCache = createAnalysisCache(2);
		const { loads } = await renderAll({ analysisCache });
		expect(analysisCache.size).toBe(2);
		// The logo every record draws stays; the photos take turns.
		expect(loads.get("logo.png")).toBe(2);
		expect(loads.get("a.png")).toBe(4);
	});
});
