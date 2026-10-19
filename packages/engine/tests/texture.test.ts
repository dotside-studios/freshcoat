import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { gammaLut } from "../src/adjust";
import { createGroup, createRect, createText, type Node } from "../src/node";
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

const fonts = new Map([
	["Vend Sans", [testFontBytes("VendSans-Variable-latin.woff2")]],
]);

async function png(node: Node, scale = 1, testCk = ck) {
	return renderSceneToPng(node, {
		width: W,
		height: H,
		ck: testCk,
		scale,
		fonts,
	});
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

describe("grain structure", () => {
	const N = 400;
	async function patch(seed: number, size: number, monochrome = true) {
		const node = createGroup(
			[
				createRect({
					pos: { x: 0, y: 0 },
					size: { width: N, height: N },
					fills: [{ kind: "solid", color: "#808080" }],
					grain: grain({ amount: 1, size, blendMode: "normal", seed, monochrome }),
				}),
			],
			{ pos: { x: 0, y: 0 }, size: { width: N, height: N } },
		);
		const out = await renderSceneToPng(node, { width: N, height: N, ck, fonts });
		expect(out.warnings ?? []).toEqual([]);
		const p = decode(out.bytes);
		const cells = Math.floor(N / size);
		const ch = (c: number) => {
			const v = new Float64Array(cells * cells);
			for (let y = 0; y < cells; y++)
				for (let x = 0; x < cells; x++)
					v[y * cells + x] = p.px[(y * size * N + x * size) * 4 + c];
			return v;
		};
		return { cells, r: ch(0), g: ch(1), b: ch(2) };
	}

	function correlation(
		a: Float64Array,
		b: Float64Array,
		cells: number,
		dx: number,
		dy: number,
	): number {
		const m = 6;
		let ma = 0;
		let mb = 0;
		let n = 0;
		for (let y = m; y < cells - m; y++)
			for (let x = m; x < cells - m; x++) {
				ma += a[y * cells + x];
				mb += b[(y + dy) * cells + x + dx];
				n++;
			}
		ma /= n;
		mb /= n;
		let ab = 0;
		let aa = 0;
		let bb = 0;
		for (let y = m; y < cells - m; y++)
			for (let x = m; x < cells - m; x++) {
				const u = a[y * cells + x] - ma;
				const v = b[(y + dy) * cells + x + dx] - mb;
				ab += u * v;
				aa += u * u;
				bb += v * v;
			}
		return ab / Math.sqrt(aa * bb);
	}

	test.each([
		[7, 1],
		[7, 3],
		[0, 1],
		[65535, 1],
	])("seed %i at size %i has no correlation between nearby cells", async (seed, size) => {
		const { cells, r } = await patch(seed, size);
		let worst = 0;
		for (let dy = 0; dy <= 6; dy++)
			for (let dx = -6; dx <= 6; dx++) {
				if (dy === 0 && dx <= 0) continue;
				worst = Math.max(worst, Math.abs(correlation(r, r, cells, dx, dy)));
			}
		expect(worst).toBeLessThan(size === 1 ? 0.015 : 0.04);
	}, 30_000);

	test("its histogram is flat", async () => {
		const { r } = await patch(7, 1);
		const bins = new Array(16).fill(0);
		for (const v of r) bins[v >> 4]++;
		const expected = r.length / 16;
		for (const c of bins) expect(Math.abs(c / expected - 1)).toBeLessThan(0.05);
	}, 30_000);

	test("colour grain draws its channels independently", async () => {
		const { cells, r, g, b } = await patch(7, 1, false);
		for (const [u, v] of [
			[r, g],
			[g, b],
			[r, b],
		])
			expect(Math.abs(correlation(u, v, cells, 0, 0))).toBeLessThan(0.015);
	}, 30_000);
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
				{ kind: "solid", color: "#ff4040" },
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

const white = {
	pos: { x: 0, y: 0 },
	size: { width: W, height: H },
	fills: [{ kind: "solid", color: "#ffffff" }] as ResolvedFill[],
};
const grey: ResolvedFill[] = [{ kind: "solid", color: "#808080" }];

function pair(anchor: Halftone["anchor"]): Node {
	const ht = halftone({ anchor, cellSize: 7 });
	return createGroup(
		[
			createRect({
				pos: { x: 10, y: 10 },
				size: { width: 50, height: 60 },
				fills: grey,
				halftone: ht,
			}),
			createRect({
				pos: { x: 60, y: 10 },
				size: { width: 50, height: 60 },
				fills: grey,
				halftone: ht,
			}),
		],
		white,
	);
}

function rotated(anchor: Halftone["anchor"]): Node {
	return createGroup(
		[
			createRect({
				pos: { x: 25, y: 10 },
				size: { width: 70, height: 60 },
				rotation: 30,
				fills: grey,
				halftone: halftone({ anchor, cellSize: 7 }),
			}),
		],
		white,
	);
}

function boldText(over: Partial<Halftone> = {}): Node {
	return createGroup(
		[
			createText({
				id: "layer",
				pos: { x: 0, y: 0 },
				size: { width: W, height: H },
				font: {
					family: "Vend Sans",
					weight: 800,
					style: "normal",
					size: 64,
					lineHeight: 1,
				},
				color: "#000000",
				align: "center",
				verticalAlign: "middle",
				text: "HIE",
				halftone: halftone({ cellSize: 6, ...over }),
			}),
		],
		white,
	);
}

describe("halftone anchor", () => {
	const at = (x: number, y: number) => (y * W + x) * 4;
	const region = (p: Pixels, x0: number, x1: number) => {
		const out: number[] = [];
		for (let y = 14; y < 66; y++)
			for (let x = x0; x < x1; x++) out.push(p.px[at(x, y)]);
		return out;
	};
	const whole = (anchor: Halftone["anchor"]) =>
		createGroup(
			[
				createRect({
					pos: { x: 10, y: 10 },
					size: { width: 100, height: 60 },
					fills: grey,
					halftone: halftone({ anchor, cellSize: 7 }),
				}),
			],
			white,
		);

	test("page: neighbouring layers share one screen", async () => {
		const split = await pixels(pair("page"));
		const one = await pixels(whole("page"));
		expect(region(split, 14, 106)).toEqual(region(one, 14, 106));
	});

	test("element: each layer starts its own screen", async () => {
		const split = await pixels(pair("element"));
		const one = await pixels(whole("element"));
		expect(region(split, 14, 56)).toEqual(region(one, 14, 56));
		expect(region(split, 60, 106)).not.toEqual(region(one, 60, 106));
	});

	test("the default anchor is page", async () => {
		const a = await png(pair(undefined));
		const b = await png(pair("page"));
		expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
	});

	// Points well inside the rotated 70 x 60 box, clear of its antialiased edge.
	const inside = () => {
		const pts: [number, number][] = [];
		const a = (30 * Math.PI) / 180;
		for (let v = -22; v <= 22; v++)
			for (let u = -27; u <= 27; u++)
				pts.push([
					Math.round(60 + u * Math.cos(a) - v * Math.sin(a)),
					Math.round(40 + u * Math.sin(a) + v * Math.cos(a)),
				]);
		return pts;
	};

	test("page: a rotated layer keeps the screen angle", async () => {
		const turned = await pixels(rotated("page"));
		const flat = await pixels(
			createGroup(
				[
					createRect({
						pos: { x: 0, y: 0 },
						size: { width: W, height: H },
						fills: grey,
						halftone: halftone({ cellSize: 7 }),
					}),
				],
				white,
			),
		);
		let same = 0;
		const pts = inside();
		for (const [x, y] of pts)
			if (Math.abs(turned.px[at(x, y)] - flat.px[at(x, y)]) <= 2) same++;
		expect(same / pts.length).toBeGreaterThan(0.99);
	});

	test("element: a rotated layer turns its screen", async () => {
		const page = await pixels(rotated("page"));
		const element = await pixels(rotated("element"));
		expect(meanDiff(page, element)).toBeGreaterThan(5);
	});

	test("page: the screen ignores a rotated group", async () => {
		const inGroup = await pixels(
			createGroup(
				[
					createGroup(
						[
							createRect({
								pos: { x: 0, y: 0 },
								size: { width: 70, height: 60 },
								fills: grey,
								halftone: halftone({ cellSize: 7 }),
							}),
						],
						{
							pos: { x: 25, y: 10 },
							size: { width: 70, height: 60 },
							rotation: 30,
						},
					),
				],
				white,
			),
		);
		const own = await pixels(rotated("page"));
		expect(meanDiff(inGroup, own)).toBeLessThan(0.5);
	});

	test("page: an offscreen ancestor keeps the page grid", async () => {
		const adjusted = await pixels(
			createGroup(
				[
					createGroup(
						[
							createRect({
								pos: { x: 0, y: 0 },
								size: { width: 90, height: 55 },
								fills: grey,
								halftone: halftone({ cellSize: 7 }),
							}),
						],
						{
							pos: { x: 13, y: 11 },
							size: { width: 90, height: 55 },
							adjust: { lut: gammaLut(1) },
						},
					),
				],
				white,
			),
		);
		const one = await pixels(whole("page"));
		expect(region(adjusted, 17, 99)).toEqual(region(one, 17, 99));
	});

	test("origin moves the page under the scene", async () => {
		const shifted = (dx: number, dy: number) =>
			createGroup(
				[
					createRect({
						pos: { x: 10 + dx, y: 5 + dy },
						size: { width: 90, height: 60 },
						fills: grey,
						halftone: halftone({ cellSize: 7, origin: { x: dx, y: dy } }),
					}),
				],
				white,
			);
		const a = await pixels(shifted(0, 0));
		const b = await pixels(shifted(9, 6));
		for (let y = 8; y < 62; y++)
			for (let x = 14; x < 96; x++)
				expect(b.px[at(x + 9, y + 6)]).toBe(a.px[at(x, y)]);
	});

	test("page: a 2x export keeps the 1x tone", async () => {
		const one = await pixels(pair("page"), 1);
		const two = await pixels(pair("page"), 2);
		expect(meanDiff(one, halve(two))).toBeLessThan(4);
	});
});

describe("halftone edges", () => {
	// Pixels the plain text covers fully that come out light once halftoned.
	const holes = async (over: Partial<Halftone> = {}) => {
		const plain = await pixels(boldText({ cellSize: 0 }));
		const screened = await pixels(boldText(over));
		let count = 0;
		let solid = 0;
		for (let i = 0; i < plain.px.length; i += 4) {
			if (plain.px[i] !== 0) continue;
			solid++;
			if (screened.px[i] > 64) count++;
		}
		expect(solid).toBeGreaterThan(500);
		return count;
	};

	test("bold black text stays solid to its edges", async () => {
		expect(await holes()).toBe(0);
		expect(await holes({ shape: "square" })).toBe(0);
	});

	test("cmyk keeps black text solid to its edges", async () => {
		expect(await holes({ mode: "cmyk", angle: 0 })).toBe(0);
	});

	test("invert keeps white-on-transparent solid to its edges", async () => {
		const node = (cellSize: number) =>
			createGroup(
				[
					createText({
						pos: { x: 0, y: 0 },
						size: { width: W, height: H },
						font: {
							family: "Vend Sans",
							weight: 800,
							style: "normal",
							size: 64,
							lineHeight: 1,
						},
						color: "#ffffff",
						align: "center",
						verticalAlign: "middle",
						text: "HIE",
						halftone: halftone({ cellSize, invert: true }),
					}),
				],
				white,
			);
		const plain = await pixels(
			createGroup(
				[
					createText({
						...(node(6).children[0] as Parameters<typeof createText>[0]),
						color: "#000000",
						halftone: undefined,
					}),
				],
				white,
			),
		);
		const screened = await pixels(node(6));
		let count = 0;
		for (let i = 0; i < plain.px.length; i += 4)
			if (plain.px[i] === 0 && screened.px[i] > 64) count++;
		expect(count).toBe(0);
	});

	test("a soft edge breaks into dots in proportion to its alpha", async () => {
		const fade: ResolvedFill[] = [
			{
				kind: "linear",
				from: { x: 0, y: 0 },
				to: { x: 1, y: 0 },
				stops: [
					{ offset: 0, color: "#000000" },
					{ offset: 1, color: "#00000000" },
				],
			},
		];
		const p = await pixels(scene({ halftone: halftone({ cellSize: 6 }) }, fade));
		const ink = (x0: number, x1: number) => {
			let dark = 0;
			for (let y = 10; y < 70; y++)
				for (let x = x0; x < x1; x++) dark += 255 - p.px[(y * W + x) * 4];
			return dark / ((x1 - x0) * 60 * 255);
		};
		const left = ink(10, 40);
		const middle = ink(45, 75);
		const right = ink(80, 110);
		expect(left).toBeGreaterThan(0.75);
		expect(middle).toBeGreaterThan(0.3);
		expect(middle).toBeLessThan(0.7);
		expect(right).toBeLessThan(0.3);
		expect(right).toBeGreaterThan(0.02);
	});
});

// Regenerate with UPDATE_GOLDENS=1 after an intended change to an effect.
describe.each([
	["grain", scene({ grain: grain({ seed: 7, size: 2, monochrome: false }) })],
	["halftone", scene({ halftone: halftone() })],
	["halftone-cmyk", scene({ halftone: halftone({ mode: "cmyk", cellSize: 6 }) })],
	["halftone-adjacent-page", pair("page")],
	["halftone-adjacent-element", pair("element")],
	["halftone-rotated-page", rotated("page")],
	["halftone-rotated-element", rotated("element")],
	["halftone-bold-text", boldText()],
	["halftone-bold-text-cmyk", boldText({ mode: "cmyk", angle: 0 })],
] as const)("%s golden", (name, node) => {
	test.each([1, 2])("matches at %dx", async (scale) => {
		const out = await png(node, scale);
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
