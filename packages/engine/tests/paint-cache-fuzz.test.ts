// Paints random sequences of scenes through one PaintCache and checks every
// paint against a fresh uncached one, pixels and warnings byte for byte.
// FUZZ_ITERATIONS runs more sequences and FUZZ_SEED moves the first seed, so
// `FUZZ_SEED=<seed> FUZZ_ITERATIONS=1` replays a failure.
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import type { CanvasKit } from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { paintScene } from "../src/canvaskit";
import { createHeadlessEnv } from "./helpers/headless";
import {
	compileScene,
	createPaintCache,
	type PaintCache,
} from "../src/index";
import { deriveFontMetrics } from "../src/font-metrics";
import type { Node } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { TextEngine } from "../src/text-engine";
import type { PaintWarning } from "../src/types";
import {
	type Config,
	config,
	fuzzImages,
	mutate,
	rng,
	scene,
} from "./scene-gen";

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS) || 20;
const FIRST_SEED = Number(process.env.FUZZ_SEED) || 1;

const FONTS = new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]);
let IMAGES = new Map<string, Uint8Array>();

let ck: CanvasKit;
let textEngine: TextEngine;
const fontMetrics = deriveFontMetrics(FONTS);

beforeAll(async () => {
	ck = await loadCanvasKit();
	textEngine = createParagraphEngine(ck, FONTS);
	IMAGES = await fuzzImages();
});

async function paint(
	node: Node,
	cfg: Config,
	cache?: PaintCache,
): Promise<{ pixels: Uint8Array; warnings: PaintWarning[] }> {
	const commands = compileScene(node, {
		...cfg.size,
		textEngine,
		fontMetrics,
		finish: cfg.finish,
		scale: cfg.scale,
		supersample: cfg.supersample,
	});
	const rt = createHeadlessEnv({ fonts: FONTS, images: IMAGES, cache });
	const out = await paintScene(ck, commands, rt);
	try {
		const px = out.readPixels?.();
		if (!px) throw new Error("no pixels");
		return { pixels: px.data, warnings: out.warnings };
	} finally {
		out.dispose();
	}
}

function differingPixels(a: Uint8Array, b: Uint8Array): number {
	if (a.length !== b.length) return Math.max(a.length, b.length) / 4;
	let n = 0;
	for (let i = 0; i < a.length; i += 4)
		if (
			a[i] !== b[i] ||
			a[i + 1] !== b[i + 1] ||
			a[i + 2] !== b[i + 2] ||
			a[i + 3] !== b[i + 3]
		)
			n++;
	return n;
}

// Paints 4-10 steps over 2-4 variants, mostly alternating so each is painted
// at least twice, usually with a new record each time. Each step is compared
// with an uncached paint of the same scene.
async function run(
	seed: number,
	override?: Partial<Config>,
	maxSteps = 10,
): Promise<void> {
	const r = rng(seed);
	const cfg = { ...config(r), ...override };
	const variants = Array.from({ length: r.int(2, 4) }, () =>
		scene(r, cfg.style, cfg.size),
	);
	const steps = Math.min(r.int(Math.max(4, 2 * variants.length), 10), maxSteps);
	const cache = createPaintCache(cfg.cache);
	try {
		for (let step = 0; step < steps; step++) {
			const v = r.chance(0.8)
				? step % variants.length
				: r.int(0, variants.length - 1);
			if (step >= variants.length && r.chance(0.9))
				mutate(r, variants[v] as Node);
			const node = variants[v] as Node;
			const cached = await paint(node, cfg, cache);
			const plain = await paint(node, cfg);
			const where = `seed ${seed}, step ${step}, variant ${v}, config ${JSON.stringify({ ...cfg, style: cfg.style.name })}; replay with FUZZ_SEED=${seed} FUZZ_ITERATIONS=1`;
			expect(cached.warnings, where).toEqual(plain.warnings);
			const diff = differingPixels(cached.pixels, plain.pixels);
			if (diff) throw new Error(`${diff} pixels differ at ${where}`);
		}
	} finally {
		cache.dispose();
	}
}

const SEEDS = Array.from({ length: ITERATIONS }, (_, i) => FIRST_SEED + i);

describe("PaintCache against uncached paints", () => {
	test.each(SEEDS)("seed %i", (seed) => run(seed), 60_000);

	test("a dithered frame over 2000 px wide", async () => {
		await run(
			FIRST_SEED,
			{
				size: { width: 1060, height: 500 },
				scale: 2,
				supersample: 1,
				cache: { maxImagePixels: 50_000_000 },
				finish: {
					dither: { amount: 4, seed: 7, mode: "monochrome" },
					whiteClamp: 250,
				},
			},
			4,
		);
	}, 60_000);
});
