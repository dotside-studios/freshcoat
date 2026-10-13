// Turning printed tone and chroma charts into a starting preset for a target.
//
// The charts say what the printer DID to what it was sent; a preset is the
// pre-correction that undoes it. So the fit is a small inverse problem per knob,
// solved against the same math the render uses: the tone knobs are searched
// through the planner's own tone LUT, and chroma is the factor `correctionMatrix`
// scales it back by. Whatever the charts cannot see (sharpness, and a contrast
// that no ribbon needs because black is out of reach) stays where it was put.
//
// The result is a preset for a printer, ribbon and stock, the thing a
// `PrintTarget` carries. It is not a per-image correction and not the cast
// balance of ./balance, which is measured separately and applies to the frame.

import { assessCalibration, type CalibrationBlocker } from "./assess";
import type { ChartReading, PatchReading } from "./measure";
import { buildToneLut } from "./plan";
import type { PrintOptimizeOptions } from "./types";

export type FitTargetPresetOptions = {
	// Values for the knobs the charts do not decide. Anything missing is neutral
	// (saturation, contrast and gamma 1; sharpness and darkness 0).
	defaults?: Partial<PrintOptimizeOptions>;
	// Unsafe readings are refused unless this is set, as in fitChannelBalance.
	allowUnsafe?: boolean;
};

export type FitTargetPresetReading = {
	// A tone wedge or a gray ramp: how sent levels come back.
	tone?: ChartReading;
	// A chroma ramp (preferred) or a hue sweep: how much saturation survives.
	chroma?: ChartReading;
};

export type FittedKnob = "saturation" | "gamma" | "darkness";

export type FitTargetPresetFailure =
	| "no-charts"
	| "unsafe-reading"
	| "not-enough-data"
	| "implausible-response";

export type FitTargetPresetResult =
	| {
			ok: true;
			preset: PrintOptimizeOptions;
			fitted: FittedKnob[];
			notes: string[];
			// Mean absolute tone error in levels (0-255) before and after the preset.
			tone?: { before: number; after: number };
			// Share of sent chroma the printer keeps below its gamut edge.
			retainedChroma?: number;
	  }
	| { ok: false; reason: FitTargetPresetFailure; message: string };

const NEUTRAL: PrintOptimizeOptions = {
	saturation: 1,
	contrast: 1,
	sharpness: 0,
	gamma: 1,
	darkness: 0,
};

const GAMMA_RANGE: [number, number] = [0.5, 2];
const SATURATION_RANGE: [number, number] = [0.7, 1.6];
const DARKNESS_MAX = 0.5;
// A knob this close to neutral is inside what the chart can resolve.
const SNAP = 0.01;
// Darkness is kept only when it clearly beats gamma alone: it moves the shadows
// and little else, so a small gain is a noisy floor, not a shadow problem.
const DARKNESS_MIN_GAIN = 1.5;
const DARKNESS_MIN_SHARE = 0.3;
// Chroma below this is not measured: a level or two of noise is a large share of
// it, and the ratio it gives is mostly camera.
const MIN_SENT_CHROMA = 0.15;
// A step that keeps less than this share of the ramp's early ratio is past the
// gamut edge.
const EDGE_RATIO = 0.93;

type Failure = Extract<FitTargetPresetResult, { ok: false }>;
const fail = (reason: FitTargetPresetFailure, message: string): Failure => ({
	ok: false,
	reason,
	message,
});

const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const quantile = (xs: number[], q: number): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const round = (v: number, places = 3) => {
	const f = 10 ** places;
	return Math.round(v * f) / f;
};

const clamp = (v: number, [lo, hi]: [number, number]) =>
	Math.min(hi, Math.max(lo, v));

// Chart-quality blockers that apply here. A tone wedge or chroma ramp has no
// gray steps to count, so that blocker is the gray chart's alone.
function blockersOf(reading: ChartReading): CalibrationBlocker[] {
	return assessCalibration(reading).blockers.filter(
		(b) => b !== "not-enough-gray-steps",
	);
}

