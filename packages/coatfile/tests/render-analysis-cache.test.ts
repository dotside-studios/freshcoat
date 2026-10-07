// An analysis cache on renderTemplate: a print-analyzed batch samples and
// analyzes each distinct image once, and paints what an uncached render does.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { createRenderer, mapLoader } from "@freshcoat-js/engine";
import { createAnalysisCache } from "@freshcoat-js/for-print";
import { describe, expect, test } from "vitest";
import { type RenderTemplateOptions, renderTemplate } from "../src/render";
import type { Template } from "../src/types";

let ck: any;
async function ckInit(): Promise<any> {
	ck ??= await loadCanvasKit();
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

async function renderAll(
	options: Pick<RenderTemplateOptions, "analysisCache" | "analysisKey"> = {},
) {
	const ck = await ckInit();
	const images = new Map<string, Uint8Array>([
		["logo.png", solidPng(ck, [20, 160, 60, 255])],
		["a.png", solidPng(ck, [200, 40, 40, 255])],
		["b.png", solidPng(ck, [40, 40, 200, 255])],
	]);
	const loads = new Map<string, number>();
	const inner = mapLoader(images);
	const renderer = await createRenderer({
		ck,
		load: (src) => {
			loads.set(src, (loads.get(src) ?? 0) + 1);
			return inner(src);
		},
		cache: { maxImagePixels: 1_000_000 },
	});
	const out: Uint8Array[] = [];
	for (const values of RECORDS) {
		const [frame] = await renderTemplate(renderer, template, values, {
			width: 32,
			height: 20,
			print: { analyze: true },
			...options,
		});
		out.push(frame?.bytes as Uint8Array);
	}
	renderer.dispose();
	return { out, loads };
}

describe("renderTemplate() with an analysis cache", () => {
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
