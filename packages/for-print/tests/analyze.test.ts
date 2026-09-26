// analyzePixels / analyzeStats / buildRecommendation — pure analysis over a
// decoded RGBA buffer (percentiles from a histogram, no canvas).
import { describe, expect, test } from "vitest";
import {
	analyzePixels,
	analyzeStats,
	buildRecommendation,
	type ImageStats,
	measureGamut,
} from "../src/analyze";
import type { PixelData, PrintOptimizeOptions } from "../src/types";

// Fill a w×h buffer with one RGBA color.
function solid(
	w: number,
	h: number,
	r: number,
	g: number,
	b: number,
): PixelData {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = 255;
	}
	return { data, width: w, height: h };
}

// Half black, half white — a bimodal field where the mean misleads.
function bimodal(): PixelData {
	const w = 8;
	const h = 8;
	const data = new Uint8ClampedArray(w * h * 4);
	for (let p = 0; p < w * h; p++) {
		const v = p < (w * h) / 2 ? 0 : 255;
		data[p * 4] = v;
		data[p * 4 + 1] = v;
		data[p * 4 + 2] = v;
		data[p * 4 + 3] = 255;
	}
	return { data, width: w, height: h };
}

describe("analyzeStats", () => {
	test("percentiles beat the mean on a bimodal field", () => {
		const s = analyzeStats(bimodal());
		expect(s.meanBrightness).toBeCloseTo(127.5, 0); // mean sits in the empty middle
		expect(s.medianBrightness).toBe(0); // p50 lands on a real mode, not the gap
		expect(s.contrast).toBeCloseTo(1, 1); // p95−p5 spans the full range
	});

	test("flat gray: zero saturation, mid median, no spread", () => {
		const s = analyzeStats(solid(8, 8, 128, 128, 128));
		expect(s.avgSaturation).toBeCloseTo(0, 5);
		expect(s.medianBrightness).toBeCloseTo(128, 0);
		expect(s.contrast).toBeCloseTo(0, 2);
	});

	test("empty buffer is neutral, not NaN", () => {
		const s = analyzeStats({
			data: new Uint8ClampedArray(0),
			width: 0,
			height: 0,
		});
		expect(Number.isNaN(s.meanBrightness)).toBe(false);
		expect(s.contrast).toBe(0);
	});
});

describe("analyzePixels", () => {
	test("reports buffer dims + orientation and a recommendation", () => {
		const a = analyzePixels(solid(20, 10, 128, 128, 128));
		expect(a.imageWidth).toBe(20);
		expect(a.imageHeight).toBe(10);
		expect(a.detectedOrientation).toBe("landscape");
		expect(a.recommendation.saturation).toBeGreaterThan(0);
		expect(a.notes.length).toBeGreaterThan(0);
	});

	test("portrait buffer detected", () => {
		expect(analyzePixels(solid(10, 20, 0, 0, 0)).detectedOrientation).toBe(
			"portrait",
		);
	});
});

// A base stats object; tests override the fields they exercise.
const stats = (o: Partial<ImageStats>): ImageStats => ({
	meanBrightness: 128,
	medianBrightness: 128,
	shadow: 40,
	highlight: 210,
	avgSaturation: 0.4,
	contrast: 0.6,
	...o,
});

describe("measureGamut", () => {
	const boost = (
		o: Partial<PrintOptimizeOptions> = {},
	): PrintOptimizeOptions => ({
		saturation: 1.6,
		contrast: 1.3,
		gamma: 1,
		sharpness: 0,
		darkness: 0,
		...o,
	});

	test("a correction that stays in range costs nothing", () => {
		const flat = {
			saturation: 1,
			contrast: 1,
			gamma: 0.9,
			sharpness: 0,
			darkness: 0,
		};
		expect(measureGamut(solid(4, 4, 0x6d, 0x4f, 0xd1), flat)).toEqual({
			clipped: 0,
			pullback: 0,
		});
		// A mid gray has room in every direction, so even a strong boost fits.
		expect(measureGamut(solid(4, 4, 128, 128, 128), boost()).clipped).toBe(0);
	});

	test("a saturated violet under a boost reports the whole field and a real pullback", () => {
		const { clipped, pullback } = measureGamut(
			solid(4, 4, 0x6d, 0x4f, 0xd1),
			boost(),
		);
		expect(clipped).toBe(1);
		// Blue is driven well past full scale, so a substantial share of the chroma
		// has to come back for it to fit.
		expect(pullback).toBeGreaterThan(0.2);
		expect(pullback).toBeLessThan(1);
	});

	test("only the pixels that leave the range count toward the share", () => {
		// Half saturated violet, half mid gray: the violet clips, the gray doesn't.
		const w = 4;
		const h = 2;
		const data = new Uint8ClampedArray(w * h * 4);
		for (let p = 0; p < w * h; p++) {
			const violet = p < (w * h) / 2;
			data[p * 4] = violet ? 0x6d : 128;
			data[p * 4 + 1] = violet ? 0x4f : 128;
			data[p * 4 + 2] = violet ? 0xd1 : 128;
			data[p * 4 + 3] = 255;
		}
		expect(measureGamut({ data, width: w, height: h }, boost()).clipped).toBe(
			0.5,
		);
	});
});