const measurePatches = (reading: ChartReading): PatchReading[] =>
	reading.patches.filter((p) => p.role === "measure");

type ToneCurve = { levels: number[]; values: number[] };

// What the printer returned for each level sent, one value per level. Every
// channel that was sent that level contributes, so a gray ramp gives three
// readings per step and a primary's wedge gives its own. The other channels of a
// wedge patch were sent 0 and only measure leakage, so they are left out.
function toneCurve(reading: ChartReading): ToneCurve | null {
	const byLevel = new Map<number, number[]>();
	for (const p of measurePatches(reading)) {
		const sent = p.sent.filter((v) => v > 0);
		const level = sent.length ? sent[0] : 0;
		if (sent.some((v) => v !== level)) continue;
		for (let c = 0; c < 3; c++) {
			if (level > 0 && p.sent[c] !== level) continue;
			byLevel.set(level, [...(byLevel.get(level) ?? []), p.measured[c]]);
		}
	}
	const levels = [...byLevel.keys()].sort((a, b) => a - b);
	if (levels.length < 4) return null;
	return { levels, values: levels.map((l) => median(byLevel.get(l) ?? [])) };
}

function interpolate(xs: number[], ys: number[], x: number): number {
	if (x <= xs[0]) return ys[0];
	for (let i = 1; i < xs.length; i++) {
		if (x <= xs[i]) {
			const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
			return ys[i - 1] + t * (ys[i] - ys[i - 1]);
		}
	}
	return ys[ys.length - 1];
}

type ToneKnobs = { gamma: number; darkness: number };

// The printer's own floor: what it returns for black, when black was sent.
const floorOf = (curve: ToneCurve) => (curve.levels[0] <= 8 ? curve.values[0] : 0);

// The mean distance, in levels, between what the printer would return for a
// level run through this correction and what it can actually make of that level.
// The target is the sent level, except below the printer's floor: a printer that
// cannot reach black returns its floor for any dark level, and asking the
// correction to beat that is asking for density the ribbon does not have.
function toneError(curve: ToneCurve, knobs: ToneKnobs): number {
	const lut =
		knobs.gamma !== 1 || knobs.darkness > 0
			? buildToneLut(knobs.gamma, knobs.darkness, 1)
			: undefined;
	const floor = floorOf(curve);
	let sum = 0;
	for (const level of curve.levels) {
		const sent = lut ? lut[level] : level;
		const got = interpolate(curve.levels, curve.values, sent);
		sum += Math.abs(got - Math.max(level, floor));
	}
	return sum / curve.levels.length;
}

// Coarse-to-fine search over gamma for one darkness. The grid is geometric
// because gamma acts as an exponent.
function bestGamma(curve: ToneCurve, darkness: number) {
	const search = (lo: number, hi: number, n: number) => {
		let best = { gamma: 1, error: Number.POSITIVE_INFINITY };
		for (let i = 0; i < n; i++) {
			const gamma = round(lo * (hi / lo) ** (i / (n - 1)));
			const error = toneError(curve, { gamma, darkness });
			if (error < best.error) best = { gamma, error };
		}
		return best;
	};
	const coarse = search(GAMMA_RANGE[0], GAMMA_RANGE[1], 61);
	return search(coarse.gamma / 1.03, coarse.gamma * 1.03, 31);
}

type ToneFit = ToneKnobs & { before: number; after: number; floor: number };

function fitTone(curve: ToneCurve): ToneFit | Failure {
	if (curve.values[curve.values.length - 1] - curve.values[0] < 40) {
		return fail(
			"implausible-response",
			"The tone chart barely changes from its first level to its last; it was probably not read correctly.",
		);
	}
	const plain = bestGamma(curve, 0);
	let best = { ...plain, darkness: 0 };
	for (let d = 0.05; d <= DARKNESS_MAX + 1e-9; d += 0.05) {
		const darkness = round(d, 2);
		const candidate = bestGamma(curve, darkness);
		if (candidate.error < best.error) best = { ...candidate, darkness };
	}
	const gain = plain.error - best.error;
	if (gain < DARKNESS_MIN_GAIN || gain < plain.error * DARKNESS_MIN_SHARE) {
		best = { ...plain, darkness: 0 };
	}
	return {
		gamma: best.gamma,
		darkness: best.darkness,
		before: toneError(curve, { gamma: 1, darkness: 0 }),
		after: best.error,
		floor: floorOf(curve),
	};
}

