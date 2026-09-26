// Export scale — Figma's export-settings model: one compile at the design size,
// rasterized at whatever density an export asks for. Covers (1) the constraint →
// scale math and its ceiling, (2) the density riding on `createCanvas` without
// touching the rest of the command stream, and (3) end to end through paint: the
// surface grows, geometry finer than a design unit resolves, and the two passes
// that step outside the scaled canvas matrix — the frame finish and the adjust
// offscreen — still cover the whole frame.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { compileScene } from "../src/compile-scene";
import { decodePixels } from "../src/decode";
import {
	exportPixelSize,
	MAX_EXPORT_DIMENSION,
	resolveExportScale,
} from "../src/export-scale";
import { renderSceneToPng } from "../src/headless";
import { createFrame, createRect, createText } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { EncodedPaintResult } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const SIZE = { width: 100, height: 50 };

async function ckInit(): Promise<any> {
	return (await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	})) as unknown;
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

describe("resolveExportScale", () => {
	test("no constraint is 1×", () => {
		expect(resolveExportScale(undefined, SIZE)).toBe(1);
	});

	test("a scale constraint is the multiplier itself", () => {
		expect(resolveExportScale({ kind: "scale", value: 2 }, SIZE)).toBe(2);
		expect(resolveExportScale({ kind: "scale", value: 0.5 }, SIZE)).toBe(0.5);
	});

	test("width/height constraints derive the multiplier from the design size", () => {
		expect(resolveExportScale({ kind: "width", value: 400 }, SIZE)).toBe(4);
		expect(resolveExportScale({ kind: "height", value: 25 }, SIZE)).toBe(0.5);
	});

	test("a width constraint lands on exactly that many pixels", () => {
		const scale = resolveExportScale({ kind: "width", value: 1024 }, SIZE);
		expect(exportPixelSize(SIZE, scale).width).toBe(1024);
	});

	test("the scale is lowered so neither axis crosses the ceiling", () => {
		const big = { width: 4000, height: 2000 };
		const scale = resolveExportScale({ kind: "scale", value: 8 }, big);
		expect(scale).toBe(MAX_EXPORT_DIMENSION / 4000);
		expect(exportPixelSize(big, scale).width).toBe(MAX_EXPORT_DIMENSION);
		// An override lets a caller bound it tighter than the default ceiling.
		expect(
			resolveExportScale({ kind: "scale", value: 8 }, big, {
				maxDimension: 4000,
			}),
		).toBe(1);
	});

	test("degenerate constraints fall back to 1× rather than a zero-size surface", () => {
		expect(resolveExportScale({ kind: "scale", value: 0 }, SIZE)).toBe(1);
		expect(resolveExportScale({ kind: "scale", value: -2 }, SIZE)).toBe(1);
		expect(resolveExportScale({ kind: "scale", value: Number.NaN }, SIZE)).toBe(
			1,
		);
		expect(
			resolveExportScale(
				{ kind: "width", value: 200 },
				{ width: 0, height: 0 },
			),
		).toBe(1);
	});

	test("pixel size rounds, and never rounds an axis away entirely", () => {
		expect(exportPixelSize({ width: 10.4, height: 10.6 }, 1)).toEqual({
			width: 10,
			height: 11,
		});
		expect(exportPixelSize(SIZE, 0.001)).toEqual({ width: 1, height: 1 });
	});
});

const swatch = (fill: string, adjust?: ReturnType<typeof buildAdjust>) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 20, height: 20 },
		background: createRect({
			pos: { x: 0, y: 0 },
			size: { width: 20, height: 20 },
			fills: [{ kind: "solid", color: "#ffffff" }],
		}),
		children: [
			createRect({
				pos: { x: 0, y: 0 },
				// 10.5 design units wide: the half unit only exists above 1×.
				size: { width: 10.5, height: 20 },
				fills: [{ kind: "solid", color: fill }],
				...(adjust ? { adjust } : {}),
			}),
		],
	});

describe("compileScene scale", () => {
	test("1× leaves the density off the command entirely", () => {
		const c1 = compileScene(swatch("#000000"), { width: 20, height: 20 });
		const c2 = compileScene(swatch("#000000"), {
			width: 20,
			height: 20,
			scale: 1,
		});
		expect(c1[0]).toEqual({ op: "createCanvas", width: 20, height: 20 });
		expect(c2[0]).toEqual(c1[0]);
	});

	test("a scaled export changes the density, not the scene", () => {
		const base = compileScene(swatch("#000000"), { width: 20, height: 20 });
		const scaled = compileScene(swatch("#000000"), {
			width: 20,
			height: 20,
			scale: 3,
		});
		expect(scaled[0]).toEqual({
			op: "createCanvas",
			width: 20,
			height: 20,
			scale: 3,
		});
		// Every drawable stays in design units — the density is the painter's job.
		expect(scaled.slice(1)).toEqual(base.slice(1));
	});
});

