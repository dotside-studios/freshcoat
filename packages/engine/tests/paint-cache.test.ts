import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test, vi } from "vitest";
import { buildAdjust, composeAdjust } from "../src/adjust";
import { paintScene } from "../src/canvaskit";
import { clearFontBytesCache } from "../src/font-bytes";
import { createHeadlessEnv } from "../src/headless";
import {
	compileScene,
	createFrame,
	createImage,
	createPaintCache,
	createRect,
	createText,
	deriveFontMetrics,
	encodePng,
	type PaintCache,
} from "../src/index";
import {
	cachedLutImage,
	createLutImages,
	evictUnusedLutImages,
	freeLutImages,
} from "../src/lut-images";
import type { Node } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { Adjust, Command, PaintRuntime } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const FONT = new Uint8Array(
	readFileSync(
		fileURLToPath(new URL("./fonts/Geist-Regular.ttf", import.meta.url)),
	),
);

let ck: any;
async function initCk() {
	if (!ck)
		ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
			locateFile: (f: string) => join(CK_BIN, f),
		});
	return ck;
}

// A 4x4 quartered PNG, so a decoded image is visibly more than a flat fill.
async function testPng(): Promise<Uint8Array> {
	const px = new Uint8Array(4 * 4 * 4);
	for (let y = 0; y < 4; y++)
		for (let x = 0; x < 4; x++) {
			const i = (y * 4 + x) * 4;
			px.set(x < 2 === y < 2 ? [220, 40, 40, 255] : [40, 90, 220, 255], i);
		}
	return encodePng(px, 4, 4);
}

function scene(size: { width: number; height: number }, srcs: string[]): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size,
		background: createRect({
			pos: { x: 0, y: 0 },
			size,
			fills: [{ kind: "solid", color: "#f5f0e6" }],
		}),
		children: [
			createText({
				pos: { x: 4, y: 4 },
				size: { width: size.width - 8, height: 24 },
				text: "Paint cache",
				font: {
					family: "Geist",
					weight: 400,
					style: "normal",
					size: 16,
					lineHeight: 1.2,
				},
				color: "#101828",
			}),
			...srcs.map((src, i) =>
				createImage({
					pos: { x: 4 + i * 20, y: 32 },
					size: { width: 16, height: 16 },
					src,
					fit: "cover",
				}),
			),
		],
	});
}

function textScene(text: string, x: number): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: SIZE,
		children: [
			createText({
				pos: { x, y: 4 },
				size: { width: 80, height: 24 },
				text,
				font: {
					family: "Geist",
					weight: 400,
					style: "normal",
					size: 16,
					lineHeight: 1.2,
				},
				color: "#101828",
			}),
		],
	});
}

function adjustScene(adjusts: Adjust[]): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: SIZE,
		children: adjusts.map((adjust, i) =>
			createRect({
				pos: { x: i * 24, y: 0 },
				size: { width: 20, height: 20 },
				fills: [{ kind: "solid", color: "#808080" }],
				adjust,
			}),
		),
	});
}

function compile(
	node: Node,
	size: { width: number; height: number },
	fonts: Map<string, Uint8Array[]>,
	extra?: { supersample?: number },
): Command[] {
	const textEngine = createParagraphEngine(ck, fonts);
	try {
		return compileScene(node, {
			...size,
			textEngine,
			fontMetrics: deriveFontMetrics(fonts),
			...extra,
		});
	} finally {
		textEngine.dispose();
	}
}

// A headless runtime whose image loader is observable.
function runtime(
	fonts: Map<string, Uint8Array[]>,
	images: Map<string, Uint8Array>,
	cache?: PaintCache,
): { rt: PaintRuntime; load: ReturnType<typeof vi.fn> } {
	const env = createHeadlessEnv({ fonts, images, cache });
	const load = vi.fn(env.loadImageBytes);
	return { rt: { ...env, loadImageBytes: load }, load };
}

