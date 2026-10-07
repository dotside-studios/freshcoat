// The adjust offscreen covers only the layer's device rect. Each scene here was
// rendered with the earlier full-frame offscreen and committed as a golden; the
// bounded offscreen must reproduce it. Undithered gradients may move by a level
// or two under the offscreen's whole-pixel shift, as Skia evaluates them in
// lower precision.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import { auditAdjustedBounds } from "../src/canvaskit";
import {
	createFrame,
	createGroup,
	createPath,
	createRect,
	createText,
} from "../src/node";
import { BOUNDS_CASES } from "./fixtures/adjust-bounds/scenes";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const GOLDENS = join(HERE, "fixtures", "adjust-bounds");
const TOLERANCE = 2;
const FONTS = () =>
	new Map([
		["Geist", [testFontBytes("Geist-Regular.ttf")]],
		["Hebrew", [testFontBytes("NotoSansHebrew-Regular.ttf")]],
	]);

async function ckInit(): Promise<any> {
	return (await loadCanvasKit()) as unknown;
}

function maxDiff(ck: any, a: Uint8Array, b: Uint8Array): number {
	const pa = decodePixels(ck, a);
	const pb = decodePixels(ck, b);
	if (!pa || !pb) throw new Error("decode failed");
	expect([pb.width, pb.height]).toEqual([pa.width, pa.height]);
	let max = 0;
	for (let i = 0; i < pa.data.length; i++)
		max = Math.max(max, Math.abs(pa.data[i] - pb.data[i]));
	return max;
}

