// The finishing pass on the CPU against the shader it stands in for, byte for
// byte, on frames that cover every 8-bit value.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { setCpuFinish } from "../src/canvaskit";
import { createHeadlessEnv } from "./helpers/headless";
import {
	compileScene,
	createFrame,
	createImage,
	createPaintCache,
	encodePng,
	type PaintCache,
} from "../src/index";
import { deriveFontMetrics } from "../src/font-metrics";
import { paintCacheState } from "../src/paint-cache-state";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { FrameFinish } from "../src/types";

type Size = { width: number; height: number };

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});
afterEach(() => setCpuFinish(true));

// Pseudo-random pixels, opaque unless `translucent`.
function noisePng(size: Size, translucent = false): Promise<Uint8Array> {
	const px = new Uint8Array(size.width * size.height * 4);
	let r = size.width * 7919 + size.height;
	for (let i = 0; i < px.length; i++) {
		r = (Math.imul(r, 1103515245) + 12345) >>> 0;
		px[i] = i % 4 === 3 && !translucent ? 255 : r >>> 24;
	}
	return encodePng(px, size.width, size.height);
}

async function paint(
	size: Size,
	finish: FrameFinish,
	png: Uint8Array,
	cache: PaintCache,
	cpu: boolean,
): Promise<Uint8Array> {
	const fonts = new Map<string, Uint8Array[]>();
	const textEngine = createParagraphEngine(ck, fonts);
	const commands = compileScene(
		createFrame({
			pos: { x: 0, y: 0 },
			size,
			children: [
				createImage({
					pos: { x: 0, y: 0 },
					size,
					src: "img://noise",
					fit: "cover",
				}),
			],
		}),
		{ ...size, textEngine, fontMetrics: deriveFontMetrics(fonts), finish },
	);
	textEngine.dispose();
	setCpuFinish(cpu);
	const env = createHeadlessEnv({
		fonts,
		images: new Map([["img://noise", png]]),
		cache,
	});
	const out = (await env.paint(commands, ck)) as { bytes: Uint8Array };
	return out.bytes;
}

async function expectSame(
	size: Size,
	finish: FrameFinish,
	translucent = false,
) {
	const png = await noisePng(size, translucent);
	const cache = createPaintCache();
	try {
		const shader = await paint(size, finish, png, cache, false);
		const cpu = await paint(size, finish, png, cache, true);
		expect(cpu).toEqual(shader);
		expect(cache.stats().finishNoiseBuilds).toBe(
			finish.dither && !translucent ? 1 : 0,
		);
	} finally {
		cache.dispose();
	}
}

const SIZES: Size[] = [
	{ width: 1, height: 1 },
	{ width: 37, height: 19 },
	{ width: 256, height: 128 },
];
const SEEDS = [0, 1, 8675309, -42, 999_999];