describe("text baked for an export scale", () => {
	// A 15px line at 1.31 is a 19.65px box — a value each grid rounds differently.
	const paragraph = () =>
		createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 100 },
			children: [
				createText({
					pos: { x: 0, y: 0 },
					size: { width: 200, height: 100 },
					text: "one two three four five six seven eight nine ten eleven",
					font: {
						family: "Vend Sans",
						weight: 400,
						style: "normal",
						size: 15,
						lineHeight: 1.31,
					},
					color: "#000000",
				}),
			],
		});

	test("line advances snap to the exported pixel grid, not the design one", async () => {
		const ck = await ckInit();
		const fonts = new Map([
			[
				"Vend Sans",
				[
					new Uint8Array(
						readFileSync(
							fileURLToPath(
								new URL(
									"./fonts/VendSans-Variable-latin.woff2",
									import.meta.url,
								),
							),
						),
					),
				],
			],
		]);
		const textEngine = createParagraphEngine(ck, fonts);
		try {
			const advanceAt = (scale: number) => {
				const commands = compileScene(paragraph(), {
					width: 200,
					height: 100,
					textEngine,
					scale,
				});
				const group = commands.find(
					(c) => "op" in c && c.op === "drawGroup",
				) as {
					children: { layout: { lines: { baseline?: number }[] } }[];
				};
				const [a, b] = group.children[0].layout.lines;
				if (!a?.baseline || !b?.baseline) throw new Error("expected a wrap");
				return b.baseline - a.baseline;
			};
			// 19.65 has to become 20 on the design grid; a 2× export can hold 19.5
			// and a 4× export 19.75 — the pixels the density bought get used, so the
			// paragraph tracks its true line box instead of 1×'s rounding of it.
			expect(advanceAt(1)).toBeCloseTo(20, 3);
			expect(advanceAt(2)).toBeCloseTo(19.5, 3);
			expect(advanceAt(4)).toBeCloseTo(19.75, 3);
		} finally {
			textEngine.dispose();
		}
	});
});

describe("painting at an export scale", () => {
	test("the surface is the design size times the scale", async () => {
		const ck = await ckInit();
		for (const [scale, w, h] of [
			[1, 20, 20],
			[2, 40, 40],
			[0.5, 10, 10],
		] as const) {
			const out = (await renderSceneToPng(swatch("#000000"), {
				width: 20,
				height: 20,
				ck,
				scale,
			})) as EncodedPaintResult;
			const png = decode(ck, out.bytes);
			expect([png.width, png.height]).toEqual([w, h]);
		}
	});

	test("geometry finer than a design unit resolves at the exported density", async () => {
		const ck = await ckInit();
		const at1 = decode(
			ck,
			(
				(await renderSceneToPng(swatch("#000000"), {
					width: 20,
					height: 20,
					ck,
				})) as EncodedPaintResult
			).bytes,
		);
		const at2 = decode(
			ck,
			(
				(await renderSceneToPng(swatch("#000000"), {
					width: 20,
					height: 20,
					ck,
					scale: 2,
				})) as EncodedPaintResult
			).bytes,
		);
		// The rect ends at design x 10.5. At 2× that is device column 20 — the last
		// full black column, with white beginning at 21. A 1× render upscaled could
		// never place the edge there: at 1× the same column is a coverage blend.
		expect(at2.at(20, 10)).toEqual([0, 0, 0]);
		expect(at2.at(21, 10)).toEqual([255, 255, 255]);
		const [r] = at1.at(10, 10);
		expect(r).toBeGreaterThan(0);
		expect(r).toBeLessThan(255);
	});

	test("the frame finish covers the whole surface, not the 1× corner of it", async () => {
		const ck = await ckInit();
		const out = (await renderSceneToPng(swatch("#fafafa"), {
			width: 20,
			height: 20,
			ck,
			scale: 2,
			finish: { whiteClamp: 248 },
		})) as EncodedPaintResult;
		const png = decode(ck, out.bytes);
		// Near-white (250) snaps to pure white — at the far corner too, which is
		// outside the frame's 1× box.
		expect(png.at(2, 2)).toEqual([255, 255, 255]);
		expect(png.at(39, 39)).toEqual([255, 255, 255]);
	});

	test("an offscreen adjust lands on its own box at the exported density", async () => {
		const ck = await ckInit();
		const out = (await renderSceneToPng(
			swatch("#808080", buildAdjust({ gamma: 0.5 })),
			{ width: 20, height: 20, ck, scale: 2 },
		)) as EncodedPaintResult;
		const png = decode(ck, out.bytes);
		// Gamma 0.5 lifts the mid-gray to ~181 across the adjusted layer — including
		// its far edge (design x 10, device 20), which a mis-scaled offscreen blit
		// would leave white or half-covered. Outside the layer stays white.
		const expected = Math.round(255 * (128 / 255) ** 0.5);
		for (const x of [1, 20]) {
			const px = png.at(x, 20);
			expect(Math.abs(px[0] - expected)).toBeLessThanOrEqual(3);
		}
		expect(png.at(30, 20)).toEqual([255, 255, 255]);
		expect(out.warnings).toEqual([]);
	});
});
