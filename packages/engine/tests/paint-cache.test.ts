import { createHash } from "node:crypto";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import type { Image } from "canvaskit-wasm";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { buildAdjust, composeAdjust } from "../src/adjust";
import { paintScene } from "../src/canvaskit";
import { clearFontBytesCache } from "../src/font-bytes";
import { createHeadlessEnv } from "./helpers/headless";
import {
	compileScene,
	createFrame,
	createGroup,
	createImage,
	createPaintCache,
	createPath,
	createRect,
	createText,
	encodePng,
	type PaintCache,
} from "../src/index";
import { deriveFontMetrics } from "../src/font-metrics";
import {
	cachedLutImage,
	createLutImages,
	evictUnusedLutImages,
	freeLutImages,
} from "../src/lut-images";
import type { Node } from "../src/node";
import {
	DEFAULT_MAX_BACKGROUND_PIXELS,
	paintCacheState,
	SVG_PICTURE_PIXELS,
} from "../src/paint-cache-state";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { PaintRuntime } from "../src/runtime-types";
import type { Adjust, Command, ResolvedFill, ResolvedFont } from "../src/types";

const FONT = testFontBytes("Geist-Regular.ttf");

let ck: any;
async function initCk() {
	if (!ck)
		ck = await loadCanvasKit();
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

// A 64x64 checker, which the 16px slots in scene() shrink below half size.
async function bigPng(): Promise<Uint8Array> {
	const px = new Uint8Array(64 * 64 * 4);
	for (let y = 0; y < 64; y++)
		for (let x = 0; x < 64; x++)
			px.set(
				(x >> 2) % 2 === (y >> 2) % 2 ? [220, 40, 40, 255] : [40, 90, 220, 255],
				(y * 64 + x) * 4,
			);
	return encodePng(px, 64, 64);
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

function textScene(
	text: string,
	x: number,
	font: Partial<ResolvedFont> = {},
): Node {
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
					...font,
				},
				color: "#101828",
			}),
		],
	});
}

// A ring as two same-direction subpaths: its hole shows only under evenodd.
const RING = "M 0 0 H 20 V 20 H 0 Z M 5 5 H 15 V 15 H 5 Z";

function pathScene(fillRules: ("nonzero" | "evenodd")[]): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: SIZE,
		children: fillRules.map((fillRule, i) =>
			createGroup(
				[
					createPath({
						pos: { x: 0, y: 0 },
						size: { width: 20, height: 20 },
						d: RING,
						fillRule,
						fills: [{ kind: "solid", color: "#101828" }],
					}),
				],
				{
					pos: { x: 4 + i * 24, y: 4 },
					size: { width: 20, height: 20 },
					clip: true,
					cornerRadius: 4,
					cornerSmoothing: 0.6,
				},
			),
		),
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
	extra?: { supersample?: number; precision?: "u8" | "f16" },
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
	const load = vi.fn(env.loadBytes);
	return { rt: { ...env, loadBytes: load }, load };
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