describe("buildRecommendation", () => {
	test("bright + desaturated + wide spread → strong boosts, darkening", () => {
		const { recommendation } = buildRecommendation(
			stats({
				medianBrightness: 210,
				shadow: 20,
				highlight: 250,
				avgSaturation: 0.15,
			}),
		);
		expect(recommendation.saturation).toBeGreaterThan(1.3);
		expect(recommendation.darkness).toBeGreaterThan(0);
		expect(recommendation.gamma).toBeLessThan(1);
	});

	test("pastel path (bright, desaturated, LOW spread) stays gentle", () => {
		const { recommendation, notes } = buildRecommendation(
			stats({
				medianBrightness: 200,
				shadow: 170,
				highlight: 240,
				avgSaturation: 0.2,
				contrast: 0.27,
			}),
		);
		expect(recommendation.saturation).toBeLessThanOrEqual(1.2);
		expect(notes.some((n) => n.toLowerCase().includes("pastel"))).toBe(true);
	});

	test("dark image gets minimal adjustment", () => {
		const { recommendation } = buildRecommendation(
			stats({ medianBrightness: 40, shadow: 5, highlight: 120 }),
		);
		expect(recommendation.darkness).toBe(0);
		expect(recommendation.gamma).toBeGreaterThanOrEqual(0.95);
	});

	test("highlight guard: near-clipping highlights add darkening even at a moderate median", () => {
		const { recommendation, notes } = buildRecommendation(
			stats({ medianBrightness: 100, shadow: 40, highlight: 252 }),
		);
		// base darkness for mid=100 is 0.1; the guard bumps it to 0.15.
		expect(recommendation.darkness).toBe(0.15);
		expect(notes.some((n) => n.toLowerCase().includes("clipping"))).toBe(true);
	});

	test("shadow guard: crushed blacks ease off darkening", () => {
		const { recommendation, notes } = buildRecommendation(
			stats({
				medianBrightness: 180,
				shadow: 5,
				highlight: 255,
				avgSaturation: 0.4,
			}),
		);
		// base darkness for mid=180 is 0.2; crushed shadows (p5<12) ease it to 0.1.
		expect(recommendation.darkness).toBe(0.1);
		expect(notes.some((n) => n.toLowerCase().includes("dense"))).toBe(true);
	});

	test("low tonal spread → strong contrast boost", () => {
		const { recommendation } = buildRecommendation(stats({ contrast: 0.25 }));
		expect(recommendation.contrast).toBe(1.3);
	});

	test("saturated brand art takes neither the saturation nor the spread boost", () => {
		// An indigo→violet card ground: dense color inside a narrow luma band.
		const { recommendation, notes } = buildRecommendation(
			stats({
				medianBrightness: 98,
				shadow: 85,
				highlight: 112,
				avgSaturation: 0.82,
				contrast: 0.11,
			}),
		);
		expect(recommendation.saturation).toBe(1);
		expect(recommendation.contrast).toBe(1.05);
		expect(notes.some((n) => n.toLowerCase().includes("brand art"))).toBe(true);
	});

	test("a washed-out photo at the same spread still gets the strong boosts", () => {
		// Same narrow spread, but desaturated — the guard keys on both, so this one
		// keeps the correction it needs.
		const { recommendation } = buildRecommendation(
			stats({ avgSaturation: 0.25, contrast: 0.11 }),
		);
		expect(recommendation.contrast).toBe(1.3);
		expect(recommendation.saturation).toBeGreaterThan(1.3);
	});
});
