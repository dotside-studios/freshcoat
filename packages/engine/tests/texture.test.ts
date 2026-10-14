import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createGroup, createRect, type Node } from "../src/node";
import { createRenderer } from "../src/renderer";
import type { Grain, Halftone, ResolvedFill } from "../src/types";
import { validateCommands } from "../src/validate-commands";
import { renderSceneToPng } from "./helpers/headless";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const W = 120;
const H = 80;
const GOLDENS = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"fixtures",
	"texture",
);
const UPDATE = process.env.UPDATE_GOLDENS === "1";

type Pixels = { width: number; height: number; px: Uint8Array };

const gradient: ResolvedFill = {
	kind: "linear",
	from: { x: 0, y: 0 },
	to: { x: 1, y: 0 },
	stops: [
		{ offset: 0, color: "#000000" },
		{ offset: 1, color: "#ff8800" },
	],
};

function scene(layer: Partial<Node>, fills: ResolvedFill[] = [gradient]): Node {
	return createGroup(
		[
			createRect({
				id: "layer",
				pos: { x: 10, y: 10 },
				size: { width: 100, height: 60 },
				fills,
				...layer,
			} as Parameters<typeof createRect>[0]),
		],
		{
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: [{ kind: "solid", color: "#ffffff" }],
		},
	);
}

async function png(node: Node, scale = 1, testCk = ck) {
	return renderSceneToPng(node, { width: W, height: H, ck: testCk, scale });
}

function decode(bytes: Uint8Array): Pixels {
	const img = ck.MakeImageFromEncoded(bytes);
	const width = img.width();
	const height = img.height();
	const px = img.readPixels(0, 0, {
		width,
		height,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	});
	img.delete();
	return { width, height, px };
}

async function pixels(node: Node, scale = 1): Promise<Pixels> {
	const out = await png(node, scale);
	expect(out.warnings ?? []).toEqual([]);
	return decode(out.bytes);
}

function halve(p: Pixels): Pixels {
	const width = p.width / 2;
	const height = p.height / 2;
	const px = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let dy = 0; dy < 2; dy++)
					for (let dx = 0; dx < 2; dx++)
						sum += p.px[((2 * y + dy) * p.width + 2 * x + dx) * 4 + c];
				px[(y * width + x) * 4 + c] = Math.round(sum / 4);
			}
	return { width, height, px };
}

function meanDiff(a: Pixels, b: Pixels): number {
	let sum = 0;
	for (let i = 0; i < a.px.length; i++) sum += Math.abs(a.px[i] - b.px[i]);
	return sum / a.px.length;
}

function mean(p: Pixels): number {
	let sum = 0;
	for (let i = 0; i < p.px.length; i += 4) sum += p.px[i];
	return sum / (p.px.length / 4);
}

// Connected runs of dark pixels, 4-neighbour.
function blobs(p: Pixels, dark = (v: number) => v < 128): number {
	const seen = new Uint8Array(p.width * p.height);
	let count = 0;
	for (let start = 0; start < seen.length; start++) {
		if (seen[start] || !dark(p.px[start * 4])) continue;
		count++;
		const stack = [start];
		seen[start] = 1;
		while (stack.length) {
			const i = stack.pop() as number;
			const x = i % p.width;
			const y = Math.floor(i / p.width);
			for (const [nx, ny] of [
				[x + 1, y],
				[x - 1, y],
				[x, y + 1],
				[x, y - 1],
			]) {
				if (nx < 0 || ny < 0 || nx >= p.width || ny >= p.height) continue;
				const j = ny * p.width + nx;
				if (seen[j] || !dark(p.px[j * 4])) continue;
				seen[j] = 1;
				stack.push(j);
			}
		}
	}
	return count;
}

const grain = (over: Partial<Grain> = {}): Grain => ({
	amount: 0.5,
	size: 1,
	monochrome: true,
	blendMode: "overlay",
	seed: 1,
	...over,
});

const halftone = (over: Partial<Halftone> = {}): Halftone => ({
	mode: "mono",
	shape: "round",
	cellSize: 8,
	angle: 45,
	invert: false,
	color: "#000000",
	...over,
});