async function pixels(commands: Command[], rt: PaintRuntime) {
	const out = await paintScene(ck, commands, rt);
	expect(out.warnings).toEqual([]);
	const px = out.readPixels?.();
	out.dispose();
	if (!px) throw new Error("no pixels");
	return px;
}

const SIZE = { width: 96, height: 56 };

describe("PaintCache", () => {
	test("a cached paint matches an uncached one, pixel for pixel", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const images = new Map([["img://a", await testPng()]]);
		const node = scene(SIZE, ["img://a"]);
		for (const extra of [{}, { supersample: 2 }]) {
			const commands = compile(node, SIZE, fonts, extra);
			const plain = await pixels(commands, runtime(fonts, images).rt);
			const cache = createPaintCache();
			const { rt } = runtime(fonts, images, cache);
			// The second paint draws onto the reused surface, so it also shows the
			// surface is cleared between paints.
			const first = await pixels(commands, rt);
			const second = await pixels(commands, rt);
			expect(first).toEqual(plain);
			expect(second).toEqual(plain);
			expect(cache.stats().surfaceCreates).toBe(1);
			cache.dispose();
		}
	});

	test("the encode policy leaves the cached surface in place", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const commands = compile(scene(SIZE, []), SIZE, fonts);
		const cache = createPaintCache();
		const env = createHeadlessEnv({ fonts, cache });
		const a = (await env.paint(commands, ck)) as { bytes: Uint8Array };
		const b = (await env.paint(commands, ck)) as { bytes: Uint8Array };
		expect(b.bytes).toEqual(a.bytes);
		expect(cache.stats()).toMatchObject({ paints: 2, surfaceCreates: 1 });
		cache.dispose();
	});

	test("an image is decoded once across paints", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const images = new Map([["img://a", await testPng()]]);
		const commands = compile(scene(SIZE, ["img://a"]), SIZE, fonts);
		const cache = createPaintCache();
		const { rt, load } = runtime(fonts, images, cache);
		await pixels(commands, rt);
		await pixels(commands, rt);
		expect(cache.stats().imageDecodes).toBe(1);
		expect(load).toHaveBeenCalledTimes(1);
		cache.dispose();
	});

	test("a new fonts map rebuilds the provider exactly once", async () => {
		await initCk();
		const fontsA = new Map([["Geist", [FONT]]]);
		const commands = compile(scene(SIZE, []), SIZE, fontsA);
		const cache = createPaintCache();
		await pixels(commands, runtime(fontsA, new Map(), cache).rt);
		await pixels(commands, runtime(fontsA, new Map(), cache).rt);
		expect(cache.stats().fontProviderBuilds).toBe(1);

		const fontsB = new Map([["Geist", [FONT.slice()]]]);
		const { rt } = runtime(fontsB, new Map(), cache);
		await pixels(commands, rt);
		await pixels(commands, rt);
		expect(cache.stats().fontProviderBuilds).toBe(2);
		cache.dispose();
	});

	test("a descriptor-loaded font keeps its provider across paints", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const commands = compile(scene(SIZE, []), SIZE, fonts);
		const realFetch = globalThis.fetch;
		const requested: string[] = [];
		globalThis.fetch = (async (url: string) => {
			requested.push(url);
			if (url === "https://css/geist")
				return {
					ok: true,
					text: async () =>
						"@font-face { src: url(https://f/geist.ttf) format('truetype'); }",
				};
			return { ok: true, arrayBuffer: async () => FONT.slice().buffer };
		}) as unknown as typeof globalThis.fetch;
		const cache = createPaintCache();
		try {
			const env = createHeadlessEnv({ cache });
			const rt: PaintRuntime = {
				...env,
				resolveFont: (req) => ({
					kind: "descriptor",
					descriptor: {
						kind: "google",
						family: typeof req === "string" ? req : req.family,
						url: "https://css/geist",
					},
				}),
			};
			await pixels(commands, rt);
			await pixels(commands, rt);
			expect(cache.stats().fontProviderBuilds).toBe(1);
			expect(requested).toEqual(["https://css/geist", "https://f/geist.ttf"]);
		} finally {
			globalThis.fetch = realFetch;
			clearFontBytesCache();
			cache.dispose();
		}
	});

	test("a new scene size creates a new surface", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		await pixels(compile(scene(SIZE, []), SIZE, fonts), rt);
		expect(cache.stats().surfaceCreates).toBe(1);

		const bigger = { width: 120, height: 64 };
		const px = await pixels(compile(scene(bigger, []), bigger, fonts), rt);
		expect(cache.stats().surfaceCreates).toBe(2);
		expect([px.width, px.height]).toEqual([120, 64]);
		cache.dispose();
	});

	test("an image dropped from the scene is evicted", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const png = await testPng();
		const images = new Map([
			["img://a", png],
			["img://b", png],
		]);
		const cache = createPaintCache();
		const { rt, load } = runtime(fonts, images, cache);
		const both = compile(scene(SIZE, ["img://a", "img://b"]), SIZE, fonts);
		const onlyA = compile(scene(SIZE, ["img://a"]), SIZE, fonts);

		await pixels(both, rt);
		await pixels(onlyA, rt);
		expect(cache.stats().imageDecodes).toBe(2);
		// b was evicted by the paint that did not use it, so it decodes again.
		await pixels(both, rt);
		expect(cache.stats().imageDecodes).toBe(3);
		expect(load.mock.calls.map((c) => c[0])).toEqual([
			"img://a",
			"img://b",
			"img://b",
		]);
		cache.dispose();
	});

	test("moving text reuses its shaped lines", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		await pixels(compile(textScene("Shaped once", 4), SIZE, fonts), rt);
		const built = cache.stats().paragraphBuilds;
		expect(built).toBeGreaterThan(0);
		await pixels(compile(textScene("Shaped once", 12), SIZE, fonts), rt);
		expect(cache.stats().paragraphBuilds).toBe(built);
		await pixels(compile(textScene("Shaped twice", 12), SIZE, fonts), rt);
		expect(cache.stats().paragraphBuilds).toBeGreaterThan(built);
		cache.dispose();
	});

	test("moved text paints as an uncached paint does", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		await pixels(compile(textScene("Shaped once", 4), SIZE, fonts), rt);
		const moved = compile(textScene("Shaped once", 12), SIZE, fonts);
		const plain = await pixels(moved, runtime(fonts, new Map()).rt);
		expect(await pixels(moved, rt)).toEqual(plain);
		cache.dispose();
	});

	test("lines dropped from the scene are shaped again", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		const a = compile(textScene("First", 4), SIZE, fonts);
		await pixels(a, rt);
		const built = cache.stats().paragraphBuilds;
		await pixels(compile(textScene("Second", 4), SIZE, fonts), rt);
		const after = cache.stats().paragraphBuilds;
		await pixels(a, rt);
		expect(after).toBeGreaterThan(built);
		expect(cache.stats().paragraphBuilds).toBeGreaterThan(after);
		cache.dispose();
	});

	test("lines outside the surface are not shaped", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		const text = Array.from({ length: 200 }, (_, i) => `line${i}`).join(" ");
		const commands = compile(textScene(text, 4), SIZE, fonts);
		const lines = JSON.stringify(commands).match(/"baseline"/g) ?? [];
		expect(lines.length).toBeGreaterThan(50);
		await pixels(commands, rt);
		expect(cache.stats().paragraphBuilds).toBeLessThan(10);
		cache.dispose();
	});

	test("a paint through a disposed cache throws", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const commands = compile(scene(SIZE, []), SIZE, fonts);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		await pixels(commands, rt);
		cache.dispose();
		await expect(paintScene(ck, commands, rt)).rejects.toThrow(/disposed/);
		await expect(
			createHeadlessEnv({ fonts, cache }).paint(commands, ck),
		).rejects.toThrow(/disposed/);
	});

	test("repeated paints with the same adjust reuse the LUT images", async () => {
		await initCk();
		const fonts = new Map<string, Uint8Array[]>();
		const adjust = () =>
			composeAdjust(
				buildAdjust({ gamma: 1.4 }),
				buildAdjust({ saturation: 1.5 }),
			);
		const commands = compile(adjustScene([adjust()]), SIZE, fonts);
		const plain = await pixels(commands, runtime(fonts, new Map()).rt);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		expect(await pixels(commands, rt)).toEqual(plain);
		expect(cache.stats().lutImageBuilds).toBe(2);
		expect(await pixels(commands, rt)).toEqual(plain);
		// Equal tables in new arrays match by content.
		const rebuilt = compile(adjustScene([adjust()]), SIZE, fonts);
		expect(await pixels(rebuilt, rt)).toEqual(plain);
		expect(cache.stats().lutImageBuilds).toBe(2);
		cache.dispose();
	});

	test("different LUTs get their own images", async () => {
		await initCk();
		const fonts = new Map<string, Uint8Array[]>();
		const commands = compile(
			adjustScene([buildAdjust({ gamma: 2 }), buildAdjust({ gamma: 0.5 })]),
			SIZE,
			fonts,
		);
		const plain = await pixels(commands, runtime(fonts, new Map()).rt);
		const cache = createPaintCache();
		const px = await pixels(commands, runtime(fonts, new Map(), cache).rt);
		expect(px).toEqual(plain);
		expect(cache.stats().lutImageBuilds).toBe(2);
		const at = (x: number) => px.data[(10 * px.width + x) * 4];
		expect(at(10)).not.toBe(at(34));
		cache.dispose();
	});

	test("a LUT dropped from the scene is evicted and built again", async () => {
		await initCk();
		const fonts = new Map<string, Uint8Array[]>();
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		const adjusted = compile(
			adjustScene([buildAdjust({ gamma: 2 })]),
			SIZE,
			fonts,
		);
		await pixels(adjusted, rt);
		await pixels(compile(adjustScene([{}]), SIZE, fonts), rt);
		await pixels(adjusted, rt);
		expect(cache.stats().lutImageBuilds).toBe(2);
		cache.dispose();
	});
});

