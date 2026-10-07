// Seeded random scenes shared by the paint cache fuzz test and the feature
// combination suite.
import { buildAdjust, identityLut3d } from "../src/adjust";
import { encodePng, type PaintCacheOptions } from "../src/index";
import {
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createMask,
	createPath,
	createRect,
	createText,
	type Node,
	type Transform,
} from "../src/node";
import type {
	Adjust,
	AdjustLut3d,
	BlendMode,
	FrameFinish,
	ResolvedFill,
} from "../src/types";

const SRCS = [
	"img://quarters",
	"img://checker",
	"img://wide",
	"img://alpha",
];

export async function fuzzImages(): Promise<Map<string, Uint8Array>> {
	const images = new Map<string, Uint8Array>();
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
		images.set(SRCS[i] as string, await encodePng(px, w, h));
	}
	return images;
}

type Size = { width: number; height: number };

type Rand = {
	next(): number;
	int(lo: number, hi: number): number;
	pick<T>(xs: readonly T[]): T;
	chance(p: number): boolean;
};

export function rng(seed: number): Rand {
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
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
	"plus",
	"linear-burn",
];

function warmCube(): AdjustLut3d {
	const cube = identityLut3d(5);
	for (let i = 0; i < cube.data.length; i += 3)
		cube.data[i] = Math.min(255, (cube.data[i] as number) + 30);
	return cube;
}

const ADJUSTS: Adjust[] = [
	buildAdjust({ saturation: 0.4 }),
	buildAdjust({ gamma: 1.8 }),
	buildAdjust({ contrast: 1.3, gamma: 0.8 }),
	buildAdjust({ sharpen: 0.6 }),
	{ lut3d: warmCube() },
];

function fill(r: Rand): ResolvedFill {
	const stops = [
		{ offset: 0, color: r.pick(COLORS) },
		{ offset: 1, color: r.pick(COLORS) },
	];
	switch (r.int(0, 5)) {
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
		case 3:
			return {
				kind: "pattern",
				pattern: r.pick(["noise", "paper", "hatching", "dots"] as const),
				scale: 2 + r.int(0, 12),
				angle: r.int(0, 359),
				density: r.next(),
				seed: r.int(0, 99),
				colors: [r.pick(COLORS), r.pick(COLORS)],
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
	masks: number;
};
export const LAYERED: Style = {
	name: "layered",
	effects: 0.15,
	layers: 0.4,
	fields: 0.45,
	groups: [0.5, 0.4],
	masks: 0.2,
};
const FLAT: Style = {
	name: "flat",
	effects: 0.02,
	layers: 0.05,
	fields: 0.35,
	groups: [0.75, 0.5],
	masks: 0.05,
};

// Layer effects, rarely more than one per node. A spread dilates the whole
// layer, which costs seconds on a large group, so only leaves get one.
function effects(r: Rand, p: number, spread = true): Partial<Transform> {
	const out: Partial<Transform> = {};
	if (r.chance(p)) out.opacity = r.pick([0.3, 0.6, 0.9]);
	if (r.chance(p)) out.rotation = r.int(-40, 40);
	if (r.chance(p / 2)) out.blendMode = r.pick(BLENDS);
	if (r.chance(p / 2)) out.blur = r.pick([0.5, 2, 4]);
	if (r.chance(p / 2)) out.adjust = r.pick(ADJUSTS);
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
	if (r.chance(style.masks)) return mask(r, style, size, depth);
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
		...(r.chance(0.2) ? { isolate: true } : {}),
		...(clip ? { clip: true, ...clip, cornerRadius: r.int(0, 8) } : {}),
	});
}

// A mask over a few leaves. Its source is an opaque shape that lowers to a clip,
// a translucent one, or any random shape, under either channel.
function mask(r: Rand, style: Style, size: Size, depth: number): Node {
	const b = box(r, size, 0.8);
	const inner = b.size;
	const source = r.chance(0.5)
		? r.pick([createRect, createEllipse])({
				...box(r, inner, 0.9),
				fills: [{ kind: "solid", color: r.pick(["#ffffff", "#ffffff80"]) }],
				...(r.chance(0.3) ? { cornerRadius: r.int(2, 8) } : {}),
			})
		: shape(r, style, inner);
	const children: Node[] = [shape(r, style, inner)];
	children.push(
		depth < 3 && r.chance(style.groups[1])
			? group(r, style, inner, depth + 1)
			: leaf(r, style, inner),
	);
	return createMask(source, children, {
		...b,
		...(r.chance(style.layers) ? effects(r, 0.4, false) : {}),
		...(r.chance(0.3) ? { channel: "luminance" as const } : {}),
		...(r.chance(0.2) ? { invert: true } : {}),
	});
}

export function scene(r: Rand, style: Style, size: Size): Node {
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
	if (f.kind === "pattern")
		return {
			...f,
			colors: [f.colors[0].slice(0, 7), f.colors[1].slice(0, 7)],
		};
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
export function mutate(r: Rand, node: Node): void {
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

export type Config = {
	size: Size;
	style: Style;
	cache: PaintCacheOptions;
	scale: number;
	supersample: number;
	finish?: FrameFinish;
};

// At most 3x density, which keeps the default run inside its time budget.
export function config(r: Rand): Config {
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
