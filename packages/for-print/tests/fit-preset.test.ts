// Fitting a target preset from simulated printers whose behaviour is known, then
// running the preset through printAdjust to see the print come back.
import { describe, expect, test } from "vitest";
import {
	type ChartSpec,
	chromaRampChart,
	grayBalanceChart,
	hueSweepChart,
	type RGB,
	toneWedgeChart,
} from "../src/chart";
import { fitTargetPreset } from "../src/fit-preset";
import type { ChartReading } from "../src/measure";
import { printAdjust } from "../src/plan";

type Printer = (sent: RGB) => RGB;

const readingFrom = (
	spec: ChartSpec,
	printer: Printer,
	extra: Partial<ChartReading> = {},
): ChartReading => ({
	chartId: spec.id,
	patches: spec.patches
		.filter((p) => p.role !== "fiducial")
		.map((p) => {
			const measured =
				p.role === "stock" ? ([255, 255, 255] as RGB) : printer(p.rgb);
			return {
				id: p.id,
				role: p.role,
				sent: p.rgb,
				raw: measured,
				measured,
				...(p.repeatOf ? { repeatOf: p.repeatOf } : {}),
			};
		}),
	stock: [250, 250, 250],
	stockClipped: false,
	lightSpread: 0,
	missed: [],
	...extra,
});

// Deterministic noise in levels, so a failure reproduces.
const noisy = (printer: Printer, amplitude: number): Printer => {
	let seed = 12345;
	const rand = () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return (seed / 4294967296) * 2 - 1;
	};
	return (sent) =>
		printer(sent).map((v) =>
			Math.min(255, Math.max(0, v + rand() * amplitude)),
		) as RGB;
};

const power =
	(k: number): Printer =>
	(sent) =>
		sent.map((v) => 255 * (v / 255) ** k) as RGB;

const LUMA = [0.2126, 0.7152, 0.0722];
const chromaOf = (rgb: RGB) => Math.max(...rgb) - Math.min(...rgb);

// Chroma scaled by `keep` about luma, but never past `ceiling` (in levels).
const fadedPrinter =
	(keep: number, ceiling = Number.POSITIVE_INFINITY): Printer =>
	(sent) => {
		const luma = sent[0] * LUMA[0] + sent[1] * LUMA[1] + sent[2] * LUMA[2];
		const chroma = chromaOf(sent);
		const scale = chroma > 0 ? Math.min(keep, ceiling / chroma) : 1;
		return sent.map((v) => luma + (v - luma) * scale) as RGB;
	};

// Run a pixel through the preset the way the planner renders it (matrix, then
// the tone LUT), then through the printer.
function printed(
	preset: Parameters<typeof printAdjust>[0],
	printer: Printer,
	rgb: RGB,
): RGB {
	const adjust = printAdjust(preset);
	let v = rgb.map((c) => c / 255);
	const m = adjust.colorMatrix;
	if (m) {
		v = [0, 1, 2].map((r) =>
			Math.min(
				1,
				Math.max(
					0,
					m[r * 5] * v[0] +
						m[r * 5 + 1] * v[1] +
						m[r * 5 + 2] * v[2] +
						m[r * 5 + 4],
				),
			),
		);
	}
	const lut = adjust.lut?.r;
	const sent = v.map((c) =>
		lut ? lut[Math.round(c * 255)] : Math.round(c * 255),
	) as RGB;
	return printer(sent);
}

const unwrap = <T extends { ok: boolean }>(r: T) => {
	expect(r.ok).toBe(true);
	return r as Extract<T, { ok: true }>;
};