describe("the finish on the CPU", () => {
	test.each([
		{ whiteClamp: 248 },
		{ blackExtract: 30 },
		{ whiteClamp: 200, blackExtract: 60 },
		{ whiteClamp: 0, blackExtract: 255 },
	])("matches the shader without dither: %o", async (finish) => {
		for (const size of SIZES) await expectSame(size, finish);
	});

	test.each(["per-channel", "monochrome"] as const)(
		"matches the shader with %s dither",
		async (mode) => {
			for (const size of SIZES)
				for (const seed of SEEDS)
					for (const extra of [{}, { whiteClamp: 240, blackExtract: 16 }])
						await expectSame(size, {
							dither: { amount: seed === 1 ? 12 : 4, seed, mode },
							...extra,
						});
		},
	);

	test("matches the shader with a curve", async () => {
		const curve = {
			r: Uint8Array.from({ length: 256 }, (_, i) => 255 - i),
			g: Uint8Array.from({ length: 256 }, (_, i) =>
				Math.round(255 * (i / 255) ** 0.8),
			),
			b: Uint8Array.from({ length: 256 }, (_, i) => Math.min(255, i + 40)),
		};
		for (const size of SIZES)
			for (const extra of [
				{},
				{ whiteClamp: 240, blackExtract: 16 },
				{ dither: { amount: 4, seed: 7, mode: "monochrome" as const } },
			])
				await expectSame(size, { curve, ...extra });
	});

	test("matches the shader with a plain numeric dither", async () => {
		await expectSame(SIZES[2] as Size, { dither: 2.5, whiteClamp: 250 });
	});

	test("leaves a translucent frame to the shader", async () => {
		for (const size of SIZES)
			for (const finish of [
				{ whiteClamp: 200, blackExtract: 60 },
				{ dither: { amount: 4, seed: 3 } },
				{
					curve: {
						r: new Uint8Array(256),
						g: new Uint8Array(256),
						b: new Uint8Array(256),
					},
				},
			])
				await expectSame(size, finish, true);
	});

	test("builds the dither noise once per size, seed and mode", async () => {
		const size = SIZES[1] as Size;
		const png = await noisePng(size);
		const cache = createPaintCache();
		try {
			const finish: FrameFinish = { dither: { amount: 4, seed: 5 } };
			await paint(size, finish, png, cache, true);
			await paint(size, { ...finish, whiteClamp: 250 }, png, cache, true);
			expect(cache.stats().finishNoiseBuilds).toBe(1);
			await paint(size, { dither: { amount: 4, seed: 6 } }, png, cache, true);
			expect(cache.stats().finishNoiseBuilds).toBe(2);
			cache.clear();
			await paint(size, { dither: { amount: 4, seed: 6 } }, png, cache, true);
			expect(cache.stats().finishNoiseBuilds).toBe(3);
		} finally {
			cache.dispose();
		}
	});

	test("counts the noise against the image budget", async () => {
		const size = SIZES[1] as Size;
		const png = await noisePng(size);
		const cache = createPaintCache({ maxImagePixels: 1 });
		try {
			const finish: FrameFinish = { dither: { amount: 4, seed: 5 } };
			await paint(size, finish, png, cache, true);
			await paint(size, finish, png, cache, true);
			expect(cache.stats().finishNoiseBuilds).toBe(2);
		} finally {
			cache.dispose();
		}
	});

	test.each([
		{ width: 1500, height: 1100 },
		{ width: 2022, height: 1276 },
	])("keeps one float of noise per channel at %o", async (size) => {
		const png = await noisePng(size);
		for (const mode of ["monochrome", "per-channel"] as const) {
			const cache = createPaintCache({ maxImagePixels: 48e6 });
			try {
				const finish: FrameFinish = {
					whiteClamp: 254,
					dither: { amount: 2, seed: 0, mode },
				};
				const shader = await paint(size, finish, png, cache, false);
				const cpu = await paint(size, finish, png, cache, true);
				expect(Buffer.from(cpu).equals(shader)).toBe(true);
				const channels = mode === "monochrome" ? 1 : 3;
				expect(paintCacheState(cache).finishNoise?.noise.length).toBe(
					size.width * size.height * channels,
				);
			} finally {
				cache.dispose();
			}
		}
	}, 60_000);

	test("budgets the noise at its own size", async () => {
		const size = { width: 1500, height: 1100 };
		const png = await noisePng(size);
		const pixels = size.width * size.height;
		const cache = createPaintCache({ maxImagePixels: pixels * 2 });
		try {
			const finish: FrameFinish = {
				dither: { amount: 2, seed: 0, mode: "monochrome" },
			};
			await paint(size, finish, png, cache, true);
			await paint(size, finish, png, cache, true);
			expect(cache.stats().finishNoiseBuilds).toBe(1);
			expect(paintCacheState(cache).finishNoise?.noise.length).toBe(pixels);
		} finally {
			cache.dispose();
		}
	}, 60_000);

	test("does not keep noise past the default cap without a budget", async () => {
		const size = { width: 2500, height: 2300 };
		const png = await noisePng(size);
		const cache = createPaintCache();
		try {
			const finish: FrameFinish = {
				dither: { amount: 2, seed: 0, mode: "per-channel" },
			};
			const shader = await paint(size, finish, png, cache, false);
			const cpu = await paint(size, finish, png, cache, true);
			expect(Buffer.from(cpu).equals(shader)).toBe(true);
			expect(paintCacheState(cache).finishNoise).toBeNull();
		} finally {
			cache.dispose();
		}
	}, 120_000);
});