const chromaOf = (rgb: [number, number, number]) =>
	(Math.max(...rgb) - Math.min(...rgb)) / 255;

type ChromaPoint = { sent: number; got: number };

// Chroma patches grouped into one series per hue, by the chart's own ids:
// `chroma-250-3` is the 4th step of the 250 degree ramp.
function chromaSeries(reading: ChartReading) {
	const series = new Map<string, ChromaPoint[]>();
	for (const p of measurePatches(reading)) {
		const sent = chromaOf(p.sent);
		if (sent <= 0) continue;
		const key = p.id.replace(/-\d+$/, "");
		series.set(key, [
			...(series.get(key) ?? []),
			{ sent, got: chromaOf(p.measured) },
		]);
	}
	for (const points of series.values()) points.sort((a, b) => a.sent - b.sent);
	return series;
}

// One ramp's retained chroma: chroma out over chroma in, across the steps before
// it stops following its early trend. Null when too few steps remain.
function rampRetention(points: ChromaPoint[]): number | null {
	const usable = points.filter((p) => p.sent >= MIN_SENT_CHROMA);
	if (usable.length < 3) return null;
	const early = median(usable.slice(0, 3).map((p) => p.got / p.sent));
	const before: number[] = [];
	for (const p of usable) {
		if (p.got / p.sent < early * EDGE_RATIO) break;
		before.push(p.got / p.sent);
	}
	return before.length >= 2 ? median(before) : null;
}

type ChromaFit = { retained: number; hues: number; fromRamps: boolean };

