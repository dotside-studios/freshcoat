// The adjust offscreen covers only the layer's device rect. Each scene here was
// rendered with the earlier full-frame offscreen and committed as a golden; the
// bounded offscreen must reproduce it. Undithered gradients may move by a level
// or two under the offscreen's whole-pixel shift, as Skia evaluates them in
// lower precision.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, test } from "vitest";
import { buildAdjust } from "../src/adjust";
import { decodePixels } from "../src/decode";
import { renderSceneToPng } from "../src/headless";
import { createFrame, createRect } from "../src/node";
import { BOUNDS_CASES } from "./fixtures/adjust-bounds/scenes";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CK_BIN = join(HERE, "..", "node_modules", "canvaskit-wasm", "bin");
const GOLDENS = join(HERE, "fixtures", "adjust-bounds");
const TOLERANCE = 2;

async function ckInit(): Promise<any> {
	return (await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	})) as unknown;
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
});
