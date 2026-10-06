// Shadows: drop and inner, with spread, singly and stacked. Asserted on real
// painted pixels — the filter graph is CanvasKit's, so only the output proves it.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { renderSceneToPng } from "../src/headless";
import { createFrame, createRect } from "../src/node";
import type { EncodedPaintResult, Shadows } from "../src/types";

const W = 80;
const H = 80;

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

type RGBA = [number, number, number, number];

function pixelAt(png: Uint8Array, x: number, y: number): RGBA {
	const img = ck.MakeImageFromEncoded(png);
	const w = img.width();
	const buf = img.readPixels(
		0,
		0,
		{
			width: w,
			height: img.height(),
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		},
		undefined,
		w * 4,
	) as Uint8Array;
	const o = (y * w + x) * 4;
	const out: RGBA = [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]];
	img.delete();
	return out;
}

// A white 80×80 frame with one black 40×40 square at (20,20) carrying `shadow`.
async function render(shadow?: Shadows): Promise<Uint8Array> {
	const scene = createFrame({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: W, height: H },
			fills: [{ kind: "solid", color: "#ffffff" }],
		}),
		children: [
			createRect({
				pos: { x: 20, y: 20 },
				size: { width: 40, height: 40 },
				fills: [{ kind: "solid", color: "#000000" }],
				...(shadow ? { shadow } : {}),
			}),
		],
	});
	const r = (await renderSceneToPng(scene, {
		width: W,
		height: H,
		ck,
	})) as EncodedPaintResult;
	return r.bytes;
}

const luma = (p: RGBA) => p[0];

describe("drop shadow", () => {
	test("darkens outside the shape, on the offset side only", async () => {
		const plain = await render();
		const shadowed = await render({
			color: "#000000",
			dx: 8,
			dy: 0,
			blur: 0,
		});
		// Just right of the square is white without a shadow, black with one.
		expect(luma(pixelAt(plain, 64, 40))).toBe(255);
		expect(luma(pixelAt(shadowed, 64, 40))).toBe(0);
		// The opposite side is untouched.
		expect(luma(pixelAt(shadowed, 16, 40))).toBe(255);
	});

	test("spread grows the cast silhouette", async () => {
		const none = await render({ color: "#000000", dx: 0, dy: 0, blur: 0 });
		const spread = await render({
			color: "#000000",
			dx: 0,
			dy: 0,
			blur: 0,
			spread: 6,
		});
		// 4px outside the square: only the spread version reaches it.
		expect(luma(pixelAt(none, 64, 40))).toBe(255);
		expect(luma(pixelAt(spread, 64, 40))).toBe(0);
	});

	test("a negative spread shrinks it", async () => {
		const shrunk = await render({
			color: "#000000",
			dx: 12,
			dy: 0,
			blur: 0,
			spread: -6,
		});
		// The shadow is offset 12 but eroded 6, so it stops short of x=68.
		expect(luma(pixelAt(shrunk, 68, 40))).toBe(255);
		expect(luma(pixelAt(shrunk, 64, 40))).toBe(0);
	});
});

describe("inner shadow", () => {
	test("paints inside the shape and never outside it", async () => {
		const png = await render({
			color: "#ff0000",
			dx: 0,
			dy: 0,
			blur: 0,
			spread: 8,
			inset: true,
		});
		// A ring 8px wide inside the square's edge is the shadow colour…
		expect(pixelAt(png, 23, 40).slice(0, 3)).toEqual([255, 0, 0]);
		// …the middle is still the square's own fill…
		expect(pixelAt(png, 40, 40).slice(0, 3)).toEqual([0, 0, 0]);
		// …and nothing leaked past the edge.
		expect(luma(pixelAt(png, 16, 40))).toBe(255);
	});

	test("offsets inward from the edge it is cast from", async () => {
		const png = await render({
			color: "#ff0000",
			dx: 10,
			dy: 0,
			blur: 0,
			inset: true,
		});
		// Cast rightward: the band sits against the LEFT inside edge.
		expect(pixelAt(png, 24, 40).slice(0, 3)).toEqual([255, 0, 0]);
		expect(pixelAt(png, 40, 40).slice(0, 3)).toEqual([0, 0, 0]);
		expect(luma(pixelAt(png, 16, 40))).toBe(255);
	});
});

describe("stacked shadows", () => {
	test("each is cast from the original shape, not from the one below it", async () => {
		const png = await render([
			{ color: "#00ff00", dx: -14, dy: 0, blur: 0 },
			{ color: "#0000ff", dx: 14, dy: 0, blur: 0 },
		]);
		// Both shadows reach their own side at full strength. Chaining
		// MakeDropShadow would have cast the second off the first's result.
		expect(pixelAt(png, 10, 40).slice(0, 3)).toEqual([0, 255, 0]);
		expect(pixelAt(png, 70, 40).slice(0, 3)).toEqual([0, 0, 255]);
	});

	test("a drop and an inner shadow coexist on one drawable", async () => {
		const png = await render([
			{ color: "#00ff00", dx: 14, dy: 0, blur: 0 },
			{ color: "#ff0000", dx: 0, dy: 0, blur: 0, spread: 8, inset: true },
		]);
		expect(pixelAt(png, 70, 40).slice(0, 3)).toEqual([0, 255, 0]); // drop, outside
		expect(pixelAt(png, 23, 40).slice(0, 3)).toEqual([255, 0, 0]); // inner, inside
		expect(pixelAt(png, 40, 40).slice(0, 3)).toEqual([0, 0, 0]); // fill, untouched
	});

	test("an empty stack paints exactly like no shadow at all", async () => {
		const plain = await render();
		const empty = await render([]);
		expect(Array.from(empty)).toEqual(Array.from(plain));
	});
});
