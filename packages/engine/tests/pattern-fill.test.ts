import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { renderSceneToPng } from "./helpers/headless";
import {
	createPath,
	createRect,
	createText,
	PATTERN_KINDS,
	patternFill,
	validateCommands,
} from "../src/index";
import type { Node, PatternKind, ResolvedFill } from "../src/index";
import { patternMean } from "../src/pattern";

const SIZE = 80;
const GOLDENS = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"fixtures",
	"patterns",
);
const UPDATE = process.env.UPDATE_GOLDENS === "1";

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

type Pixels = { width: number; height: number; px: Uint8Array };

async function paint(
	scene: Node,
	opts: {
		scale?: number;
		supersample?: number;
		fonts?: Map<string, Uint8Array[]>;
	} = {},
): Promise<Pixels> {
	const out = await renderSceneToPng(scene, {
		width: SIZE,
		height: SIZE,
		ck,
		...opts,
	});
	expect(out.warnings ?? []).toEqual([]);
	const img = ck.MakeImageFromEncoded(out.bytes);
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

function rect(fill: ResolvedFill, pos = { x: 0, y: 0 }): Node {
	return createRect({
		pos,
		size: { width: SIZE - pos.x, height: SIZE - pos.y },
		fills: [{ kind: "solid", color: "#ffffff" }, fill],
	});
}

const red = (p: Pixels, x: number, y: number) => p.px[(y * p.width + x) * 4];

function mean(p: Pixels): number {
	let sum = 0;
	for (let i = 0; i < p.px.length; i += 4) sum += p.px[i];
	return sum / (p.px.length / 4);
}

// The 2× render reduced to 1× by averaging each 2×2 block.
function halve(p: Pixels): Pixels {
	const width = p.width / 2;
	const height = p.height / 2;
	const px = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const v =
				red(p, 2 * x, 2 * y) +
				red(p, 2 * x + 1, 2 * y) +
				red(p, 2 * x, 2 * y + 1) +
				red(p, 2 * x + 1, 2 * y + 1);
			px[(y * width + x) * 4] = Math.round(v / 4);
		}
	return { width, height, px };
}

function deviation(p: Pixels): number {
	const m = mean(p);
	let sum = 0;
	for (let i = 0; i < p.px.length; i += 4) sum += (p.px[i] - m) ** 2;
	return Math.sqrt(sum / (p.px.length / 4));
}

// A render reduced by `k` in each axis, averaging each k×k block.
function reduce(p: Pixels, k: number): Pixels {
	const width = Math.floor(p.width / k);
	const height = Math.floor(p.height / k);
	const px = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			let v = 0;
			for (let j = 0; j < k; j++)
				for (let i = 0; i < k; i++) v += red(p, k * x + i, k * y + j);
			px[(y * width + x) * 4] = Math.round(v / (k * k));
		}
	return { width, height, px };
}

function correlation(a: Pixels, b: Pixels): number {
	const n = a.width * a.height;
	const ma = mean(a);
	const mb = mean(b);
	let ab = 0;
	let aa = 0;
	let bb = 0;
	for (let i = 0; i < n; i++) {
		const da = a.px[i * 4] - ma;
		const db = b.px[i * 4] - mb;
		ab += da * db;
		aa += da * da;
		bb += db * db;
	}
	return ab / Math.sqrt(aa * bb);
}

function differing(a: Pixels, b: Pixels): number {
	let n = 0;
	for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) n++;
	return n;
}

const INK: [string, string] = ["#ffffff", "#000000"];

function kindFill(
	pattern: PatternKind,
	params: Parameters<typeof patternFill>[1] = {},
) {
	return patternFill(pattern, { colors: INK, ...params });
}