describe("LUT images", () => {
	const fake = () => ({ delete: vi.fn() });

	test("equal bytes share an image and different bytes do not", () => {
		const luts = createLutImages();
		const a = new Uint8Array([1, 2, 3]);
		const imgA = cachedLutImage(luts, 1, [a], fake);
		expect(cachedLutImage(luts, 1, [a], fake)).toBe(imgA);
		expect(cachedLutImage(luts, 1, [a.slice()], fake)).toBe(imgA);
		expect(cachedLutImage(luts, 1, [new Uint8Array([1, 2, 4])], fake)).not.toBe(
			imgA,
		);
		expect(cachedLutImage(luts, 2, [a.slice()], fake)).not.toBe(imgA);
		expect(luts.builds).toBe(3);
	});

	test("content matches compare against the bytes seen at build time", () => {
		const luts = createLutImages();
		const a = new Uint8Array([1, 2, 3]);
		const imgA = cachedLutImage(luts, 1, [a], fake);
		const mutated = a.slice();
		a[0] = 9;
		mutated[0] = 9;
		expect(cachedLutImage(luts, 1, [mutated], fake)).not.toBe(imgA);
		expect(cachedLutImage(luts, 1, [new Uint8Array([1, 2, 3])], fake)).toBe(
			imgA,
		);
	});

	test("eviction and freeing delete the images", () => {
		const luts = createLutImages();
		const kept = cachedLutImage(luts, 1, [new Uint8Array([1])], fake);
		const dropped = cachedLutImage(luts, 1, [new Uint8Array([2])], fake);
		evictUnusedLutImages(luts);
		cachedLutImage(luts, 1, [new Uint8Array([1])], fake);
		evictUnusedLutImages(luts);
		expect(dropped.delete).toHaveBeenCalledTimes(1);
		expect(kept.delete).not.toHaveBeenCalled();
		freeLutImages(luts);
		expect(kept.delete).toHaveBeenCalledTimes(1);
	});
});