describe("adjust offscreen sized to the layer", () => {
	for (const c of BOUNDS_CASES) {
		test(`${c.name} renders as with a full-frame offscreen`, async () => {
			const ck = await ckInit();
			const out = await renderSceneToPng(c.scene, {
				width: c.width,
				height: c.height,
				scale: c.scale,
				supersample: c.supersample,
				ck,
				...(c.fonts ? { fonts: FONTS() } : {}),
			});
			expect(out.warnings).toEqual([]);
			const golden = readFileSync(join(GOLDENS, `${c.name}.png`));
			expect(maxDiff(ck, golden, out.bytes)).toBeLessThanOrEqual(TOLERANCE);
		});
	}

	test("allocates the layer's device rect, not the frame", async () => {
		const ck = await ckInit();
		const sizes: [number, number][] = [];
		const make = ck.Canvas.prototype.makeSurface;
		ck.Canvas.prototype.makeSurface = function (info: any) {
			sizes.push([info.width, info.height]);
			return make.call(this, info);
		};
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 400, height: 300 },
			children: [
				createRect({
					pos: { x: 100, y: 50 },
					size: { width: 20, height: 10 },
					fills: [{ kind: "solid", color: "#808080" }],
					adjust: buildAdjust({ gamma: 2, sharpen: 1 }),
				}),
				createRect({
					pos: { x: 500, y: 50 },
					size: { width: 20, height: 10 },
					fills: [{ kind: "solid", color: "#808080" }],
					adjust: buildAdjust({ gamma: 2 }),
				}),
			],
		});
		await renderSceneToPng(scene, { width: 400, height: 300, scale: 2, ck });
		const offscreens = sizes.filter(([w, h]) => w > 1 || h > 1);
		expect(offscreens).toHaveLength(1);
		const [w, h] = offscreens[0];
		expect(w).toBeGreaterThanOrEqual(40);
		expect(h).toBeGreaterThanOrEqual(20);
		expect(w).toBeLessThanOrEqual(56);
		expect(h).toBeLessThanOrEqual(36);
	});

	function countRecorders(ck: any) {
		const Real = ck.PictureRecorder;
		const made: { deleted: boolean }[] = [];
		ck.PictureRecorder = function () {
			const recorder = new Real();
			const entry = { deleted: false };
			made.push(entry);
			const del = recorder.delete.bind(recorder);
			recorder.delete = () => {
				entry.deleted = true;
				del();
			};
			return recorder;
		};
		return made;
	}

	test("an adjusted layer is painted once per frame", async () => {
		const ck = await ckInit();
		const made = countRecorders(ck);
		let rects = 0;
		const drawRect = ck.Canvas.prototype.drawRect;
		ck.Canvas.prototype.drawRect = function (...args: unknown[]) {
			rects++;
			return drawRect.apply(this, args);
		};
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 80 },
			children: [
				createRect({
					pos: { x: 20, y: 10 },
					size: { width: 40, height: 30 },
					rotation: 15,
					fills: [{ kind: "solid", color: "#808080" }],
					stroke: { color: "#202020", width: 2 },
					shadow: { color: "#00000080", dx: 3, dy: 4, blur: 6 },
					adjust: buildAdjust({ gamma: 2, sharpen: 1 }),
				}),
			],
		});
		await renderSceneToPng(scene, { width: 100, height: 80, ck });
		expect(made).toHaveLength(0);
		// The fill and stroke into the offscreen, then the blit back.
		expect(rects).toBe(3);
	});

	test("content without known bounds is recorded once and released on a throw", async () => {
		const ck = await ckInit();
		const made = countRecorders(ck);
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 80 },
			children: [
				createGroup(
					[
						createRect({
							pos: { x: 10, y: 10 },
							size: { width: 40, height: 40 },
							fills: [{ kind: "solid", color: "#808080" }],
							shadow: { color: "#000000", dx: 2, dy: 2, blur: 3, inset: true },
						}),
					],
					{
						pos: { x: 10, y: 10 },
						size: { width: 40, height: 40 },
						adjust: buildAdjust({ gamma: 2 }),
					},
				),
			],
		});
		await renderSceneToPng(scene, { width: 100, height: 80, ck });
		expect(made).toEqual([{ deleted: true }]);

		const drawRect = ck.Canvas.prototype.drawRect;
		ck.Canvas.prototype.drawRect = () => {
			throw new Error("boom");
		};
		await expect(
			renderSceneToPng(scene, { width: 100, height: 80, ck }),
		).rejects.toThrow("boom");
		ck.Canvas.prototype.drawRect = drawRect;
		expect(made).toEqual([{ deleted: true }, { deleted: true }]);
	});

	test("predicted bounds hold the recorded ones", async () => {
		const ck = await ckInit();
		const pairs: { name: string; predicted: number[]; recorded: number[] }[] = [];
		let name = "";
		auditAdjustedBounds((predicted, recorded) => {
			expect(predicted, name).not.toBeNull();
			pairs.push({ name, predicted: predicted ?? [], recorded });
		});
		try {
			for (const c of BOUNDS_CASES) {
				name = c.name;
				await renderSceneToPng(c.scene, {
					width: c.width,
					height: c.height,
					scale: c.scale,
					supersample: c.supersample,
					ck,
					...(c.fonts ? { fonts: FONTS() } : {}),
				});
			}
		} finally {
			auditAdjustedBounds(undefined);
		}
		for (const kind of [
			"text",
			"text-negative-spacing",
			"text-spacing-and-leading",
			"text-shadow",
			"text-synthetic-italic",
			"large-stroke",
			"path",
			"clip-and-mask",
			"barcode",
		])
			expect(pairs.some((p) => p.name === kind)).toBe(true);
		const EPS = 1e-3;
		for (const { name, predicted: p, recorded: r } of pairs) {
			if (!(r[0] < r[2] && r[1] < r[3])) continue;
			const holds =
				p[0] <= r[0] + EPS &&
				p[1] <= r[1] + EPS &&
				p[2] >= r[2] - EPS &&
				p[3] >= r[3] - EPS;
			expect(holds, `${name}: ${p} vs ${r}`).toBe(true);
		}
	});

	test("adjusted text and paths are painted once", async () => {
		const ck = await ckInit();
		const made = countRecorders(ck);
		let paragraphs = 0;
		let paths = 0;
		const drawParagraph = ck.Canvas.prototype.drawParagraph;
		ck.Canvas.prototype.drawParagraph = function (...args: unknown[]) {
			paragraphs++;
			return drawParagraph.apply(this, args);
		};
		const drawPath = ck.Canvas.prototype.drawPath;
		ck.Canvas.prototype.drawPath = function (...args: unknown[]) {
			paths++;
			return drawPath.apply(this, args);
		};
		const scene = createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 120, height: 80 },
			children: [
				createText({
					pos: { x: 8, y: 8 },
					size: { width: 100, height: 30 },
					text: "Once",
					font: {
						family: "Geist",
						weight: 400,
						style: "normal",
						size: 20,
						lineHeight: 1.2,
					},
					color: "#101828",
					adjust: buildAdjust({ gamma: 2, sharpen: 1 }),
				}),
				createPath({
					pos: { x: 10, y: 40 },
					size: { width: 40, height: 30 },
					d: "M0 0 C 20 -10 40 40 0 30 Z",
					fills: [{ kind: "solid", color: "#808080" }],
					stroke: { color: "#202020", width: 2 },
					adjust: buildAdjust({ gamma: 2 }),
				}),
			],
		});
		try {
			await renderSceneToPng(scene, {
				width: 120,
				height: 80,
				ck,
				fonts: FONTS(),
			});
		} finally {
			ck.Canvas.prototype.drawParagraph = drawParagraph;
			ck.Canvas.prototype.drawPath = drawPath;
		}
		expect(made).toHaveLength(0);
		expect(paragraphs).toBe(1);
		// The fill and the stroke.
		expect(paths).toBe(2);
	});
});