// So a scene painted before is drawn again rather than restored.
function dropBackgrounds(cache: PaintCache): void {
	paintCacheState(cache).backgrounds.length = 0;
}

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

	test("an image budget keeps what other paints drew, oldest out first", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const png = await testPng();
		const images = new Map([
			["img://a", png],
			["img://b", png],
			["img://c", png],
		]);
		const paintEach = async (cache: PaintCache, srcs: string[]) => {
			const { rt } = runtime(fonts, images, cache);
			for (const src of srcs)
				await pixels(compile(scene(SIZE, [src]), SIZE, fonts), rt);
			return cache.stats().imageDecodes;
		};
		const order = ["img://a", "img://b", "img://a"];
		const unbounded = createPaintCache();
		expect(await paintEach(unbounded, order)).toBe(3);
		unbounded.dispose();

		const two = createPaintCache({ maxImagePixels: 32 });
		expect(await paintEach(two, order)).toBe(2);
		expect(await paintEach(two, ["img://c", "img://a", "img://b"])).toBe(4);
		two.dispose();

		const one = createPaintCache({ maxImagePixels: 16 });
		expect(await paintEach(one, order)).toBe(3);
		one.dispose();
	});

	test("an SVG image is weighed by the rasters it embeds", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const raster = `data:image/png;base64,${Buffer.from(await bigPng()).toString("base64")}`;
		const svg = new TextEncoder().encode(
			`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="${raster}" width="8" height="8"/></svg>`,
		);
		const images = new Map([
			["img://art.svg", svg],
			["img://a", await testPng()],
		]);
		const paintEach = async (cache: PaintCache, srcs: string[]) => {
			const { rt } = runtime(fonts, images, cache);
			for (const src of srcs)
				await pixels(compile(scene(SIZE, [src]), SIZE, fonts), rt);
			return cache.stats().imageDecodes;
		};
		const order = ["img://art.svg", "img://a", "img://art.svg"];
		const svgPixels = SVG_PICTURE_PIXELS + 64 * 64;

		const fits = createPaintCache({ maxImagePixels: svgPixels + 16 });
		expect(await paintEach(fits, order)).toBe(2);
		fits.dispose();

		const over = createPaintCache({ maxImagePixels: svgPixels + 15 });
		expect(await paintEach(over, order)).toBe(3);
		over.dispose();
	});

	test("an entry cap evicts however small the images", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const png = await testPng();
		const images = new Map([
			["img://a", png],
			["img://b", png],
		]);
		const cache = createPaintCache({ maxImagePixels: 1_000_000, maxImages: 1 });
		const { rt } = runtime(fonts, images, cache);
		for (const src of ["img://a", "img://b", "img://a"])
			await pixels(compile(scene(SIZE, [src]), SIZE, fonts), rt);
		expect(cache.stats().imageDecodes).toBe(3);
		cache.dispose();
	});

	test("a downscaled image builds its mipmaps once", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const images = new Map([["img://big", await bigPng()]]);
		const commands = compile(scene(SIZE, ["img://big"]), SIZE, fonts);
		const plain = await pixels(commands, runtime(fonts, images).rt);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, images, cache);
		expect(await pixels(commands, rt)).toEqual(plain);
		expect(await pixels(commands, rt)).toEqual(plain);
		expect(cache.stats().mipmapBuilds).toBe(1);
		await pixels(compile(scene(SIZE, []), SIZE, fonts), rt);
		await pixels(commands, rt);
		expect(cache.stats().mipmapBuilds).toBe(2);
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

	test("supersample and f16 working surfaces are kept across paints", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		for (const extra of [
			{ supersample: 2 },
			{ supersample: 4 },
			{ precision: "f16" as const },
		]) {
			const cache = createPaintCache();
			const { rt } = runtime(fonts, new Map(), cache);
			const commands = compile(scene(SIZE, []), SIZE, fonts, extra);
			const plain = await pixels(commands, runtime(fonts, new Map()).rt);
			expect(await pixels(commands, rt)).toEqual(plain);
			const work = [...(paintCacheState(cache).surface?.work.values() ?? [])];
			expect(work.length).toBe(extra.supersample === 4 ? 2 : 1);
			expect(await pixels(commands, rt)).toEqual(plain);
			expect([...(paintCacheState(cache).surface?.work.values() ?? [])]).toEqual(
				work,
			);
			const disposed = work.map((w) => vi.spyOn(w, "dispose"));
			cache.clear();
			for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
			expect(await pixels(commands, rt)).toEqual(plain);
			cache.dispose();
		}
	});

	test("a changed supersample frees the working surfaces it no longer uses", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		await pixels(compile(scene(SIZE, []), SIZE, fonts, { supersample: 4 }), rt);
		const state = paintCacheState(cache);
		const [first] = [...(state.surface?.work.values() ?? [])];
		const spy = vi.spyOn(first as object as { dispose(): void }, "dispose");
		await pixels(compile(scene(SIZE, []), SIZE, fonts, { supersample: 2 }), rt);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(state.surface?.work.size).toBe(1);
		expect(cache.stats().surfaceCreates).toBe(1);
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

	test("each field that shapes a line is in its key", async () => {
		await initCk();
		const fonts = new Map([["Geist", [FONT]]]);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		const variants: Partial<ResolvedFont>[] = [
			{},
			{ size: 15 },
			{ weight: 700 },
			{ letterSpacing: 1 },
			{ features: { tnum: 1 } },
			{ features: { tnum: 0 } },
			{ variations: { wght: 600 } },
		];
		let built = 0;
		for (const font of variants) {
			const commands = compile(textScene("Key 10", 4, font), SIZE, fonts);
			const plain = await pixels(commands, runtime(fonts, new Map()).rt);
			expect(await pixels(commands, rt)).toEqual(plain);
			expect(cache.stats().paragraphBuilds).toBeGreaterThan(built);
			built = cache.stats().paragraphBuilds;
			await pixels(commands, rt);
			expect(cache.stats().paragraphBuilds).toBe(built);
		}
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

	test("repeated paints reuse parsed paths", async () => {
		await initCk();
		const fonts = new Map<string, Uint8Array[]>();
		const commands = compile(
			pathScene(["nonzero", "evenodd", "nonzero"]),
			SIZE,
			fonts,
		);
		const plain = await pixels(commands, runtime(fonts, new Map()).rt);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		const px = await pixels(commands, rt);
		expect(px).toEqual(plain);
		// Each fill rule parses the ring once, and the placements share one clip.
		expect(cache.stats().pathBuilds).toBe(3);
		expect(await pixels(commands, rt)).toEqual(plain);
		expect(cache.stats().pathBuilds).toBe(3);
		const at = (x: number) => px.data[(14 * px.width + x) * 4 + 3];
		expect(at(14)).toBe(255);
		expect(at(38)).toBe(0);
		cache.dispose();
	});

	test("a path dropped from the scene is evicted and parsed again", async () => {
		await initCk();
		const fonts = new Map<string, Uint8Array[]>();
		const cache = createPaintCache();
		const { rt } = runtime(fonts, new Map(), cache);
		const withPath = compile(pathScene(["evenodd"]), SIZE, fonts);
		await pixels(withPath, rt);
		expect(cache.stats().pathBuilds).toBe(2);
		await pixels(compile(pathScene([]), SIZE, fonts), rt);
		dropBackgrounds(cache);
		const again = await pixels(withPath, rt);
		expect(cache.stats().pathBuilds).toBe(4);
		expect(again).toEqual(await pixels(withPath, runtime(fonts, new Map()).rt));
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
		const a = adjust();
		const b = adjust();
		expect(b.lut?.r).toBe(a.lut?.r);
		expect(b.lut3d?.data).toBe(a.lut3d?.data);
		const rebuilt = compile(adjustScene([b]), SIZE, fonts);
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
		dropBackgrounds(cache);
		await pixels(adjusted, rt);
		expect(cache.stats().lutImageBuilds).toBe(2);
		cache.dispose();
	});
});

describe("LUT images", () => {
	const fake = () => ({ delete: vi.fn() }) as unknown as Image;

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

	test("a failed build is not kept", () => {
		const luts = createLutImages();
		const a = new Uint8Array([1, 2, 3]);
		expect(cachedLutImage(luts, 1, [a], () => null)).toBeNull();
		const img = fake();
		expect(cachedLutImage(luts, 1, [a], () => img)).toBe(img);
		expect(cachedLutImage(luts, 1, [a], fake)).toBe(img);
	});

	test("eviction and freeing delete the images", () => {
		const luts = createLutImages();
		const kept = cachedLutImage(luts, 1, [new Uint8Array([1])], fake);
		const dropped = cachedLutImage(luts, 1, [new Uint8Array([2])], fake);
		evictUnusedLutImages(luts);
		cachedLutImage(luts, 1, [new Uint8Array([1])], fake);
		evictUnusedLutImages(luts);
		expect(dropped?.delete).toHaveBeenCalledTimes(1);
		expect(kept?.delete).not.toHaveBeenCalled();
		freeLutImages(luts);
		expect(kept?.delete).toHaveBeenCalledTimes(1);
	});
});

const GRADIENT: ResolvedFill[] = [
	{
		kind: "linear",
		from: { x: 0, y: 0 },
		to: { x: 1, y: 1 },
		stops: [
			{ offset: 0, color: "#1e1b4b" },
			{ offset: 1, color: "#7c3aed" },
		],
	},
	{
		kind: "radial",
		center: { x: 0.9, y: 0.05 },
		radius: 0.6,
		stops: [
			{ offset: 0, color: "#f472b699" },
			{ offset: 1, color: "#f472b600" },
		],
	},
];

function cardScene(
	name: string,
	opts: { fills?: ResolvedFill[]; accent?: string } = {},
): Node {
	return createFrame({
		pos: { x: 0, y: 0 },
		size: SIZE,
		clip: true,
		cornerRadius: 6,
		background: createRect({
			pos: { x: 0, y: 0 },
			size: SIZE,
			fills: opts.fills ?? GRADIENT,
		}),
		children: [
			createPath({
				pos: { x: 4, y: 4 },
				size: { width: 20, height: 20 },
				d: RING,
				fillRule: "evenodd",
				fills: [{ kind: "solid", color: opts.accent ?? "#ffffff" }],
			}),
			createText({
				pos: { x: 28, y: 4 },
				size: { width: 64, height: 24 },
				text: name,
				font: {
					family: "Geist",
					weight: 400,
					style: "normal",
					size: 16,
					lineHeight: 1.2,
				},
				color: "#ffffff",
			}),
		],
	});
}

type Spec =
	| { rect: string }
	| { text: string }
	| { image: string }
	| { group: Spec[]; opacity?: number };

let slot = 0;
function build(spec: Spec): Node {
	const pos = { x: (slot % 6) * 14 + 2, y: Math.floor(slot / 6) * 14 + 2 };
	slot++;
	if ("rect" in spec)
		return createRect({
			pos,
			size: { width: 12, height: 12 },
			fills: [{ kind: "solid", color: spec.rect }],
		});
	if ("image" in spec)
		return createImage({
			pos,
			size: { width: 12, height: 12 },
			src: spec.image,
			fit: "cover",
		});
	if ("text" in spec)
		return createText({
			pos,
			size: { width: 40, height: 14 },
			text: spec.text,
			font: {
				family: "Geist",
				weight: 400,
				style: "normal",
				size: 10,
				lineHeight: 1.2,
			},
			color: "#101828",
		});
	return createGroup(spec.group.map(build), { opacity: spec.opacity });
}

function specScene(specs: Spec[]): Node {
	slot = 0;
	return createFrame({
		pos: { x: 0, y: 0 },
		size: SIZE,
		background: createRect({
			pos: { x: 0, y: 0 },
			size: SIZE,
			fills: [{ kind: "solid", color: "#f5f0e6" }],
		}),
		children: specs.map(build),
	});
}

function nested(name: string): Spec[] {
	return [
		{
			group: [
				{ group: [{ rect: "#ef4444" }, { rect: "#3b82f6" }, { text: name }] },
				{ text: "fixed" },
			],
		},
		{ rect: "#22c55e" },
	];
}

function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Two trees of the same shape whose text and image leaves differ.
function randomPair(rand: () => number, depth: number): [Spec[], Spec[]] {
	const colors = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7"];
	const names = ["Ada", "Grace", "Hedy", "Joan"];
	const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)] as T;
	const level = (d: number): [Spec[], Spec[]] => {
		const a: Spec[] = [];
		const b: Spec[] = [];
		const n = 1 + Math.floor(rand() * 4);
		for (let i = 0; i < n; i++) {
			const r = rand();
			if (d > 0 && r < 0.4) {
				const [ga, gb] = level(d - 1);
				const opacity = rand() < 0.2 ? 0.5 : undefined;
				a.push({ group: ga, opacity });
				b.push({ group: gb, opacity });
			} else if (r < 0.65) {
				const c = pick(colors);
				a.push({ rect: c });
				b.push({ rect: c });
			} else if (r < 0.85) {
				a.push({ text: pick(names) });
				b.push({ text: pick(names) });
			} else {
				a.push({ image: pick(["img://a", "img://b"]) });
				b.push({ image: pick(["img://a", "img://b"]) });
			}
		}
		return [a, b];
	};
	return level(depth);
}