describe("tone", () => {
	test.each([
		["a dark printer", 1.4],
		["a light printer", 0.75],
	])("%s: the preset brings sent grays back", (_, k) => {
		const printer = power(k);
		const fit = unwrap(
			fitTargetPreset({ tone: readingFrom(toneWedgeChart(), printer) }),
		);
		expect(fit.fitted).toEqual(["gamma"]);
		expect(fit.preset.gamma).toBeCloseTo(1 / k, 1);
		for (let v = 32; v <= 224; v += 32) {
			const got = printed(fit.preset, printer, [v, v, v]);
			for (const c of got) expect(Math.abs(c - v)).toBeLessThan(4);
		}
		expect(fit.tone?.after).toBeLessThan((fit.tone?.before ?? 0) / 4);
	});

	test("the direction: a dark printer gets gamma below 1, a light one above 1", () => {
		const dark = unwrap(
			fitTargetPreset({ tone: readingFrom(toneWedgeChart(), power(1.5)) }),
		);
		const light = unwrap(
			fitTargetPreset({ tone: readingFrom(toneWedgeChart(), power(0.7)) }),
		);
		expect(dark.preset.gamma).toBeLessThan(1);
		expect(light.preset.gamma).toBeGreaterThan(1);
		const mid = printAdjust(dark.preset).lut?.r[128] ?? 0;
		expect(mid).toBeGreaterThan(128);
	});

	test("a gray ramp works as well as a wedge", () => {
		const printer = power(1.3);
		const fit = unwrap(
			fitTargetPreset({ tone: readingFrom(grayBalanceChart(16), printer) }),
		);
		expect(fit.preset.gamma).toBeCloseTo(1 / 1.3, 1);
	});

	test("shadows lighter than a power law get darkness", () => {
		const correction = { ...printAdjustless(), gamma: 0.9, darkness: 0.3 };
		const lut = printAdjust(correction).lut?.r;
		if (!lut) throw new Error("expected a lut");
		// The printer is the inverse of that correction, so the true answer is known.
		const printer: Printer = (sent) =>
			sent.map((v) => {
				let best = 0;
				for (let i = 0; i < 256; i++)
					if (Math.abs(lut[i] - v) < Math.abs(lut[best] - v)) best = i;
				return best;
			}) as RGB;
		const fit = unwrap(
			fitTargetPreset({ tone: readingFrom(toneWedgeChart(17), printer) }),
		);
		expect(fit.fitted).toContain("darkness");
		expect(fit.preset.darkness).toBeGreaterThan(0.1);
		expect(fit.tone?.after).toBeLessThan(2);
	});

	test("a printer that cannot reach black is not given a contrast boost", () => {
		const printer: Printer = (sent) =>
			sent.map((v) => 40 + (v / 255) * 215) as RGB;
		const fit = unwrap(
			fitTargetPreset({ tone: readingFrom(toneWedgeChart(), printer) }),
		);
		expect(fit.preset.contrast).toBe(1);
		expect(fit.notes.join(" ")).toMatch(/black is out of reach/);
	});

	test("a neutral printer gives a near-identity preset", () => {
		const fit = unwrap(
			fitTargetPreset({
				tone: readingFrom(toneWedgeChart(), power(1)),
				chroma: readingFrom(chromaRampChart(), fadedPrinter(1)),
			}),
		);
		expect(fit.preset).toEqual({
			saturation: 1,
			contrast: 1,
			sharpness: 0,
			gamma: 1,
			darkness: 0,
		});
	});

	test("noisy readings still land close", () => {
		const printer = power(1.35);
		const fit = unwrap(
			fitTargetPreset({
				tone: readingFrom(toneWedgeChart(), noisy(printer, 3)),
			}),
		);
		expect(fit.preset.gamma).toBeGreaterThan(0.68);
		expect(fit.preset.gamma).toBeLessThan(0.8);
	});
});

function printAdjustless() {
	return { saturation: 1, contrast: 1, sharpness: 0, gamma: 1, darkness: 0 };
}

describe("chroma", () => {
	test("restores the chroma the printer drops below its gamut edge", () => {
		const printer = fadedPrinter(0.75, 150);
		const fit = unwrap(
			fitTargetPreset({ chroma: readingFrom(chromaRampChart(), printer) }),
		);
		expect(fit.fitted).toEqual(["saturation"]);
		expect(fit.retainedChroma).toBeCloseTo(0.75, 2);
		expect(fit.preset.saturation).toBeCloseTo(1 / 0.75, 1);
		// Below the edge (sent chroma 100 -> 75 kept) the print returns to what was sent.
		const sent: RGB = [180, 100, 80];
		const got = printed(fit.preset, printer, sent);
		for (let c = 0; c < 3; c++)
			expect(Math.abs(got[c] - sent[c])).toBeLessThan(4);
	});

	test("patches at and past the gamut edge do not drag the fit", () => {
		const ceilinged = unwrap(
			fitTargetPreset({
				chroma: readingFrom(chromaRampChart(), fadedPrinter(0.8, 90)),
			}),
		);
		const open = unwrap(
			fitTargetPreset({
				chroma: readingFrom(chromaRampChart(), fadedPrinter(0.8)),
			}),
		);
		expect(ceilinged.preset.saturation).toBeCloseTo(open.preset.saturation, 2);
	});

	test("a hue sweep gives a fit, with a note that it is weaker", () => {
		const fit = unwrap(
			fitTargetPreset({
				chroma: readingFrom(hueSweepChart(), fadedPrinter(0.8)),
			}),
		);
		expect(fit.preset.saturation).toBeCloseTo(1.25, 1);
		expect(fit.notes.join(" ")).toMatch(/hue sweep/);
	});

	test("noisy readings still land close", () => {
		const fit = unwrap(
			fitTargetPreset({
				chroma: readingFrom(
					chromaRampChart(),
					noisy(fadedPrinter(0.8, 170), 2),
				),
			}),
		);
		expect(fit.preset.saturation).toBeGreaterThan(1.18);
		expect(fit.preset.saturation).toBeLessThan(1.32);
	});

	test("saturation is clamped to a sane range, and the note says so", () => {
		const fit = unwrap(
			fitTargetPreset({
				chroma: readingFrom(chromaRampChart(), fadedPrinter(0.4)),
			}),
		);
		expect(fit.preset.saturation).toBe(1.6);
		expect(fit.notes.join(" ")).toMatch(/clamped/);
	});

	test("tone is undone before chroma is read", () => {
		const tone = power(1.4);
		const fade = fadedPrinter(0.8);
		const printer: Printer = (sent) => tone(fade(sent));
		const fit = unwrap(
			fitTargetPreset({
				tone: readingFrom(toneWedgeChart(), tone),
				chroma: readingFrom(chromaRampChart(), printer),
			}),
		);
		expect(fit.fitted).toEqual(["gamma", "saturation"]);
		expect(fit.preset.saturation).toBeCloseTo(1.25, 1);
	});
});

