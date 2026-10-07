// One order for a drawable's layer effects on every paint path: content, clip
// and mask, color adjust, sharpen, layer blur, shadows, opacity, blend. See
// README.md's "Layer effect order".
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import { createFrame, createGroup, createRect, type Node } from "../src/node";
import type { Adjust } from "../src/types";

const W = 120;
const H = 80;

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

type RGBA = [number, number, number, number];

async function render(children: Node[]) {
	const scene = createFrame({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: [{ kind: "solid", color: "#ffffff" }],
		}),
		children,
	});
	const out = await renderSceneToPng(scene, { width: W, height: H, ck });
	expect(out.warnings).toEqual([]);
	const px = decodePixels(ck, out.bytes);
	if (!px) throw new Error("decode failed");
	return px;
}

function at(px: { data: Uint8Array; width: number }, x: number, y: number) {
	const o = (y * px.width + x) * 4;
	return Array.from(px.data.slice(o, o + 4)) as RGBA;
}

function maxDiff(a: { data: Uint8Array }, b: { data: Uint8Array }): number {
	let max = 0;
	for (let i = 0; i < a.data.length; i++)
		max = Math.max(max, Math.abs(a.data[i] - b.data[i]));
	return max;
}

const square = (props: Record<string, unknown>) =>
	createRect({
		pos: { x: 20, y: 20 },
		size: { width: 40, height: 40 },
		fills: [{ kind: "solid", color: "#808080" }],
		...props,
	});

const SHADOW = { color: "#2040c0", dx: 40, dy: 0, blur: 0 };

const table = (f: (i: number) => number) =>
	Uint8Array.from({ length: 256 }, (_, i) => Math.round(f(i)));

// The same per-channel scaling as a color matrix and as a curve LUT.
const SCALE_MATRIX: Adjust = {
	colorMatrix: [
		0.5, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0, 1, 0,
	],
};
const SCALE_LUT: Adjust = {
	lut: {
		r: table((i) => i * 0.5),
		g: table((i) => i),
		b: table((i) => i * 0.25),
	},
};

describe("adjust leaves shadows in their own color", () => {
	test("a LUT darkens the content but not the drop shadow", async () => {
		const px = await render([
			square({ shadow: SHADOW, adjust: buildAdjust({ gamma: 2 }) }),
		]);
		const shadow = at(px, 80, 40);
		expect(shadow[0]).toBeCloseTo(0x20, -0.5);
		expect(shadow[1]).toBeCloseTo(0x40, -0.5);
		expect(shadow[2]).toBeCloseTo(0xc0, -0.5);
		expect(at(px, 40, 40)[0]).toBeCloseTo(64, -0.5);
	});

	test("a color matrix leaves the drop shadow alone", async () => {
		const px = await render([
			square({
				shadow: SHADOW,
				adjust: {
					colorMatrix: [
						0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0,
					],
				},
			}),
		]);
		expect(at(px, 80, 40)).toEqual([0x20, 0x40, 0xc0, 255]);
	});

	test("a matrix and a LUT with the same mapping paint the same", async () => {
		const effects = {
			shadow: [
				{ color: "#c04020", dx: 30, dy: 6, blur: 6 },
				{ color: "#2040c080", dx: -6, dy: 4, blur: 2, spread: 3 },
			],
			blur: 2,
			opacity: 0.8,
			blendMode: "multiply" as const,
		};
		const byMatrix = await render([
			square({ ...effects, adjust: SCALE_MATRIX }),
		]);
		const byLut = await render([square({ ...effects, adjust: SCALE_LUT })]);
		expect(maxDiff(byMatrix, byLut)).toBeLessThanOrEqual(2);
	});
});

describe("spatial order", () => {
	test("sharpen runs before the layer blur", async () => {
		const flat = await render([
			createGroup([square({ adjust: buildAdjust({ sharpen: 2 }) })], {
				pos: { x: 0, y: 0 },
				size: { width: W, height: H },
				blur: 6,
			}),
		]);
		const own = await render([
			square({ blur: 6, adjust: buildAdjust({ sharpen: 2 }) }),
		]);
		expect(maxDiff(flat, own)).toBeLessThanOrEqual(2);
	});

	test("shadows are cast after the adjust, not adjusted with the content", async () => {
		const nested = await render([
			createGroup([square({ adjust: buildAdjust({ gamma: 2, sharpen: 1 }) })], {
				pos: { x: 0, y: 0 },
				size: { width: W, height: H },
				shadow: SHADOW,
			}),
		]);
		const own = await render([
			square({ shadow: SHADOW, adjust: buildAdjust({ gamma: 2, sharpen: 1 }) }),
		]);
		expect(maxDiff(nested, own)).toBeLessThanOrEqual(2);
	});
});

describe("opacity and blend composite the adjusted layer", () => {
	const under = createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: [{ kind: "solid", color: "#808080" }],
	});

	test("a LUT layer multiplies onto its parent", async () => {
		const px = await render([
			under,
			square({ blendMode: "multiply", adjust: buildAdjust({ gamma: 2 }) }),
		]);
		// 128 at gamma 2 is 64; 64 multiplied onto 128 is 32.
		expect(at(px, 40, 40)[0]).toBeCloseTo(32, -0.5);
		expect(at(px, 100, 10)[0]).toBe(128);
	});

	test("opacity applies after the adjust", async () => {
		const px = await render([
			square({
				opacity: 0.5,
				adjust: {
					colorMatrix: [
						1, 0, 0, 0, 0.2, 0, 1, 0, 0, 0.2, 0, 0, 1, 0, 0.2, 0, 0, 0, 1, 0,
					],
				},
			}),
		]);
		// (128 + 51) at half opacity over white.
		expect(at(px, 40, 40)[0]).toBeCloseTo((179 + 255) / 2, -0.5);
	});
});
