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
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createPaintCache,
	createPath,
	createRect,
	createText,
	encodePng,
	type PaintCache,
	type PaintCacheOptions,
} from "../src/index";
import { deriveFontMetrics } from "../src/font-metrics";
import type { Node, Transform } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type {
	BlendMode,
	FrameFinish,
	PaintWarning,
	ResolvedFill,
} from "../src/types";
import type { TextEngine } from "../src/text-engine";

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS) || 20;
const FIRST_SEED = Number(process.env.FUZZ_SEED) || 1;

const FONTS = new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]);
const IMAGES = new Map<string, Uint8Array>();
const SRCS = ["img://quarters", "img://checker", "img://wide", "img://alpha"];

let ck: CanvasKit;
let textEngine: TextEngine;
const fontMetrics = deriveFontMetrics(FONTS);

beforeAll(async () => {
	ck = await loadCanvasKit();
	textEngine = createParagraphEngine(ck, FONTS);
	const sizes = [
		[4, 4, 255],
		[64, 64, 255],
		[48, 20, 255],
		[24, 24, 120],
	] as const;
	for (const [i, [w, h, alpha]] of sizes.entries()) {
		const px = new Uint8Array(w * h * 4);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++)
				px.set(
					(x >> i) % 2 === (y >> i) % 2
						? [220, 40 + i * 40, 40, alpha]
						: [40, 90, 220 - i * 30, alpha],
					(y * w + x) * 4,
				);
		IMAGES.set(SRCS[i] as string, await encodePng(px, w, h));
	}
});

type Size = { width: number; height: number };

type Rand = {
	next(): number;
	int(lo: number, hi: number): number;
	pick<T>(xs: readonly T[]): T;
	chance(p: number): boolean;
};

function rng(seed: number): Rand {
	let a = seed | 0;
	const next = () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
		pick: (xs) => xs[Math.floor(next() * xs.length)] as (typeof xs)[number],
		chance: (p) => next() < p,
	};
}

const COLORS = [
	"#ef4444",
	"#3b82f6",
	"#22c55e",
	"#a855f7",
	"#f59e0b",
	"#101828",
	"#ffffff",
	"#0ea5e980",
];
const WORDS = [
	"Ada",
	"Grace",
	"Hedy",
	"Joan",
	"Radia",
	"Katherine",
	"Lovelace",
];
const PATHS = [
	"M 0 0 H 20 V 20 H 0 Z M 5 5 H 15 V 15 H 5 Z",
	"M 10 0 L 20 20 L 0 20 Z",
	"M 0 10 C 0 0 20 0 20 10 S 0 20 0 10 Z",
	"M 0 0 L 20 0 L 0 20 L 20 20 Z",
];
const BLENDS: BlendMode[] = [
	"multiply",
	"screen",
	"overlay",
	"difference",
	"luminosity",
	"plus",
];

function fill(r: Rand): ResolvedFill {
	const stops = [
		{ offset: 0, color: r.pick(COLORS) },
		{ offset: 1, color: r.pick(COLORS) },
	];
	switch (r.int(0, 4)) {
		case 0:
			return {
				kind: "linear",
				stops,
				from: { x: 0, y: 0 },
				to: { x: 1, y: 1 },
			};
		case 1:
			return {
				kind: "radial",
				stops,
				center: { x: r.next(), y: r.next() },
				radius: 0.2 + r.next(),
			};
		case 2:
			return {
				kind: "angular",
				stops,
				center: { x: 0.5, y: 0.5 },
				rotation: r.int(0, 359),
			};
		default:
			return { kind: "solid", color: r.pick(COLORS) };
	}
}

function box(r: Rand, size: Size, share = 0.6) {
	const width = r.int(8, Math.max(8, Math.floor(size.width * share)));
	const height = r.int(8, Math.max(8, Math.floor(size.height * share)));
	return {
		pos: {
			x: r.int(-4, size.width - width + 4),
			y: r.int(-4, size.height - height + 4),
		},
		size: { width, height },
	};
}