describe("what is left alone", () => {
	test("a missing chart leaves its knobs at the defaults", () => {
		const toneOnly = unwrap(
			fitTargetPreset(
				{ tone: readingFrom(toneWedgeChart(), power(1.4)) },
				{ defaults: { saturation: 1.1, sharpness: 0.3 } },
			),
		);
		expect(toneOnly.fitted).not.toContain("saturation");
		expect(toneOnly.preset.saturation).toBe(1.1);
		expect(toneOnly.preset.sharpness).toBe(0.3);

		const chromaOnly = unwrap(
			fitTargetPreset({
				chroma: readingFrom(chromaRampChart(), fadedPrinter(0.8)),
			}),
		);
		expect(chromaOnly.fitted).toEqual(["saturation"]);
		expect(chromaOnly.preset.gamma).toBe(1);
		expect(chromaOnly.notes.join(" ")).toMatch(/No tone chart/);
	});

	test("sharpness and contrast are never fitted, and the notes say so", () => {
		const fit = unwrap(
			fitTargetPreset({ tone: readingFrom(toneWedgeChart(), power(1.4)) }),
		);
		expect(fit.fitted).not.toContain("sharpness" as never);
		expect(fit.preset.sharpness).toBe(0);
		expect(fit.notes.join(" ")).toMatch(/Sharpness cannot be measured/);
		expect(fit.notes.join(" ")).toMatch(/Contrast is not measured/);
	});
});

describe("refusals", () => {
	test("no charts", () => {
		expect(fitTargetPreset({})).toMatchObject({
			ok: false,
			reason: "no-charts",
		});
	});

	test("an unsafe reading is refused, not fitted around", () => {
		const bad = readingFrom(toneWedgeChart(), power(1.4), {
			stockClipped: true,
		});
		expect(fitTargetPreset({ tone: bad })).toMatchObject({
			ok: false,
			reason: "unsafe-reading",
		});
		const uneven = readingFrom(chromaRampChart(), fadedPrinter(0.8), {
			missed: ["chroma-250-3"],
		});
		expect(fitTargetPreset({ chroma: uneven })).toMatchObject({
			ok: false,
			reason: "unsafe-reading",
		});
	});

	test("a reading with too little in it is refused", () => {
		const reading = readingFrom(toneWedgeChart(), power(1.4));
		const thin = {
			...reading,
			patches: reading.patches.filter((p) => p.id === "r-0" || p.id === "r-1"),
		};
		expect(fitTargetPreset({ tone: thin })).toMatchObject({
			ok: false,
			reason: "not-enough-data",
		});
		const flat = readingFrom(toneWedgeChart(), () => [128, 128, 128]);
		expect(fitTargetPreset({ tone: flat })).toMatchObject({
			ok: false,
			reason: "implausible-response",
		});
	});

	test("chroma with nothing below the gamut edge is refused", () => {
		const grayed = readingFrom(chromaRampChart(), fadedPrinter(0));
		expect(fitTargetPreset({ chroma: grayed })).toMatchObject({ ok: false });
	});

	test("allowUnsafe lets diagnostics through", () => {
		const bad = readingFrom(toneWedgeChart(), power(1.4), {
			stockClipped: true,
		});
		expect(fitTargetPreset({ tone: bad }, { allowUnsafe: true }).ok).toBe(true);
	});
});
