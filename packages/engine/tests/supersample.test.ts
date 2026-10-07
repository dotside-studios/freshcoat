// Supersampling — the knob for a FIXED output size: render denser than the
// export, reduce to it. Covers (1) the factor math and its two ceilings, (2) the
// factor riding on `createCanvas` without touching the rest of the stream, and
// (3) end to end through paint: the output size is unchanged, edge coverage that
// a same-size render can only approximate is resolved, and the frame finish still
// runs at output resolution rather than being averaged away by the reduction.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import {
	MAX_EXPORT_DIMENSION,
	MAX_SUPERSAMPLE,
	resolveSupersample,
} from "../src/export-scale";
import { renderSceneToPng } from "./helpers/headless";
import { createFrame, createPath, createRect } from "../src/node";
import type { EncodedPaintResult } from "../src/runtime-types";

const SIZE = { width: 100, height: 50 };

async function ckInit(): Promise<any> {
	return (await loadCanvasKit()) as unknown;
}

type RGB = [number, number, number];
const decode = (ck: any, png: Uint8Array) => {
	const d = decodePixels(ck, png);
	if (!d) throw new Error("decode failed");
	return {
		width: d.width,
		height: d.height,
		at: (x: number, y: number): RGB => {
			const o = (y * d.width + x) * 4;
			return [d.data[o], d.data[o + 1], d.data[o + 2]];
		},
	};
};

describe("resolveSupersample", () => {
	test("omitted, 1, and degenerate values all mean no supersampling", () => {
		expect(resolveSupersample(undefined, SIZE, 1)).toBe(1);
		expect(resolveSupersample(1, SIZE, 1)).toBe(1);
		expect(resolveSupersample(0, SIZE, 1)).toBe(1);
		expect(resolveSupersample(-2, SIZE, 1)).toBe(1);
		expect(resolveSupersample(Number.NaN, SIZE, 1)).toBe(1);
	});

	test("a factor is itself, up to the sample ceiling", () => {
		expect(resolveSupersample(2, SIZE, 1)).toBe(2);
		expect(resolveSupersample(99, SIZE, 1)).toBe(MAX_SUPERSAMPLE);
	});

	test("factors round down to a power of two — the reduction halves", () => {
		expect(resolveSupersample(1.5, SIZE, 1)).toBe(1);
		expect(resolveSupersample(2.9, SIZE, 1)).toBe(2);
		// 3 is honoured as 2: a 3:1 reduction cannot be a chain of halvings, and
		// resampling straight down would drop most of the samples it paid for.
		expect(resolveSupersample(3, SIZE, 1)).toBe(2);
	});

	test("the ceiling applies to the RENDER surface, so the export scale counts", () => {
		const big = { width: 4000, height: 2000 };
		// 4000 × 1 × 4 would be 16000px of render surface. 8192/4000 is 2.048, so
		// only the 2× level fits.
		expect(resolveSupersample(4, big, 1)).toBe(2);
		expect(4000 * 2).toBeLessThanOrEqual(MAX_EXPORT_DIMENSION);
		// Already exported at 2×: the 1.024× of headroom left is not a whole
		// sample, so this renders at the export size rather than paying for a
		// second surface to gain nothing.
		expect(resolveSupersample(4, big, 2)).toBe(1);
		// An override bounds it tighter than the default ceiling.
		expect(resolveSupersample(4, SIZE, 1, { maxDimension: 200 })).toBe(2);
	});

	test("a degenerate design size keeps the request rather than dividing by zero", () => {
		expect(resolveSupersample(2, { width: 0, height: 0 }, 1)).toBe(2);
	});
});

// Two right triangles that tile the box exactly, sharing the diagonal. Drawn
// separately, so the shared edge is where per-primitive antialiasing shows: each
// triangle blends its own ~50% coverage against what is already there, and the
// two blends do not add back up to the solid black the union actually is.
const abuttingTriangles = () =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 20, height: 20 },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: 20, height: 20 },
			fills: [{ kind: "solid", color: "#ffffff" }],
		}),
		children: [
			createPath({
				pos: { x: 0, y: 0 },
				size: { width: 20, height: 20 },
				d: "M0 0 L20 20 L0 20 Z",
				fills: [{ kind: "solid", color: "#000000" }],
			}),
			createPath({
				pos: { x: 0, y: 0 },
				size: { width: 20, height: 20 },
				d: "M0 0 L20 0 L20 20 Z",
				fills: [{ kind: "solid", color: "#000000" }],
			}),
		],
	});