// How a scene is built. A layered scene stacks effects, blends and clips. A
// flat one is a template's: plain containers of shapes with text and images as
// the record's fields, which the background run walks deep into.
type Style = {
	name: string;
	effects: number;
	layers: number;
	fields: number;
	// How often a node is a group rather than a leaf, at the top and below.
	groups: [number, number];
};
const LAYERED: Style = {
	name: "layered",
	effects: 0.15,
	layers: 0.4,
	fields: 0.45,
	groups: [0.5, 0.4],
};
const FLAT: Style = {
	name: "flat",
	effects: 0.02,
	layers: 0.05,
	fields: 0.35,
	groups: [0.75, 0.5],
};

// Layer effects, rarely more than one per node. A spread dilates the whole
// layer, which costs seconds on a large group, so only leaves get one.
function effects(r: Rand, p: number, spread = true): Partial<Transform> {
	const out: Partial<Transform> = {};
	if (r.chance(p)) out.opacity = r.pick([0.3, 0.6, 0.9]);
	if (r.chance(p)) out.rotation = r.int(-40, 40);
	if (r.chance(p / 2)) out.blendMode = r.pick(BLENDS);
	if (r.chance(p / 2)) out.blur = r.pick([0.5, 2, 4]);
	if (r.chance(p / 2))
		out.shadow = {
			color: r.pick(["#00000066", "#1e1b4b99"]),
			dx: r.int(-3, 3),
			dy: r.int(0, 4),
			blur: r.int(0, 6),
			...(spread && r.chance(0.3) ? { spread: r.int(-1, 2) } : {}),
		};
	return out;
}

function field(r: Rand, style: Style, size: Size): Node {
	const b = box(r, size);
	const fx = effects(r, style.effects);
	if (r.chance(0.25))
		return createImage({
			...b,
			...fx,
			src: r.chance(0.05) ? "img://missing" : r.pick(SRCS),
			fit: r.pick(["cover", "contain", "fill", "tile"] as const),
		});
	return createText({
		...b,
		...fx,
		size: { width: b.size.width + 30, height: b.size.height },
		text: `${r.pick(WORDS)} ${r.pick(WORDS)}`,
		font: {
			family: "Geist",
			weight: 400,
			style: "normal",
			size: r.int(7, 18),
			lineHeight: 1.2,
		},
		color: r.pick(COLORS),
		...(r.chance(0.2) ? { fill: fill(r) } : {}),
		...(r.chance(0.3) ? { align: r.pick(["center", "right"] as const) } : {}),
	});
}

function shape(r: Rand, style: Style, size: Size): Node {
	const b = box(r, size, 0.4);
	const fx = effects(r, style.effects);
	const stroke = r.chance(0.25)
		? { stroke: { color: r.pick(COLORS), width: r.int(1, 3) } }
		: {};
	switch (r.int(0, 2)) {
		case 0:
			return createPath({
				...b,
				...fx,
				...stroke,
				d: r.pick(PATHS),
				viewBox: { width: 20, height: 20 },
				fillRule: r.pick(["nonzero", "evenodd"] as const),
				fills: [fill(r)],
			});
		case 1:
			return createEllipse({ ...b, ...fx, ...stroke, fills: [fill(r)] });
		default:
			return createRect({
				...b,
				...fx,
				...stroke,
				fills: r.chance(0.3) ? [fill(r), fill(r)] : [fill(r)],
				...(r.chance(0.4) ? { cornerRadius: r.int(0, 10) } : {}),
			});
	}
}

function leaf(r: Rand, style: Style, size: Size): Node {
	return r.chance(style.fields) ? field(r, style, size) : shape(r, style, size);
}