describe("grain", () => {
	test("the same seed paints the same bytes", async () => {
		const a = await png(scene({ grain: grain({ seed: 42 }) }));
		const b = await png(scene({ grain: grain({ seed: 42 }) }));
		expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
	});

	test("the same seed paints the same bytes on another CanvasKit instance", async () => {
		const other = await loadCanvasKit();
		const a = await png(scene({ grain: grain({ seed: 9 }) }));
		const b = await png(scene({ grain: grain({ seed: 9 }) }), 1, other);
		expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
	});

	test("another seed paints other pixels", async () => {
		const a = await pixels(scene({ grain: grain({ seed: 1 }) }));
		const b = await pixels(scene({ grain: grain({ seed: 2 }) }));
		expect(meanDiff(a, b)).toBeGreaterThan(5);
	});

	test.each([
		["overlay", true],
		["soft-light", false],
		["multiply", true],
		["screen", false],
		["normal", false],
	] as const)("%s grain changes the layer", async (blendMode, monochrome) => {
		const plain = await pixels(scene({}));
		const grained = await pixels(
			scene({ grain: grain({ blendMode, monochrome }) }),
		);
		expect(meanDiff(plain, grained)).toBeGreaterThan(1);
		expect(grained.px[0]).toBe(255);
	});

	test("a 2x export is the 1x grain at twice the pixels", async () => {
		const node = scene({ grain: grain({ size: 2, amount: 0.8 }) });
		const one = await pixels(node, 1);
		const two = await pixels(node, 2);
		expect(two.width).toBe(W * 2);
		expect(meanDiff(one, halve(two))).toBeLessThan(1);
	});

	test("the grain follows the layer when it moves", async () => {
		const moved = (x: number) =>
			createGroup(
				[
					createRect({
						pos: { x, y: 10 },
						size: { width: 40, height: 40 },
						fills: [{ kind: "solid", color: "#808080" }],
						grain: grain({ amount: 1, blendMode: "normal" }),
					}),
				],
				{ pos: { x: 0, y: 0 }, size: { width: W, height: H } },
			);
		const a = await pixels(moved(10));
		const b = await pixels(moved(30));
		for (let y = 10; y < 50; y++)
			for (let x = 0; x < 40; x++)
				expect(b.px[(y * W + x + 30) * 4]).toBe(a.px[(y * W + x + 10) * 4]);
	});
});

describe("halftone", () => {
	const grey: ResolvedFill[] = [{ kind: "solid", color: "#808080" }];
	const grid = (shape: Halftone["shape"], scale = 1) =>
		pixels(
			createGroup(
				[
					createRect({
						pos: { x: 0, y: 0 },
						size: { width: 100, height: 60 },
						fills: grey,
						halftone: halftone({ shape, angle: 0, cellSize: 10 }),
					}),
				],
				{
					pos: { x: 0, y: 0 },
					size: { width: W, height: H },
					fills: [{ kind: "solid", color: "#ffffff" }],
				},
			),
			scale,
		);

	test.each(["round", "square"] as const)(
		"draws one %s dot per cell",
		async (shape) => {
			expect(blobs(await grid(shape))).toBe(10 * 6);
			expect(blobs(await grid(shape, 2))).toBe(10 * 6);
		},
	);

	test("draws one line per row of cells", async () => {
		expect(blobs(await grid("line"))).toBe(6);
	});

	test.each([
		["round", 45],
		["square", 30],
		["line", 15],
	] as const)(
		"a 2x export keeps the 1x tone (%s at %i°)",
		async (shape, angle) => {
			const node = scene({ halftone: halftone({ shape, angle }) });
			const one = await pixels(node, 1);
			const two = await pixels(node, 2);
			expect(meanDiff(one, halve(two))).toBeLessThan(4);
			expect(Math.abs(mean(one) - mean(halve(two)))).toBeLessThan(2);
		},
	);

	test("dot area follows the tone", async () => {
		const tone = async (color: string, invert = false) =>
			mean(
				await pixels(
					scene(
						{ halftone: halftone({ invert }) },
						[{ kind: "solid", color }],
					),
				),
			);
		expect(await tone("#404040")).toBeLessThan(await tone("#c0c0c0"));
		expect(await tone("#404040", true)).toBeGreaterThan(
			await tone("#c0c0c0", true),
		);
	});

	test("cmyk screens multiply process inks", async () => {
		const p = await pixels(
			scene({ halftone: halftone({ mode: "cmyk", cellSize: 6 }) }, [
				{ kind: "solid", color: "#ff0000" },
			]),
		);
		let magenta = false;
		let yellow = false;
		for (let i = 0; i < p.px.length; i += 4) {
			const [r, g, b] = [p.px[i], p.px[i + 1], p.px[i + 2]];
			if (r > 200 && g < 60 && b > 100) magenta = true;
			if (r > 200 && g > 200 && b < 60) yellow = true;
		}
		expect(magenta && yellow).toBe(true);
	});

	test("a background fills the layer under the dots", async () => {
		const p = await pixels(
			scene({ halftone: halftone({ background: "#0000ff" }) }, [
				{ kind: "solid", color: "#ffffff" },
			]),
		);
		const at = (x: number, y: number) => (y * W + x) * 4;
		expect(Array.from(p.px.slice(at(50, 40), at(50, 40) + 3))).toEqual([
			0, 0, 255,
		]);
		expect(Array.from(p.px.slice(at(2, 2), at(2, 2) + 3))).toEqual([
			255, 255, 255,
		]);
	});
});

