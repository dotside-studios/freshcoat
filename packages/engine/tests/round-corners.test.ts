import { loadCanvasKit } from "@freshcoat-js/test-utils";
import type { Canvas, CanvasKit } from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import { createGroup, createPath, createRect, type Node } from "../src/node";
import { outlineGeometry } from "../src/outline";
import { roundCorners } from "../src/round-corners";
import { renderSceneToPng } from "./helpers/headless";

const TRIANGLE = "M50 10L90 90L10 90Z";
const W = 100;
const H = 100;

let ck: CanvasKit;
beforeAll(async () => {
	ck = (await loadCanvasKit()) as CanvasKit;
});

function raster(draw: (canvas: Canvas) => void) {
	const surface = ck.MakeSurface(W, H);
	if (!surface) throw new Error("no surface");
	const canvas = surface.getCanvas();
	canvas.clear(ck.WHITE);
	draw(canvas);
	const pixels = canvas.readPixels(0, 0, {
		width: W,
		height: H,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	surface.delete();
	return pixels;
}

function worstDelta(a: Uint8Array, b: Uint8Array): number {
	let worst = 0;
	for (let i = 0; i < a.length; i++)
		worst = Math.max(worst, Math.abs(a[i] - b[i]));
	return worst;
}

async function paint(node: Node): Promise<Uint8Array> {
	const ground = createRect({
		pos: { x: 0, y: 0 },
		size: { width: W, height: H },
		fills: [{ kind: "solid", color: "#ffffff" }],
	});
	const { bytes } = await renderSceneToPng(createGroup([ground, node]), {
		width: W,
		height: H,
		ck,
	});
	const pixels = decodePixels(ck, bytes);
	if (!pixels) throw new Error("decode failed");
	return pixels.data;
}

function inkOutside(
	px: Uint8Array,
	[l, t, r, b]: [number, number, number, number],
): number {
	let count = 0;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (x >= l && x < r && y >= t && y < b) continue;
			if (px[(y * W + x) * 4] < 250) count++;
		}
	return count;
}

describe("roundCorners", () => {
	test("a radius of 0 returns the path unchanged", () => {
		expect(roundCorners(TRIANGLE, 0)).toBe(TRIANGLE);
		expect(roundCorners("m0 0 l10 0 l0 10 z", 0)).toBe("m0 0 l10 0 l0 10 z");
	});

	test("matches PathEffect.MakeCorner on a triangle", () => {
		const black = (effect = false) => {
			const paint = new ck.Paint();
			paint.setColor(ck.BLACK);
			paint.setAntiAlias(true);
			if (effect) paint.setPathEffect(ck.PathEffect.MakeCorner(12));
			return paint;
		};
		const sharp = ck.Path.MakeFromSVGString(TRIANGLE);
		const rounded = ck.Path.MakeFromSVGString(roundCorners(TRIANGLE, 12));
		if (!sharp || !rounded) throw new Error("bad path");
		const viaEffect = raster((c) => c.drawPath(sharp, black(true)));
		const viaPath = raster((c) => c.drawPath(rounded, black()));
		const unrounded = raster((c) => c.drawPath(sharp, black()));
		expect(worstDelta(viaEffect, viaPath)).toBeLessThanOrEqual(2);
		expect(worstDelta(viaEffect, unrounded)).toBeGreaterThan(100);
		sharp.delete();
		rounded.delete();
	});

	test("returns unreadable path data unchanged", () => {
		expect(roundCorners("M0 0 L10", 4)).toBe("M0 0 L10");
		expect(roundCorners("M0 0 X10 10", 4)).toBe("M0 0 X10 10");
	});

	test("keeps curves and the corners beside them", () => {
		expect(roundCorners("M0 0L10 0Q20 0 20 10", 4)).toBe(
			"M 0 0 L 10 0 Q 20 0 20 10",
		);
		expect(roundCorners("M0 0L10 0L10 10", 4)).toBe(
			"M 0 0 L 6 0 Q 10 0 10 4 L 10 10",
		);
	});

	test("rounds the start corner of a closed subpath", () => {
		expect(roundCorners("M0 0H6V8Z", 5)).toBe(
			"M 3 0 Q 6 0 6 4 Q 6 8 3 4 Q 0 0 3 0 Z",
		);
	});

	test("a rounded triangle fills and strokes inside its bounds", async () => {
		const d = roundCorners(TRIANGLE, 15);
		const path = ck.Path.MakeFromSVGString(d);
		const sharp = ck.Path.MakeFromSVGString(TRIANGLE);
		if (!path || !sharp) throw new Error("bad path");
		const [l, t, r, b] = path.computeTightBounds();
		expect(l).toBeGreaterThanOrEqual(10);
		expect(t).toBeGreaterThan(10);
		expect(r).toBeLessThanOrEqual(90);
		expect(b).toBeLessThanOrEqual(90);
		const stroked = path.makeStroked({ width: 6 });
		const sharpStroked = sharp.makeStroked({ width: 6 });
		if (!stroked || !sharpStroked) throw new Error("bad stroke");
		const [sl, st, sr, sb] = stroked.computeTightBounds();
		expect(sl).toBeGreaterThanOrEqual(7);
		expect(st).toBeGreaterThanOrEqual(7);
		expect(sr).toBeLessThanOrEqual(93);
		expect(sb).toBeLessThanOrEqual(93);
		expect(st).toBeGreaterThan(sharpStroked.computeTightBounds()[1]);
		for (const p of [path, sharp, stroked, sharpStroked]) p.delete();

		const px = await paint(
			createPath({
				pos: { x: 0, y: 0 },
				size: { width: W, height: H },
				d,
				fills: [{ kind: "solid", color: "#000000" }],
				stroke: { color: "#000000", width: 6 },
			}),
		);
		expect(inkOutside(px, [7, 7, 93, 93])).toBe(0);
		expect(px[(12 * W + 50) * 4]).toBeGreaterThan(250);
		expect(px[(40 * W + 50) * 4]).toBeLessThan(5);
	});
});

describe("polygon outline", () => {
	test("rounds every vertex by cornerRadius", () => {
		const sharp = outlineGeometry({ kind: "polygon", sides: 3 }, 0, 0, 100, 100);
		const zero = outlineGeometry(
			{ kind: "polygon", sides: 3, cornerRadius: 0 },
			0,
			0,
			100,
			100,
		);
		const rounded = outlineGeometry(
			{ kind: "polygon", sides: 3, cornerRadius: 10 },
			0,
			0,
			100,
			100,
		);
		expect(zero).toEqual(sharp);
		expect(rounded?.kind).toBe("path");
		if (rounded?.kind !== "path") return;
		expect(rounded.d.match(/Q/g)).toHaveLength(3);
		const path = ck.Path.MakeFromSVGString(rounded.d);
		if (!path) throw new Error("bad path");
		expect(path.contains(50, 1)).toBe(false);
		expect(path.contains(50, 50)).toBe(true);
		path.delete();
	});
});