describe.each(PATTERN_KINDS)("%s pattern", (pattern) => {
	const fill = kindFill(pattern, pattern === "noise" ? { scale: 4 } : {});

	test("paints the same pixels on every render", async () => {
		const a = await paint(rect(fill));
		const b = await paint(rect(fill));
		expect(differing(a, b)).toBe(0);
		const values = new Set<number>();
		for (let i = 0; i < a.px.length; i += 4) values.add(a.px[i]);
		expect(values.size).toBeGreaterThan(2);
	});

	test("keeps its size in design units at 2x export density", async () => {
		const one = await paint(rect(fill));
		const two = await paint(rect(fill), { scale: 2 });
		expect(two.width).toBe(SIZE * 2);
		expect(correlation(one, halve(two))).toBeGreaterThan(0.85);
		expect(Math.abs(mean(one) - mean(two))).toBeLessThan(8);
	});

	test("supersampling keeps the pattern in place", async () => {
		const one = await paint(rect(fill));
		const ss = await paint(rect(fill), { supersample: 2 });
		expect(correlation(one, ss)).toBeGreaterThan(0.85);
	});

	test("moves with the drawable", async () => {
		const at = await paint(rect(fill, { x: 0, y: 0 }));
		const shifted = await paint(rect(fill, { x: 20, y: 20 }));
		for (const [x, y] of [
			[3, 5],
			[17, 29],
			[40, 11],
		])
			expect(red(shifted, x + 20, y + 20)).toBeCloseTo(red(at, x, y), -0.5);
	});

	test("density moves the mean toward the second colour", async () => {
		const light = await paint(rect(kindFill(pattern, { density: 0.1 })));
		const dark = await paint(rect(kindFill(pattern, { density: 0.8 })));
		expect(mean(dark)).toBeLessThan(mean(light) - 30);
	});

	test("validates as a well-formed command", () => {
		expect(
			validateCommands([
				{ op: "createCanvas", width: 10, height: 10 },
				{
					op: "drawRect",
					pos: { x: 0, y: 0 },
					size: { width: 10, height: 10 },
					fills: [fill],
				},
			]),
		).toEqual([]);
	});
});

// Regenerate with UPDATE_GOLDENS=1 after an intended change to a pattern.
describe.each(PATTERN_KINDS)("%s golden", (pattern) => {
	test.each([1, 2])("matches at %dx", async (scale) => {
		const fill = patternFill(pattern, {
			angle: pattern === "hatching" ? 30 : 15,
			seed: 7,
		});
		const out = await renderSceneToPng(rect(fill), {
			width: SIZE,
			height: SIZE,
			scale,
			ck,
		});
		const file = join(GOLDENS, `${pattern}@${scale}x.png`);
		if (UPDATE) {
			mkdirSync(GOLDENS, { recursive: true });
			writeFileSync(file, out.bytes);
		}
		const golden = ck.MakeImageFromEncoded(readFileSync(file));
		const actual = ck.MakeImageFromEncoded(out.bytes);
		const info = {
			width: SIZE * scale,
			height: SIZE * scale,
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		};
		const a = golden.readPixels(0, 0, info);
		const b = actual.readPixels(0, 0, info);
		golden.delete();
		actual.delete();
		let max = 0;
		for (let i = 0; i < a.length; i++)
			max = Math.max(max, Math.abs(a[i] - b[i]));
		expect(max).toBeLessThanOrEqual(2);
	});
});

describe("hatching geometry", () => {
	test("lines sit across the spacing and scale with density", async () => {
		const fill = kindFill("hatching", { angle: 0, scale: 8, density: 0.25 });
		const one = await paint(rect(fill));
		expect(red(one, 10, 4)).toBeLessThan(20);
		expect(red(one, 10, 12)).toBeLessThan(20);
		expect(red(one, 10, 0)).toBeGreaterThan(235);
		expect(red(one, 10, 8)).toBeGreaterThan(235);
		const two = await paint(rect(fill), { scale: 2 });
		expect(red(two, 20, 8)).toBeLessThan(20);
		expect(red(two, 20, 24)).toBeLessThan(20);
		expect(red(two, 20, 16)).toBeGreaterThan(235);
	});

	test("angle turns the lines", async () => {
		const flat = await paint(rect(kindFill("hatching", { angle: 0 })));
		const upright = await paint(rect(kindFill("hatching", { angle: 90 })));
		for (let x = 0; x < SIZE; x++)
			for (let y = 0; y < SIZE; y++)
				expect(red(upright, x, y)).toBe(red(flat, y, x));
	});
});

describe("dots geometry", () => {
	test("dots centre on each cell", async () => {
		const p = await paint(rect(kindFill("dots", { scale: 10, density: 0.3 })));
		expect(red(p, 5, 5)).toBeLessThan(20);
		expect(red(p, 25, 45)).toBeLessThan(20);
		expect(red(p, 0, 0)).toBeGreaterThan(235);
		expect(red(p, 10, 10)).toBeGreaterThan(235);
	});

	test("sub-pixel dots fade to their mean coverage", async () => {
		const density = 0.4;
		const p = await paint(rect(kindFill("dots", { scale: 0.3, density })));
		expect(mean(p)).toBeCloseTo(255 * (1 - density), -1);
	});
});

describe.each(["noise", "paper"] as const)("%s seed", (pattern) => {
	test("a different seed paints a different texture", async () => {
		const a = await paint(rect(kindFill(pattern, { seed: 1 })));
		const b = await paint(rect(kindFill(pattern, { seed: 2 })));
		expect(differing(a, b)).toBeGreaterThan(SIZE * SIZE);
	});
});