function fitChroma(
	reading: ChartReading,
	curve: ToneCurve | null,
): ChromaFit | null {
	// Undo the tone response first, so a ramp that lost chroma to the printer's
	// curve is not read as one that lost it to the ribbon.
	let source = reading;
	if (curve) {
		const rising = curve.values.map(
			(_, i) => Math.max(...curve.values.slice(0, i + 1)) + i * 1e-6,
		);
		const linear = (v: number) => interpolate(rising, curve.levels, v);
		source = {
			...reading,
			patches: reading.patches.map((p) => ({
				...p,
				measured: p.measured.map(linear) as [number, number, number],
			})),
		};
	}
	const series = chromaSeries(source);
	if (reading.chartId === "chroma-ramp") {
		const ratios = [...series.values()]
			.map(rampRetention)
			.filter((r): r is number => r !== null);
		if (ratios.length < 2) return null;
		return { retained: median(ratios), hues: ratios.length, fromRamps: true };
	}
	// A sweep has one saturation per hue, so its gamut edge cannot be seen. Hues
	// the ribbon cannot reach only pull ratios down, so the upper quartile stands
	// for the hues it can.
	const ratios = [...series.values()]
		.flat()
		.filter((p) => p.sent >= MIN_SENT_CHROMA)
		.map((p) => p.got / p.sent);
	if (ratios.length < 6) return null;
	return {
		retained: quantile(ratios, 0.75),
		hues: series.size,
		fromRamps: false,
	};
}

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function fitTargetPreset(
	readings: FitTargetPresetReading,
	options: FitTargetPresetOptions = {},
): FitTargetPresetResult {
	const { tone, chroma } = readings;
	if (!tone && !chroma) {
		return fail("no-charts", "Give a tone chart, a chroma chart, or both.");
	}
	if (!options.allowUnsafe) {
		for (const [name, reading] of [
			["tone", tone],
			["chroma", chroma],
		] as const) {
			const blockers = reading ? blockersOf(reading) : [];
			if (blockers.length) {
				return fail(
					"unsafe-reading",
					`The ${name} reading is not safe to fit (${blockers.join(", ")}).`,
				);
			}
		}
	}

	const preset: PrintOptimizeOptions = { ...NEUTRAL, ...options.defaults };
	const fitted: FittedKnob[] = [];
	const notes: string[] = [];
	const summary: { tone?: { before: number; after: number }; retainedChroma?: number } = {};
	let curve: ToneCurve | null = null;

	if (tone) {
		curve = toneCurve(tone);
		if (!curve) {
			return fail(
				"not-enough-data",
				"The tone reading has fewer than four distinct levels.",
			);
		}
		const fit = fitTone(curve);
		if ("ok" in fit) return fit;
		preset.gamma = Math.abs(fit.gamma - 1) < SNAP ? 1 : fit.gamma;
		preset.darkness = fit.darkness;
		fitted.push("gamma");
		if (fit.darkness > 0) fitted.push("darkness");
		summary.tone = { before: round(fit.before, 2), after: round(fit.after, 2) };
		const direction =
			preset.gamma < 1
				? "lightens the printer's too-dark tones"
				: preset.gamma > 1
					? "darkens the printer's too-light tones"
					: "leaves the tones as sent";
		notes.push(
			`Tone: ${curve.levels.length} levels read. Gamma ${preset.gamma} ${direction}, cutting the mean error from ${summary.tone.before} to ${summary.tone.after} levels.`,
		);
		if (fit.gamma <= GAMMA_RANGE[0] * 1.03 || fit.gamma >= GAMMA_RANGE[1] / 1.03) {
			notes.push(
				"Gamma ended at the edge of its range, so the printer's curve is unusual; check the chart.",
			);
		}
		notes.push(
			fit.darkness > 0
				? `Darkness ${fit.darkness}: the shadows came back lighter than gamma alone accounts for.`
				: "Darkness left at 0: gamma accounts for the shadows.",
		);
		if (fit.floor > 8) {
			notes.push(
				`The darkest level reads ${Math.round(fit.floor)}, so black is out of reach. Contrast is not raised for it: that cannot add density the ribbon lacks.`,
			);
		}
	} else {
		notes.push("No tone chart: gamma and darkness left at their defaults.");
	}

	if (chroma) {
		const fit = fitChroma(chroma, curve);
		if (!fit) {
			return fail(
				"not-enough-data",
				"The chroma reading has too few usable steps below the gamut edge.",
			);
		}
		if (fit.retained < 0.3 || fit.retained > 3) {
			return fail(
				"implausible-response",
				`The printer appears to keep ${percent(fit.retained)} of the chroma sent, which is not believable; check the capture.`,
			);
		}
		const wanted = 1 / fit.retained;
		const saturation = Math.abs(wanted - 1) < SNAP ? 1 : clamp(wanted, SATURATION_RANGE);
		preset.saturation = round(saturation);
		fitted.push("saturation");
		summary.retainedChroma = round(fit.retained);
		notes.push(
			fit.fromRamps
				? `Chroma: ${fit.hues} hue ramps. The printer keeps ${percent(fit.retained)} of the chroma sent below each hue's gamut edge, so saturation ${preset.saturation} restores it. Steps at and past the edge were ignored.`
				: `Chroma: a hue sweep shows no gamut edge, so the upper quartile of ${fit.hues} hues' retention (${percent(fit.retained)}) stands in for the unclipped value. A chroma ramp gives a firmer number.`,
		);
		if (saturation !== wanted && Math.abs(wanted - 1) >= SNAP) {
			notes.push(`Saturation ${round(wanted)} was clamped to ${preset.saturation}.`);
		}
		if (curve) notes.push("Chroma was read after undoing the measured tone response.");
	} else {
		notes.push("No chroma chart: saturation left at its default.");
	}

	notes.push(
		`Contrast is not measured by these charts and is left at ${preset.contrast}.`,
		`Sharpness cannot be measured from printed charts and is left at ${preset.sharpness}.`,
		"This is a starting point for a PrintTarget's preset, not a per-image correction.",
	);
	return { ok: true, preset, fitted, notes, ...summary };
}