// Regenerate with UPDATE_GOLDENS=1 after an intended change to an effect.
describe.each([
	["grain", { grain: grain({ seed: 7, size: 2, monochrome: false }) }],
	["halftone", { halftone: halftone() }],
	["halftone-cmyk", { halftone: halftone({ mode: "cmyk", cellSize: 6 }) }],
] as const)("%s golden", (name, layer) => {
	test.each([1, 2])("matches at %dx", async (scale) => {
		const out = await png(scene(layer), scale);
		const file = join(GOLDENS, `${name}@${scale}x.png`);
		if (UPDATE) {
			mkdirSync(GOLDENS, { recursive: true });
			writeFileSync(file, out.bytes);
		}
		const golden = decode(readFileSync(file));
		const actual = decode(out.bytes);
		expect(Buffer.from(actual.px).equals(Buffer.from(golden.px))).toBe(true);
	});
});

describe("without runtime effects", () => {
	test("paints the layer plain and warns", async () => {
		const bare = new Proxy(ck, {
			get(target, key) {
				if (key === "RuntimeEffect")
					return { ...target.RuntimeEffect, Make: () => null };
				return target[key];
			},
		});
		const out = await png(
			scene({ grain: grain(), halftone: halftone() }),
			1,
			bare,
		);
		expect(out.warnings).toEqual([
			expect.objectContaining({
				kind: "effect_unsupported",
				effect: "halftone",
				layer: "layer",
			}),
			expect.objectContaining({
				kind: "effect_unsupported",
				effect: "grain",
				layer: "layer",
			}),
		]);
		const plain = await pixels(scene({}));
		expect(meanDiff(decode(out.bytes), plain)).toBe(0);
	});
});

describe("pdf", () => {
	test.each([
		["grain", { grain: grain() }],
		["halftone", { halftone: halftone() }],
	] as const)("rasterizes %s with a warning", async (feature, layer) => {
		const renderer = await createRenderer({ ck, fonts: {} });
		const pdf = await renderer.renderPdf(scene(layer), {
			width: W,
			height: H,
			rasterDpi: 144,
		});
		expect(pdf.warnings).toEqual([
			{ kind: "vector_rasterized", feature, layer: "layer" },
		]);
		expect(new TextDecoder("latin1").decode(pdf.bytes)).toContain(
			"/Subtype /Image",
		);
	});
});

describe("validateCommands", () => {
	const draw = (extra: object) => [
		{ op: "createCanvas" as const, width: 10, height: 10 },
		{
			op: "drawRect" as const,
			pos: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			...extra,
		},
	];

	test("accepts well-formed effects", () => {
		expect(
			validateCommands(draw({ grain: grain(), halftone: halftone() })),
		).toEqual([]);
	});

	test("flags bad grain and halftone fields", () => {
		const codes = validateCommands(
			draw({
				grain: grain({ amount: 2, seed: 1.5 }),
				halftone: halftone({ cellSize: 0, shape: "star" as "round" }),
			}),
		).map((i) => `${i.code} ${i.path}`);
		expect(codes).toEqual([
			"bad_grain commands[1].grain.amount",
			"bad_grain commands[1].grain.seed",
			"bad_halftone commands[1].halftone.shape",
			"bad_halftone commands[1].halftone.cellSize",
		]);
	});
});