describe.each(PATTERN_KINDS)("%s tone", (pattern) => {
	const AREA = 320;
	const fill = kindFill(pattern);
	const full = 255 * (1 - patternMean(pattern, fill.density));
	const meanTolerance = { noise: 1.5, paper: 6, hatching: 1.5, dots: 3 }[
		pattern
	];
	const shot = async (scale: number) => {
		const out = await renderSceneToPng(
			createRect({
				pos: { x: 0, y: 0 },
				size: { width: AREA, height: AREA },
				fills: [{ kind: "solid", color: "#ffffff" }, fill],
			}),
			{ width: AREA, height: AREA, scale, ck },
		);
		const img = ck.MakeImageFromEncoded(out.bytes);
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
		return { width, height, px } as Pixels;
	};

	test.each([1, 0.5, 0.25])(
		"holds its mean and contrast at zoom %d",
		async (zoom) => {
			const at = await shot(zoom);
			const reference = reduce(await shot(zoom * 4), 4);
			expect(Math.abs(mean(at) - full)).toBeLessThan(meanTolerance);
			expect(Math.abs(mean(reference) - full)).toBeLessThan(meanTolerance);
			expect(deviation(at)).toBeGreaterThan(deviation(reference) * 0.8);
			expect(deviation(at)).toBeLessThan(deviation(reference) * 1.2);
		},
	);

	test("holds its mean once faded out at zoom 1/8", async () => {
		expect(Math.abs(mean(await shot(0.125)) - full)).toBeLessThan(
			meanTolerance,
		);
	});

	test("a 1x render matches a 3x render reduced to 1x", async () => {
		const one = await shot(1);
		const three = reduce(await shot(3), 3);
		expect(Math.abs(mean(one) - mean(three))).toBeLessThan(meanTolerance);
		expect(deviation(one)).toBeGreaterThan(deviation(three) * 0.9);
		expect(deviation(one)).toBeLessThan(deviation(three) * 1.1);
	});
});

describe("pattern compile failure", () => {
	test("reports a warning and retries on the next paint", async () => {
		let calls = 0;
		let fail = true;
		const failing = Object.create(ck);
		failing.RuntimeEffect = Object.create(ck.RuntimeEffect);
		failing.RuntimeEffect.Make = (
			sksl: string,
			onError?: (e: string) => void,
		) => {
			if (!fail || !sksl.includes("uniform float mean"))
				return ck.RuntimeEffect.Make(sksl, onError);
			calls++;
			onError?.("boom");
			return null;
		};
		const render = () =>
			renderSceneToPng(rect(kindFill("hatching")), {
				width: SIZE,
				height: SIZE,
				ck: failing,
			});
		for (let i = 0; i < 2; i++)
			expect((await render()).warnings).toEqual([
				{ kind: "pattern_unsupported", pattern: "hatching", error: "boom" },
			]);
		expect(calls).toBe(2);
		fail = false;
		expect((await render()).warnings ?? []).toEqual([]);
	});
});

describe("other drawables", () => {
	test("a path's viewBox does not stretch the pattern", async () => {
		const fill = kindFill("hatching", { angle: 0, scale: 8, density: 0.25 });
		const plain = await paint(rect(fill));
		const path = await paint(
			createPath({
				pos: { x: 0, y: 0 },
				size: { width: SIZE, height: SIZE },
				d: "M0 0H10V10H0Z",
				viewBox: { width: 10, height: 10 },
				fills: [{ kind: "solid", color: "#ffffff" }, fill],
			}),
		);
		expect(correlation(plain, path)).toBeGreaterThan(0.95);
	});

	test("text accepts a pattern fill", async () => {
		const p = await paint(
			createText({
				pos: { x: 0, y: 0 },
				size: { width: SIZE, height: SIZE },
				text: "MM",
				font: {
					family: "Geist",
					weight: 400,
					style: "normal",
					size: 60,
					lineHeight: 72,
				},
				color: "#000000",
				fill: kindFill("hatching", {
					angle: 0,
					colors: ["#ff0000", "#0000ff"],
				}),
			}),
			{ fonts: new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]) },
		);
		let red = 0;
		let blue = 0;
		for (let i = 0; i < p.px.length; i += 4) {
			if (p.px[i] > 200 && p.px[i + 2] < 50) red++;
			if (p.px[i + 2] > 200 && p.px[i] < 50) blue++;
		}
		expect(red).toBeGreaterThan(100);
		expect(blue).toBeGreaterThan(20);
	});
});
