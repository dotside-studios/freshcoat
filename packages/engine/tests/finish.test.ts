// FrameFinish: the whole-frame, post-composite output pass — white-clamp,
// black-extract, and dither — run through an SkSL pass on the final surface.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { renderSceneToPng } from "./helpers/headless";
import { createFrame, createRect } from "../src/node";
import type { EncodedPaintResult } from "../src/runtime-types";
import type { FrameFinish } from "../src/types";

type RGB = [number, number, number];

const pixelAt = (ck: any, png: Uint8Array, x: number, y: number): RGB => {
	const img = ck.MakeImageFromEncoded(png);
	const w = img.width();
	const info = {
		width: w,
		height: img.height(),
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	};
	const buf = img.readPixels(0, 0, info, undefined, w * 4) as Uint8Array;
	const o = (y * w + x) * 4;
	const out: RGB = [buf[o], buf[o + 1], buf[o + 2]];
	img.delete();
	return out;
};

// Three swatches: near-white (250), near-black (12), mid-gray (128).
const swatchScene = () =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 60, height: 20 },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: 60, height: 20 },
			fills: [{ kind: "solid", color: "#808080" }],
		}),
		children: [
			createRect({
				pos: { x: 0, y: 0 },
				size: { width: 20, height: 20 },
				fills: [{ kind: "solid", color: "#fafafa" }],
			}),
			createRect({
				pos: { x: 40, y: 0 },
				size: { width: 20, height: 20 },
				fills: [{ kind: "solid", color: "#0c0c0c" }],
			}),
		],
	});

const render = async (ck: unknown, finish?: FrameFinish) =>
	(await renderSceneToPng(swatchScene(), {
		width: 60,
		height: 20,
		ck,
		finish,
	})) as EncodedPaintResult;

describe("FrameFinish", () => {
	test("white-clamp and black-extract snap near-white/near-black to pure", async () => {
		const ck = await loadCanvasKit();
		const control = await render(ck);
		const finished = await render(ck, { whiteClamp: 248, blackExtract: 30 });

		// Control keeps the near values; finish snaps them to 255 / 0.
		expect(pixelAt(ck, control.bytes, 10, 10)[0]).toBe(250);
		expect(pixelAt(ck, control.bytes, 50, 10)[0]).toBe(12);
		expect(pixelAt(ck, finished.bytes, 10, 10)).toEqual([255, 255, 255]);
		expect(pixelAt(ck, finished.bytes, 50, 10)).toEqual([0, 0, 0]);
		// The mid-gray between the thresholds is untouched.
		expect(pixelAt(ck, finished.bytes, 30, 10)[0]).toBe(128);
	});

	test("thresholds are exclusive — values at/below stay put", async () => {
		const ck = await loadCanvasKit();
		// whiteClamp 250 does NOT clamp a 250 pixel (needs strictly greater).
		const finished = await render(ck, { whiteClamp: 250 });
		expect(pixelAt(ck, finished.bytes, 10, 10)[0]).toBe(250);
	});

	test("dither perturbs a flat field into varied values (breaks banding)", async () => {
		const ck = await loadCanvasKit();
		const finished = await render(ck, { dither: 4 });
		// Sample several mid-gray pixels; with ±4-level noise they should not all be
		// identical, and should stay near 128.
		const xs = [26, 28, 30, 32, 34];
		const vals = xs.map((x) => pixelAt(ck, finished.bytes, x, 10)[0]);
		expect(new Set(vals).size).toBeGreaterThan(1);
		for (const v of vals) expect(Math.abs(v - 128)).toBeLessThanOrEqual(6);
	});

	test("monochrome dither is seed-stable and never introduces colored grain", async () => {
		const ck = await loadCanvasKit();
		const finish: FrameFinish = {
			dither: { amount: 4, seed: 8675309, mode: "monochrome" },
		};
		const first = await render(ck, finish);
		const repeated = await render(ck, finish);
		expect(first.bytes).toEqual(repeated.bytes);
		for (const x of [26, 28, 30, 32, 34]) {
			const [r, g, b] = pixelAt(ck, first.bytes, x, 10);
			expect(r).toBe(g);
			expect(g).toBe(b);
		}
		const otherSeed = await render(ck, {
			dither: { amount: 4, seed: 8675310, mode: "monochrome" },
		});
		expect(otherSeed.bytes).not.toEqual(first.bytes);
	});

	test("an all-undefined finish emits no command and changes nothing", async () => {
		const ck = await loadCanvasKit();
		const control = await render(ck);
		const noop = await render(ck, {});
		expect(pixelAt(ck, noop.bytes, 10, 10)).toEqual(
			pixelAt(ck, control.bytes, 10, 10),
		);
		expect(pixelAt(ck, noop.bytes, 30, 10)).toEqual(
			pixelAt(ck, control.bytes, 30, 10),
		);
	});
});
