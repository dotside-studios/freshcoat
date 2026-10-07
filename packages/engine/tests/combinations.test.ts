// Invariants that hold across combinations of features, rather than per feature.
// Each table below takes a new case in one line.
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import type { CanvasKit } from "canvaskit-wasm";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { identityColorMatrix, identityLut3d } from "../src/adjust";
import { paintScene, setLayerBounds } from "../src/canvaskit";
import { compileScene, prepareScene } from "../src/compile-scene";
import { deriveFontMetrics } from "../src/font-metrics";
import { createHeadlessEnv } from "../src/headless";
import {
	createEllipse,
	createGroup,
	createMask,
	createRect,
	type MaskNode,
	type Node,
	type Transform,
} from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { TextEngine } from "../src/text-engine";
import type {
	Adjust,
	BlendMode,
	Command,
	DrawCommand,
	PaintWarning,
} from "../src/types";
import { config, fuzzImages, LAYERED, rng, scene } from "./scene-gen";

const W = 120;
const H = 90;
const FONTS = new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]);
const fontMetrics = deriveFontMetrics(FONTS);

let ck: CanvasKit;
let textEngine: TextEngine;
let images = new Map<string, Uint8Array>();

beforeAll(async () => {
	ck = await loadCanvasKit();
	textEngine = createParagraphEngine(ck, FONTS);
	images = await fuzzImages();
});
afterEach(() => setLayerBounds(true));

type Paint = { pixels: Uint8Array; warnings: PaintWarning[] };

async function paintCommands(commands: Command[]): Promise<Paint> {
	const rt = createHeadlessEnv({ fonts: FONTS, images });
	const out = await paintScene(ck, commands, rt);
	try {
		const px = out.readPixels?.();
		if (!px) throw new Error("no pixels");
		return { pixels: px.data.slice(), warnings: out.warnings };
	} finally {
		out.dispose();
	}
}

function compile(node: Node): Command[] {
	return compileScene(node, { width: W, height: H, textEngine, fontMetrics });
}

const paintNode = (node: Node) => paintCommands(compile(node));

// The largest premultiplied channel difference, and how many pixels differ by
// more than `tol`.
function diff(a: Uint8Array, b: Uint8Array, tol: number) {
	expect(a.length).toBe(b.length);
	let max = 0;
	let over = 0;
	for (let i = 0; i < a.length; i += 4) {
		const aa = (a[i + 3] ?? 0) / 255;
		const ba = (b[i + 3] ?? 0) / 255;
		let px = Math.abs((a[i + 3] ?? 0) - (b[i + 3] ?? 0));
		for (let c = 0; c < 3; c++)
			px = Math.max(px, Math.abs((a[i + c] ?? 0) * aa - (b[i + c] ?? 0) * ba));
		max = Math.max(max, px);
		if (px > tol) over++;
	}
	return { max, over };
}

function pixel(p: Paint, x: number, y: number): number[] {
	const i = (y * W + x) * 4;
	return [...p.pixels.subarray(i, i + 4)];
}

type Named = { name: string };
type Combo<T extends Record<string, readonly Named[]>> = {
	[K in keyof T]: T[K][number];
};

// Registers one test per combination of the tables' rows. A combination that
// `knownBug` names is a test.failing until its fix lands.
function each<T extends Record<string, readonly Named[]>>(
	tables: T,
	run: (c: Combo<T>) => Promise<void>,
	knownBug: (c: Combo<T>) => string | null = () => null,
): void {
	let combos: Record<string, Named>[] = [{}];
	for (const [key, rows] of Object.entries(tables))
		combos = combos.flatMap((c) => rows.map((row) => ({ ...c, [key]: row })));
	for (const c of combos as Combo<T>[]) {
		const name = Object.values(c as Record<string, Named>)
			.map((row) => row.name)
			.join(", ");
		const bug = knownBug(c);
		if (bug) test.failing(`${name} (bug: ${bug})`, () => run(c));
		else test(name, () => run(c));
	}
}

const solid = (color: string) => [{ kind: "solid" as const, color }];
const at = (x: number, y: number, width: number, height: number) => ({
	pos: { x, y },
	size: { width, height },
});