// Most groups are frames with a fill, which compile to the fill's shape
// under the frame's children. A clipping group places its children in its
// own box.
function group(r: Rand, style: Style, size: Size, depth: number): Node {
	const clip = r.chance(0.25) ? box(r, size) : null;
	const inner = clip?.size ?? size;
	const children: Node[] = r.chance(0.7) ? [shape(r, style, inner)] : [];
	const count = r.int(1, 2);
	for (let i = 0; i < count; i++)
		children.push(
			depth < 3 && r.chance(style.groups[1])
				? group(r, style, inner, depth + 1)
				: leaf(r, style, inner),
		);
	return createGroup(children, {
		...(r.chance(style.layers) ? effects(r, 0.4, false) : {}),
		...(clip ? { clip: true, ...clip, cornerRadius: r.int(0, 8) } : {}),
	});
}

function scene(r: Rand, style: Style, size: Size): Node {
	const children: Node[] = [];
	const count = r.int(3, 7);
	for (let i = 0; i < count; i++)
		children.push(
			r.chance(style.groups[0])
				? group(r, style, size, 1)
				: leaf(r, style, size),
		);
	if (r.chance(0.5))
		children.push(
			createRect({
				pos: { x: 0, y: 0 },
				size,
				stroke: { color: r.pick(COLORS), width: r.int(1, 4), align: "inside" },
			}),
		);
	return createFrame({
		pos: { x: 0, y: 0 },
		size,
		background: createRect({
			pos: { x: 0, y: 0 },
			size,
			fills: [
				r.chance(0.5) ? { kind: "solid", color: "#f5f0e6" } : opaque(fill(r)),
			],
		}),
		children,
	});
}

// Keeps the frame opaque, so the finish runs on the CPU.
function opaque(f: ResolvedFill): ResolvedFill {
	if (f.kind === "solid") return { ...f, color: f.color.slice(0, 7) };
	return {
		...f,
		stops: f.stops.map((s) => ({ ...s, color: s.color.slice(0, 7) })),
	};
}

function leaves(node: Node, out: Node[] = []): Node[] {
	if (node.kind === "group") for (const c of node.children) leaves(c, out);
	else out.push(node);
	return out;
}

// The next record of a template: usually new text and images in every field,
// otherwise one leaf's text, image or colour.
function mutate(r: Rand, node: Node): void {
	const all = leaves(node);
	const record = r.chance(0.85);
	for (const n of record ? all : [r.pick(all)]) {
		if (n.kind === "text") {
			n.text = `${r.pick(WORDS)} ${r.pick(WORDS)}`;
			if (r.chance(0.3)) n.color = r.pick(COLORS);
		} else if (n.kind === "image") n.src = r.pick(SRCS);
		else if (!record && "fills" in n) n.fills = [fill(r)];
	}
}

type Config = {
	size: Size;
	style: Style;
	cache: PaintCacheOptions;
	scale: number;
	supersample: number;
	finish?: FrameFinish;
};

// At most 3x density, which keeps the default run inside its time budget.
function config(r: Rand): Config {
	const scale = r.pick([1, 1, 1.5, 2]);
	return {
		size: { width: r.int(64, 200), height: r.int(48, 140) },
		style: r.chance(0.5) ? FLAT : LAYERED,
		cache: r.pick([
			{},
			{},
			{},
			{ maxImagePixels: 2_000 },
			{ maxImagePixels: 60_000, maxImages: 2 },
			{ maxImagePixels: 50_000_000 },
		]),
		scale,
		supersample: scale > 1.5 ? 1 : r.pick([1, 1, 2]),
		...(r.chance(0.4) ? { finish: finish(r) } : {}),
	};
}

function finish(r: Rand): FrameFinish {
	return {
		dither: r.chance(0.2)
			? 2.5
			: {
					amount: r.pick([2, 4, 8]),
					seed: r.int(0, 999),
					mode: r.pick(["per-channel", "monochrome"] as const),
				},
		...(r.chance(0.5) ? { whiteClamp: 248, blackExtract: 12 } : {}),
	};
}

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
