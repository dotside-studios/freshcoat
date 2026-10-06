// A PaintCache on the render runtime: a batch of records that share images
// decodes each shared one once, and paints exactly what an uncached render does.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { createPaintCache, type PaintCache } from "@freshcoat-js/engine";
import { createHeadlessEnv } from "@freshcoat-js/engine/headless";
import { describe, expect, test } from "vitest";
import { type EncodedPaintedFrame, render } from "../src/render";
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

const SVG = new TextEncoder().encode(
	'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="10" fill="#e02020"/><rect x="5" width="5" height="10" fill="#2040e0"/></svg>',
);

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
	width: 48,
	height: 20,
	fields: { type: "object", properties: { photo: { type: "string" } } },
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 48, height: 20 },
				properties: { fill: "#ffffff" },
			},
			elements: [
				image("logo", 2, "logo.png"),
				image("art", 18, "art.svg"),
				image("photo", 34, "{{photo}}"),
			],
		},
	],
} as unknown as Template;

const RECORDS = [{ photo: "a.png" }, { photo: "b.png" }];

async function setup() {
	const ck = await ckInit();
	const images = new Map<string, Uint8Array>([
		["logo.png", solidPng(ck, [20, 160, 60, 255])],
		["art.svg", SVG],
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
	return { ck, env, loads };
}

async function renderAll(paintCache?: PaintCache) {
	const { ck, env, loads } = await setup();
	const out: Uint8Array[] = [];
	for (const values of RECORDS) {
		const [frame] = (await render(
			template,
			values,
			{ width: 48, height: 20 },
			{ ck, env, paintCache },
		)) as EncodedPaintedFrame[];
		expect(frame?.warnings).toEqual([]);
		out.push(frame?.bytes as Uint8Array);
	}
	return { out, loads };
}

describe("render() with a paint cache", () => {
	test("records sharing an image and an SVG image decode each once", async () => {
		const cache = createPaintCache();
		const { loads } = await renderAll(cache);
		expect(loads.get("logo.png")).toBe(1);
		expect(loads.get("art.svg")).toBe(1);
		expect(loads.get("a.png")).toBe(1);
		expect(loads.get("b.png")).toBe(1);
		expect(cache.stats()).toMatchObject({ paints: 2, imageDecodes: 4 });
		cache.dispose();
	});

	test("paints the same bytes as an uncached render", async () => {
		const plain = await renderAll();
		expect(plain.loads.get("logo.png")).toBe(2);
		for (const maxImagePixels of [undefined, 1_000_000]) {
			const cache = createPaintCache({ maxImagePixels });
			const cached = await renderAll(cache);
			expect(cached.out).toEqual(plain.out);
			cache.dispose();
		}
	});

	test("disposing the cache frees what it holds", async () => {
		const { env } = await setup();
		const real = await ckInit();
		const live = new Set<unknown>();
		const spy = Object.create(real);
		spy.MakeImageFromEncoded = (bytes: Uint8Array) => {
			const img = real.MakeImageFromEncoded(bytes);
			if (!img) return img;
			live.add(img);
			const free = img.delete.bind(img);
			img.delete = () => {
				live.delete(img);
				free();
			};
			return img;
		};
		const cache = createPaintCache({ maxImagePixels: 1_000_000 });
		for (const values of RECORDS)
			await render(
				template,
				values,
				{ width: 48, height: 20 },
				{ ck: spy, env, paintCache: cache },
			);
		expect(live.size).toBe(3);
		cache.dispose();
		expect(live.size).toBe(0);
		await expect(
			render(
				template,
				RECORDS[0] as Record<string, unknown>,
				{ width: 48, height: 20 },
				{ ck: spy, env, paintCache: cache },
			),
		).rejects.toThrow("disposed");
	});
});
