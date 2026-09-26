// The whole loop, through the real renderer: build a chart, paint it with the
// same kit that paints cards, then read the painted pixels back with the same
// reader that reads a photograph. What comes back has to be what went in.
//
// This is the test the tool rests on. The synthetic photographs in measure.test
// prove the reader's arithmetic; this proves the two halves agree about where a
// patch actually is — an off-by-one in the layout, an antialiased patch edge, or
// a registration point that doesn't land on its mark would all pass there and
// fail here.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { decodePixels } from "freshcoat";
import { renderSceneToPng } from "freshcoat/headless";
import { describe, expect, test } from "vitest";
import {
	type ChartSpec,
	chartScene,
	chromaRampChart,
	grayBalanceChart,
	hueSweepChart,
	latticeCharts,
	type Point,
	toneWedgeChart,
} from "../src/chart";
import { grayCast, readChart, repeatSpread } from "../src/measure";
import type { PixelData } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);

async function ckInit(): Promise<any> {
	return (await (CanvasKitInit as any)({
		locateFile: (f: string) => join(CK_BIN, f),
	})) as any;
}

// Paint a chart through the SAME call the tool makes — renderSceneToPng, headless,
// no print optimization anywhere near it. Same function rather than an equivalent
// one on purpose: the point of this file is that what ships is what was measured.
async function paint(ck: any, spec: ChartSpec): Promise<PixelData> {
	const { bytes } = await renderSceneToPng(chartScene(spec), {
		width: spec.width,
		height: spec.height,
		ck,
	});
	const pixels = decodePixels(ck, bytes);
	if (!pixels) throw new Error("could not decode the painted chart");
	return pixels;
}

const cornersOf = (spec: ChartSpec): [Point, Point, Point, Point] =>
	spec.registration as [Point, Point, Point, Point];

describe("chart → paint → read", () => {
	test("every diagnostic chart reads back the colors it was built from", async () => {
		const ck = await ckInit();
		for (const spec of [
			grayBalanceChart(),
			toneWedgeChart(),
			hueSweepChart(),
			chromaRampChart(),
		]) {
			const reading = readChart(await paint(ck, spec), spec, cornersOf(spec));
			if (!reading) throw new Error(`no reading for ${spec.id}`);

			expect(reading.missed, `${spec.id} missed patches`).toEqual([]);
			// The rendered chart's bare stock is literally 255 — pure white is what
			// "print no dye" means in the file. So the exposure flag fires here by
			// construction, and it is about photographs, not renders: in a photo the
			// same reading means the card blew out and the reference is gone.
			expect(reading.stockClipped, `${spec.id} stock`).toBe(true);
			expect(reading.stock, `${spec.id} stock value`).toEqual([255, 255, 255]);
			for (const p of reading.patches) {
				for (let c = 0; c < 3; c++) {
					expect(
						Math.abs(p.measured[c] - p.sent[c]),
						`${spec.id} ${p.id} channel ${c}: sent ${p.sent[c]}, read ${p.measured[c].toFixed(1)}`,
					).toBeLessThanOrEqual(1);
				}
			}
		}
	}, 60_000);

	test("a lattice card reads back too — including the cube's corners", async () => {
		const ck = await ckInit();
		const [first] = latticeCharts(5);
		const reading = readChart(await paint(ck, first), first, cornersOf(first));
		if (!reading) throw new Error("no reading");
		expect(reading.missed).toEqual([]);
		for (const p of reading.patches) {
			for (let c = 0; c < 3; c++) {
				expect(Math.abs(p.measured[c] - p.sent[c])).toBeLessThanOrEqual(1);
			}
		}
		// Black is on this card and has to survive the round trip; it is the one
		// patch where a sampling error would read as a real measurement.
		const black = reading.patches.find((p) => p.sent.every((v) => v === 0));
		expect(black).toBeDefined();
		expect(Math.max(...(black?.measured ?? [99]))).toBeLessThanOrEqual(1);
	}, 60_000);

	test("a chart with nothing wrong reports nothing wrong", async () => {
		const ck = await ckInit();
		const spec = grayBalanceChart();
		const reading = readChart(await paint(ck, spec), spec, cornersOf(spec));
		if (!reading) throw new Error("no reading");
		// The rendered chart is a perfect printer: no cast, perfectly even. If the
		// baseline read as anything else, every real reading would be measured
		// against a bias the tool invented.
		for (const c of grayCast(reading)) expect(Math.abs(c)).toBeLessThan(1);
		expect(repeatSpread(reading)).toBeLessThanOrEqual(1);
	}, 60_000);
});