describe("PaintCache background", () => {
	const fonts = new Map([["Geist", [FONT]]]);
	const images = new Map<string, Uint8Array>();
	beforeAll(async () => {
		images.set("img://a", await testPng());
		images.set("img://b", await bigPng());
	});

	// Paints each scene through one cache and checks it against an uncached
	// paint of the same scene.
	async function paintRecords(
		nodes: Node[],
		cache: PaintCache,
		extra?: { supersample?: number },
	) {
		const { rt } = runtime(fonts, images, cache);
		for (const node of nodes) {
			const commands = compile(node, SIZE, fonts, extra);
			const plain = await pixels(commands, runtime(fonts, images).rt);
			expect(await pixels(commands, rt)).toEqual(plain);
		}
	}

	test("a second record reuses the background pixels", async () => {
		await initCk();
		for (const extra of [{}, { supersample: 2 }]) {
			const cache = createPaintCache();
			await paintRecords(
				[
					cardScene("Ada"),
					cardScene("Ada"),
					cardScene("Grace"),
					cardScene("Hedy"),
				],
				cache,
				extra,
			);
			expect(cache.stats()).toMatchObject({
				backgroundSnapshots: 1,
				backgroundReuses: 2,
			});
			cache.dispose();
		}
	});

	test("a different gradient replaces the background", async () => {
		await initCk();
		const other = GRADIENT.map((fill, i) =>
			i === 0 && fill.kind === "linear"
				? {
						...fill,
						stops: [{ offset: 0, color: "#09090b" }, ...fill.stops.slice(1)],
					}
				: fill,
		);
		const cache = createPaintCache();
		await paintRecords(
			[
				cardScene("Ada"),
				cardScene("Ada"),
				cardScene("Grace", { fills: other }),
				cardScene("Hedy", { fills: other }),
				cardScene("Margaret", { fills: other }),
			],
			cache,
		);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 2,
			backgroundReuses: 1,
		});
		cache.dispose();
	});

	test("a record-bound color keeps only the run before it", async () => {
		await initCk();
		const cache = createPaintCache();
		await paintRecords(
			[
				cardScene("Ada", { accent: "#ff0000" }),
				cardScene("Grace", { accent: "#00ff00" }),
				cardScene("Hedy", { accent: "#0000ff" }),
				cardScene("Margaret", { accent: "#ffff00" }),
			],
			cache,
		);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 1,
			backgroundReuses: 2,
		});
		cache.dispose();
	});

	test("a background over the image budget is not kept", async () => {
		await initCk();
		const cache = createPaintCache({ maxImagePixels: 100 });
		await paintRecords([cardScene("Ada"), cardScene("Grace")], cache);
		expect(cache.stats()).toMatchObject({ backgroundReuses: 0 });
		cache.dispose();
	});

	test("clear() drops the background", async () => {
		await initCk();
		const cache = createPaintCache();
		await paintRecords([cardScene("Ada"), cardScene("Ada")], cache);
		cache.clear();
		await paintRecords([cardScene("Grace"), cardScene("Grace")], cache);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 2,
			backgroundReuses: 0,
		});
		cache.dispose();
	});

	function tinted(color: string): ResolvedFill[] {
		return GRADIENT.map((fill, i) =>
			i === 0 && fill.kind === "linear"
				? {
						...fill,
						stops: [{ offset: 0, color }, ...fill.stops.slice(1)],
					}
				: fill,
		);
	}

	function sides(names: string[]): Node[] {
		const back = tinted("#09090b");
		return names.map((name, i) =>
			i % 2 ? cardScene(name, { fills: back }) : cardScene(name),
		);
	}

	test("alternating sides reuse both backgrounds", async () => {
		await initCk();
		for (const extra of [{}, { supersample: 2 }]) {
			const cache = createPaintCache();
			await paintRecords(
				sides(["Ada", "Ada", "Grace", "Grace", "Hedy", "Hedy", "Ada", "Ada"]),
				cache,
				extra,
			);
			expect(cache.stats()).toMatchObject({
				backgroundSnapshots: 2,
				backgroundReuses: 4,
			});
			cache.dispose();
		}
	});

	test("alternating sides hash as an uncached paint does", async () => {
		await initCk();
		const hash = (px: { data: Uint8Array }) =>
			createHash("sha256").update(px.data).digest("hex");
		const cache = createPaintCache();
		const { rt } = runtime(fonts, images, cache);
		for (const node of sides(Array(8).fill("Ada"))) {
			const commands = compile(node, SIZE, fonts);
			const plain = await pixels(commands, runtime(fonts, images).rt);
			expect(hash(await pixels(commands, rt))).toBe(hash(plain));
		}
		expect(cache.stats().backgroundReuses).toBe(4);
		cache.dispose();
	});

	test("the least recently used background goes past the cap", async () => {
		await initCk();
		const colors = ["#000000", "#111111", "#222222", "#333333", "#444444"];
		const cache = createPaintCache();
		await paintRecords(
			[
				...colors.flatMap((c) => [c, c]),
				colors[1] as string,
				colors[0] as string,
				colors[0] as string,
			].map((c) => cardScene("Ada", { fills: tinted(c) })),
			cache,
		);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 6,
			backgroundReuses: 1,
		});
		cache.dispose();
	});

	test("the image budget evicts backgrounds that do not fit together", async () => {
		await initCk();
		const one = SIZE.width * SIZE.height;
		const cache = createPaintCache({ maxImagePixels: one * 1.5 });
		await paintRecords(sides(Array(6).fill("Ada")), cache);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 4,
			backgroundReuses: 0,
		});
		cache.dispose();
	});

	test("text inside a nested group ends the run", async () => {
		await initCk();
		for (const extra of [{}, { supersample: 2 }]) {
			const cache = createPaintCache();
			await paintRecords(
				[specScene(nested("Alice")), specScene(nested("Bob"))],
				cache,
				extra,
			);
			cache.dispose();
		}
	});

	test("deeper record-bound leaves end the run", async () => {
		await initCk();
		const variants: ((v: string, src: string) => Spec[])[] = [
			(v) => [
				{ group: [{ group: [{ group: [{ rect: "#ef4444" }, { text: v }] }] }] },
				{ rect: "#22c55e" },
				{ rect: "#3b82f6" },
			],
			(v) => [
				{ group: [{ rect: "#ef4444" }, { group: [{ text: v }] }] },
				{ group: [{ rect: "#22c55e" }] },
			],
			(_, src) => [
				{ group: [{ group: [{ rect: "#ef4444" }, { image: src }] }, { rect: "#a855f7" }] },
				{ rect: "#22c55e" },
			],
			(v) => [
				{ group: [{ group: [{ rect: "#ef4444" }] }, { group: [{ text: v }, { rect: "#3b82f6" }] }] },
				{ rect: "#22c55e" },
			],
		];
		for (const variant of variants) {
			const cache = createPaintCache();
			await paintRecords(
				[
					specScene(variant("Alice", "img://a")),
					specScene(variant("Bob", "img://b")),
					specScene(variant("Carol", "img://a")),
				],
				cache,
			);
			cache.dispose();
		}
	});

	test("an isolated group is never split around a record-bound leaf", async () => {
		await initCk();
		const isolated = (name: string) =>
			createFrame({
				pos: { x: 0, y: 0 },
				size: SIZE,
				background: createRect({
					pos: { x: 0, y: 0 },
					size: SIZE,
					fills: [{ kind: "solid", color: "#f97316" }],
				}),
				children: [
					createGroup(
						[
							createRect({
								pos: { x: 4, y: 4 },
								size: { width: 40, height: 20 },
								fills: [{ kind: "solid", color: "#3b82f6" }],
							}),
							createText({
								pos: { x: 4, y: 30 },
								size: { width: 60, height: 14 },
								text: name,
								font: {
									family: "Geist",
									weight: 400,
									style: "normal",
									size: 10,
									lineHeight: 1.2,
								},
								color: "#101828",
							}),
							createRect({
								pos: { x: 24, y: 10 },
								size: { width: 40, height: 20 },
								fills: [{ kind: "solid", color: "#22c55e" }],
								blendMode: "multiply",
							}),
						],
						{ pos: { x: 0, y: 0 }, size: SIZE, isolate: true },
					),
				],
			});
		const cache = createPaintCache();
		await paintRecords(
			[isolated("Alice"), isolated("Bob"), isolated("Carol")],
			cache,
		);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 1,
			backgroundReuses: 1,
		});
		cache.dispose();
	});

	test("a backdrop-blurred group is never split around a record-bound leaf", async () => {
		await initCk();
		const glass = (name: string) =>
			createFrame({
				pos: { x: 0, y: 0 },
				size: SIZE,
				background: createRect({
					pos: { x: 0, y: 0 },
					size: SIZE,
					fills: [{ kind: "solid", color: "#f97316" }],
				}),
				children: [
					createRect({
						pos: { x: 0, y: 0 },
						size: { width: 48, height: 48 },
						fills: [{ kind: "solid", color: "#1d4ed8" }],
					}),
					createGroup(
						[
							createRect({
								pos: { x: 4, y: 4 },
								size: { width: 20, height: 20 },
								fills: [{ kind: "solid", color: "#22c55e" }],
							}),
							createText({
								pos: { x: 4, y: 30 },
								size: { width: 60, height: 14 },
								text: name,
								font: {
									family: "Geist",
									weight: 400,
									style: "normal",
									size: 10,
									lineHeight: 1.2,
								},
								color: "#101828",
							}),
						],
						{
							pos: { x: 24, y: 8 },
							size: { width: 48, height: 40 },
							backdropBlur: 10,
						},
					),
				],
			});
		const cache = createPaintCache();
		await paintRecords([glass("Alice"), glass("Bob")], cache);
		cache.dispose();
	});

	test("a backdrop over a swapped image paints as uncached", async () => {
		await initCk();
		const photo = (src: string) =>
			createFrame({
				pos: { x: 0, y: 0 },
				size: SIZE,
				children: [
					createImage({
						pos: { x: 0, y: 0 },
						size: SIZE,
						src,
						fit: "cover",
					}),
					createRect({
						pos: { x: 8, y: 8 },
						size: { width: 40, height: 30 },
						cornerRadius: 6,
						fills: [{ kind: "solid", color: "#ffffff40" }],
						backdropBlur: 8,
					}),
				],
			});
		const cache = createPaintCache();
		await paintRecords(
			[photo("img://a"), photo("img://b"), photo("img://a")],
			cache,
		);
		cache.dispose();
	});

	test("random scenes differing in text and images paint as uncached", async () => {
		await initCk();
		const rand = mulberry32(81);
		for (let i = 0; i < 120; i++) {
			const [a, b] = randomPair(rand, 1 + (i % 4));
			const cache = createPaintCache();
			await paintRecords([specScene(a), specScene(b), specScene(a)], cache);
			cache.dispose();
		}
	});

	// Paints `commands` and counts the canvas readbacks the paint itself made.
	async function readbacks(commands: Command[], rt: PaintRuntime) {
		const spy = vi.spyOn(ck.Canvas.prototype, "readPixels");
		try {
			const out = await paintScene(ck, commands, rt);
			out.dispose();
			return spy.mock.calls.length;
		} finally {
			spy.mockRestore();
		}
	}

	test("a background the budget cannot hold is never read back", async () => {
		await initCk();
		const cache = createPaintCache({ maxImagePixels: 4096 + 100 });
		const { rt } = runtime(fonts, images, cache);
		const commands = compile(
			specScene([{ rect: "#ef4444" }, { image: "img://b" }]),
			SIZE,
			fonts,
		);
		expect(await readbacks(commands, rt)).toBe(0);
		expect(await readbacks(commands, rt)).toBe(0);
		expect(cache.stats()).toMatchObject({
			imageDecodes: 1,
			backgroundSnapshots: 0,
			backgroundReuses: 0,
		});
		cache.dispose();
	});


	// So the frame's group is entered, each leading rect keyed on its own.
	const label = () =>
		createText({
			pos: { x: 4, y: 40 },
			size: { width: 60, height: 14 },
			text: "label",
			font: {
				family: "Geist",
				weight: 400,
				style: "normal",
				size: 10,
				lineHeight: 1.2,
			},
			color: "#101828",
		});

	function dragged(x: number): Node {
		return createFrame({
			pos: { x: 0, y: 0 },
			size: SIZE,
			children: [
				createRect({
					pos: { x, y: 4 },
					size: { width: 20, height: 20 },
					fills: [{ kind: "solid", color: "#ef4444" }],
				}),
				createRect({
					pos: { x: 40, y: 20 },
					size: { width: 30, height: 20 },
					fills: [{ kind: "solid", color: "#3b82f6" }],
				}),
				label(),
			],
		});
	}

	test("a lead that changes every paint is never read back", async () => {
		await initCk();
		const cache = createPaintCache();
		const { rt } = runtime(fonts, images, cache);
		let reads = 0;
		for (let x = 0; x < 6; x++)
			reads += await readbacks(compile(dragged(x), SIZE, fonts), rt);
		expect(reads).toBe(0);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 0,
			backgroundReuses: 0,
		});
		expect(paintCacheState(cache).backgrounds).toEqual([]);
		cache.dispose();
	});

	test("a repeated lead is read back once and then reused", async () => {
		await initCk();
		const cache = createPaintCache();
		const { rt } = runtime(fonts, images, cache);
		const reads: number[] = [];
		for (let i = 0; i < 4; i++)
			reads.push(await readbacks(compile(dragged(3), SIZE, fonts), rt));
		expect(reads).toEqual([0, 1, 0, 0]);
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 1,
			backgroundReuses: 2,
		});
		cache.dispose();
	});

	test("a stable lead survives a later drawable moving", async () => {
		await initCk();
		const cache = createPaintCache();
		const { rt } = runtime(fonts, images, cache);
		const move = (x: number) =>
			createFrame({
				pos: { x: 0, y: 0 },
				size: SIZE,
				children: [
					createRect({
						pos: { x: 0, y: 0 },
						size: SIZE,
						fills: [{ kind: "solid", color: "#f5f0e6" }],
					}),
					createRect({
						pos: { x, y: 4 },
						size: { width: 20, height: 20 },
						fills: [{ kind: "solid", color: "#ef4444" }],
					}),
					label(),
				],
			});
		for (let x = 0; x < 5; x++) {
			const commands = compile(move(x), SIZE, fonts);
			const plain = await pixels(commands, runtime(fonts, images).rt);
			expect(await pixels(commands, rt)).toEqual(plain);
		}
		expect(cache.stats()).toMatchObject({
			backgroundSnapshots: 1,
			backgroundReuses: 3,
		});
		cache.dispose();
	});

	test("a command's key is stringified once across paints", async () => {
		await initCk();
		const cache = createPaintCache();
		const { rt } = runtime(fonts, images, cache);
		const commands = compile(dragged(3), SIZE, fonts);
		const spy = vi.spyOn(JSON, "stringify");
		try {
			await readbacks(commands, rt);
			const first = spy.mock.calls.length;
			await readbacks(commands, rt);
			expect(spy.mock.calls.length - first).toBeLessThan(first);
		} finally {
			spy.mockRestore();
		}
		cache.dispose();
	});

	test("an unbudgeted cache keeps no background over the default cap", async () => {
		await initCk();
		const side = Math.ceil(Math.sqrt(DEFAULT_MAX_BACKGROUND_PIXELS)) + 1;
		const size = { width: side, height: side };
		const commands = compile(
			createFrame({
				pos: { x: 0, y: 0 },
				size,
				background: createRect({
					pos: { x: 0, y: 0 },
					size,
					fills: [{ kind: "solid", color: "#f5f0e6" }],
				}),
				children: [],
			}),
			size,
			fonts,
		);
		const cache = createPaintCache();
		const { rt } = runtime(fonts, images, cache);
		expect(await readbacks(commands, rt)).toBe(0);
		expect(cache.stats().backgroundSnapshots).toBe(0);
		cache.dispose();
	});
});
