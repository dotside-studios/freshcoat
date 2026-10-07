// The whole loop, through the real renderer: build a chart, paint it with the
// same kit that paints cards, then read the painted pixels back with the same
// reader that reads a photograph. What comes back has to be what went in.
//
// This is the test the tool rests on. The synthetic photographs in measure.test
// prove the reader's arithmetic; this proves the two halves agree about where a
// patch actually is — an off-by-one in the layout, an antialiased patch edge, or
// a registration point that doesn't land on its mark would all pass there and
// fail here.
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { createRenderer, decodePixels } from "@freshcoat-js/engine";
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
import { profileFromPhoto } from "../src/calibrate";
import { grayCast, readChart, repeatSpread } from "../src/measure";
import type { PixelData } from "../src/types";

async function ckInit(): Promise<any> {
	return (await loadCanvasKit()) as any;
}

// Paint a chart the way the tool does: a renderer's offscreen PNG, with no print
// optimization anywhere near it, decoded back. Encoded and decoded rather than
// read as raw pixels on purpose: the point of this file is that what ships is
// what was measured.
async function paint(ck: any, spec: ChartSpec): Promise<PixelData> {
	const renderer = await createRenderer({ ck, cache: false });
	const { bytes } = await renderer.render(chartScene(spec), {
		width: spec.width,
		height: spec.height,
	});
	renderer.dispose();
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

describe("profileFromPhoto", () => {
	test("turns a photo of the printed chart into a profile", async () => {
		const ck = await ckInit();
		const spec = grayBalanceChart();
		// Exposed so the bare card is bright but not blown, as a usable photo is.
		const photo = await paint(ck, spec);
		const data = photo.data.map((v, i) => (i % 4 === 3 ? v : v * 0.9));
		const result = profileFromPhoto({ ...photo, data }, cornersOf(spec), {
			name: "Smart-51 / batch A / PVC",
		});
		if (!result.ok)
			throw new Error(
				`${result.reason} ${"assessment" in result ? result.assessment.blockers : ""}`,
			);
		expect(result.profile.name).toBe("Smart-51 / batch A / PVC");
		expect(result.profile.assessment?.usable).toBe(true);
		for (const k of Object.values(result.profile.balance ?? {}))
			expect(Math.abs(k - 1)).toBeLessThan(0.01);
		expect(result.reading.chartId).toBe(spec.id);
	}, 60_000);

	test("says when the picked corners cannot be read", () => {
		const spec = grayBalanceChart();
		const photo = {
			data: new Uint8ClampedArray(4),
			width: 1,
			height: 1,
		};
		const p = { x: 0, y: 0 };
		expect(
			profileFromPhoto(photo, [p, p, p, p], { name: "p" }, spec),
		).toEqual({ ok: false, reason: "unreadable-corners" });
	});
});