describe("identity adjustments are no-ops", () => {
	const ramp = new Uint8Array(256).map((_, i) => i);
	const adjusts = [
		{ name: "lut", adjust: { lut: { r: ramp, g: ramp, b: ramp } } },
		{ name: "lut3d", adjust: { lut3d: identityLut3d(9) } },
		{ name: "colorMatrix", adjust: { colorMatrix: identityColorMatrix() } },
		{ name: "sharpen 0", adjust: { sharpen: 0 } },
	];
	const blends: BlendMode[] = [
		"normal",
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
	type Layer = Named & { fx: Partial<Transform>; rotatedGroup?: boolean };
	const layers: Layer[] = [
		...blends.map((b) => ({ name: `blend ${b}`, fx: { blendMode: b } })),
		{ name: "opacity 0.5", fx: { opacity: 0.5 } },
		{ name: "blur", fx: { blur: 3 } },
		{
			name: "shadow",
			fx: { shadow: { color: "#00000088", dx: 4, dy: 5, blur: 6 } },
		},
		{ name: "inside a rotated group", fx: {}, rotatedGroup: true },
	];

	function layerScene(layer: Layer, adjust?: Adjust): Node {
		const top = createRect({
			...at(30, 20, 60, 50),
			fills: [
				{
					kind: "linear",
					stops: [
						{ offset: 0, color: "#ef4444" },
						{ offset: 1, color: "#facc15" },
					],
					from: { x: 0, y: 0 },
					to: { x: 1, y: 1 },
				},
			],
			...layer.fx,
			...(adjust ? { adjust } : {}),
		});
		return createGroup([
			createRect({ ...at(0, 0, W, H), fills: solid("#2563eb") }),
			createRect({ ...at(10, 10, 50, 40), fills: solid("#22c55e80") }),
			layer.rotatedGroup
				? createGroup([top], { ...at(0, 0, W, H), rotation: 25 })
				: top,
		]);
	}

	each(
		{ adjust: adjusts, layer: layers },
		async ({ adjust, layer }) => {
			const plain = await paintNode(layerScene(layer));
			const adjusted = await paintNode(layerScene(layer, adjust.adjust));
			expect(plain.warnings).toEqual([]);
			expect(adjusted.warnings).toEqual([]);
			expect(diff(plain.pixels, adjusted.pixels, 2).over).toBe(0);
		},
	);
});

describe("the mask clip shortcut and drawMasked paint the same", () => {
	const white = solid("#fff");
	type Box = ReturnType<typeof at>;
	const shapes = [
		{ name: "rect", make: (b: Box) => createRect({ ...b, fills: white }) },
		{
			name: "rounded",
			make: (b: Box) => createRect({ ...b, cornerRadius: 9, fills: white }),
		},
		{
			name: "squircle",
			make: (b: Box) =>
				createRect({
					...b,
					cornerRadius: 12,
					cornerSmoothing: 0.6,
					fills: white,
				}),
		},
		{ name: "ellipse", make: (b: Box) => createEllipse({ ...b, fills: white }) },
	];
	const placements = [
		{ name: "aligned", offset: false },
		{ name: "offset", offset: true },
		{ name: "rotated", offset: false, rotation: 30 },
		{ name: "rotated and offset", offset: true, rotation: 30 },
	];
	const contents = [
		{
			name: "one child",
			children: [
				createRect({ ...at(-10, -10, 100, 80), fills: solid("#ef4444") }),
			],
		},
		{
			name: "overlapping children",
			children: [
				createRect({ ...at(-10, -10, 100, 80), fills: solid("#ef4444") }),
				createRect({ ...at(-10, -10, 100, 80), fills: solid("#2563eb") }),
			],
		},
	];

	// A clip and a coverage layer antialias the same curved edge up to about 1/8
	// coverage apart.
	const EDGE_TOLERANCE = 40;

	// drawMasked over the mask node's own box, built from the same prepared tree.
	function general(node: MaskNode): Command[] {
		const prepared = prepareScene(node, { textEngine, fontMetrics }) as MaskNode;
		const one = (n: Node) =>
			compileScene(n, { width: W, height: H, prepared: true }).at(
				-1,
			) as DrawCommand;
		return [
			{ op: "createCanvas", width: W, height: H },
			{
				op: "drawMasked",
				pos: prepared.pos ?? { x: 0, y: 0 },
				size: prepared.size ?? { width: 0, height: 0 },
				rotation: prepared.rotation,
				mask: one(prepared.mask),
				children: prepared.children.map(one),
			},
		];
	}

	each(
		{ shape: shapes, place: placements, content: contents },
		async ({ shape, place, content }) => {
			const node = createMask(
				shape.make(place.offset ? at(14, 6, 50, 38) : at(0, 0, 80, 60)),
				content.children,
				{ ...at(20, 15, 80, 60), rotation: place.rotation },
			);
			const shortcut = compile(node);
			expect(shortcut.at(-1)?.op).toBe("drawGroup");
			const fast = await paintCommands(shortcut);
			const slow = await paintCommands(general(node));
			expect(fast.warnings).toEqual([]);
			expect(slow.warnings).toEqual([]);
			expect(diff(fast.pixels, slow.pixels, EDGE_TOLERANCE).over).toBe(0);
		},
		({ shape, place }) => {
			if (shape.name === "ellipse" && place.rotation && place.offset)
				return "a few edge pixels of the clip differ from drawMasked by up to 1/4 coverage, with the same area and centroid";
			return null;
		},
	);
});

describe("mask coverage is luminance times alpha", () => {
	const fill = (
		channel: "alpha" | "luminance",
		color: string,
		coverage: number,
	) => ({ name: `${channel} ${color}`, channel, color, coverage });
	const fills = [
		fill("alpha", "#ffffff", 1),
		fill("alpha", "#000000", 1),
		fill("alpha", "#ffffff80", 0.5),
		fill("alpha", "#00000040", 0.25),
		fill("luminance", "#ffffff", 1),
		fill("luminance", "#000000", 0),
		fill("luminance", "#808080", 0.5),
		fill("luminance", "#ffffff80", 0.5),
		fill("luminance", "#80808080", 0.25),
	];
	const shapes = [
		{ name: "rect", make: createRect },
		{ name: "ellipse", make: createEllipse },
	];

	each(
		{ fill: fills, shape: shapes },
		async ({ fill: f, shape }) => {
			const out = await paintNode(
				createMask(
					shape.make({ ...at(0, 0, 80, 60), fills: solid(f.color) }),
					[createRect({ ...at(0, 0, 80, 60), fills: solid("#ef4444") })],
					{ ...at(20, 15, 80, 60), channel: f.channel },
				),
			);
			expect(out.warnings).toEqual([]);
			const alpha = (pixel(out, 60, 45)[3] ?? 0) / 255;
			expect(Math.abs(alpha - f.coverage)).toBeLessThan(0.02);
			expect(pixel(out, 5, 5)[3]).toBe(0);
		},
	);
});

describe("bounded and unbounded layers paint the same", () => {
	const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
	// A rounded corner's antialiased pixels can move by up to 1/8 coverage under
	// a bounded layer's new origin, as in layer-bounds.test.ts.
	const ROUNDED_TOLERANCE = 32;

	test.each(SEEDS)(
		"seed %i",
		async (seed) => {
			const r = rng(seed);
			const cfg = config(r);
			const node = scene(r, LAYERED, cfg.size);
			const commands = compileScene(node, {
				...cfg.size,
				textEngine,
				fontMetrics,
				scale: cfg.scale,
				supersample: cfg.supersample,
			});
			setLayerBounds(false);
			const unbounded = await paintCommands(commands);
			setLayerBounds(true);
			const bounded = await paintCommands(commands);
			expect(bounded.warnings).toEqual(unbounded.warnings);
			for (const w of bounded.warnings)
				expect(w.kind, `seed ${seed}`).toBe("image_load_failed");
			expect(
				diff(bounded.pixels, unbounded.pixels, ROUNDED_TOLERANCE).over,
				`seed ${seed}`,
			).toBe(0);
		},
		60_000,
	);
});