const flat = (color: string) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 20, height: 20 },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: 20, height: 20 },
			fills: [{ kind: "solid", color }],
		}),
		children: [],
	});

describe("compileScene supersample", () => {
	test("1× leaves the factor off the command entirely", () => {
		const bare = compileScene(flat("#000000"), { width: 20, height: 20 });
		const one = compileScene(flat("#000000"), {
			width: 20,
			height: 20,
			supersample: 1,
		});
		expect(bare[0]).toEqual({ op: "createCanvas", width: 20, height: 20 });
		expect(one[0]).toEqual(bare[0]);
	});

	test("the factor rides alongside the density, and the scene is untouched", () => {
		const base = compileScene(abuttingTriangles(), { width: 20, height: 20 });
		const ss = compileScene(abuttingTriangles(), {
			width: 20,
			height: 20,
			scale: 2,
			supersample: 2,
		});
		expect(ss[0]).toEqual({
			op: "createCanvas",
			width: 20,
			height: 20,
			scale: 2,
			supersample: 2,
		});
		// Every drawable stays in design units — the density is the painter's job.
		expect(ss.slice(1)).toEqual(base.slice(1));
	});
});

describe("painting with supersampling", () => {
	test("the output keeps the export's size — that is the whole point", async () => {
		const ck = await ckInit();
		for (const [scale, supersample, w] of [
			[1, 2, 20],
			[1, 4, 20],
			[2, 2, 40],
			[0.5, 4, 10],
		] as const) {
			const out = (await renderSceneToPng(abuttingTriangles(), {
				width: 20,
				height: 20,
				ck,
				scale,
				supersample,
			})) as EncodedPaintResult;
			const png = decode(ck, out.bytes);
			expect([png.width, png.height]).toEqual([w, w]);
			expect(out.warnings).toEqual([]);
		}
	});

	test("coverage along a shared edge resolves instead of seaming", async () => {
		const ck = await ckInit();
		const render = async (supersample?: number) =>
			decode(
				ck,
				(
					(await renderSceneToPng(abuttingTriangles(), {
						width: 20,
						height: 20,
						ck,
						supersample,
					})) as EncodedPaintResult
				).bytes,
			);
		const plain = await render();
		const at2 = await render(2);
		const at4 = await render(4);

		// The two triangles tile the box, so every pixel on the diagonal is fully
		// covered and belongs at black; anything above 0 is the seam. Each doubling
		// of the sample rate halves that error — the signature of every sample
		// reaching the average, and what a reduction that skips samples fails.
		const seam = (px: RGB) => px[0];
		for (const i of [5, 10, 15]) {
			expect(seam(at2.at(i, i))).toBeLessThan(seam(plain.at(i, i)) * 0.6);
			expect(seam(at4.at(i, i))).toBeLessThan(seam(at2.at(i, i)) * 0.6);
		}
		// A seam is what the same-size render actually produces — if this stops
		// holding, the comparisons above are passing for some other reason.
		expect(seam(plain.at(10, 10))).toBeGreaterThan(40);

		// Away from the diagonal all three agree: supersampling resolves edges, it
		// does not shift or soften the interior.
		for (const img of [plain, at2, at4])
			expect(img.at(2, 17)).toEqual([0, 0, 0]);
	});

	test("the frame finish runs after the reduction, at output resolution", async () => {
		const ck = await ckInit();
		const out = (await renderSceneToPng(flat("#fafafa"), {
			width: 20,
			height: 20,
			ck,
			supersample: 4,
			finish: { whiteClamp: 248 },
		})) as EncodedPaintResult;
		const png = decode(ck, out.bytes);
		// Near-white (250) snaps to pure white. Run before the reduction instead,
		// the clamped pixels would be averaged back down off 255.
		expect([png.width, png.height]).toEqual([20, 20]);
		expect(png.at(2, 2)).toEqual([255, 255, 255]);
		expect(png.at(17, 17)).toEqual([255, 255, 255]);
	});

	test("a factor that resolves to no supersampling still renders", async () => {
		const ck = await ckInit();
		// 1.5 is not a whole factor, so this takes the plain path — and comes out
		// the export size with its colour intact either way.
		const out = (await renderSceneToPng(flat("#123456"), {
			width: 20,
			height: 20,
			ck,
			supersample: 1.5,
		})) as EncodedPaintResult;
		const png = decode(ck, out.bytes);
		expect([png.width, png.height]).toEqual([20, 20]);
		expect(png.at(10, 10)).toEqual([0x12, 0x34, 0x56]);
	});
});
