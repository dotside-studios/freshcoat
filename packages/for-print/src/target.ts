// One kind of printer: the fixed correction used without analysis, the
// per-image recommendation, the whole-frame finish and any intent defaults.
// The planner and analysis are generic; everything printer-specific is here.

import type { FrameFinish } from "@freshcoat-js/engine";
import type { ImageStats } from "./analyze";
import type { PlanPolicy } from "./plan";
import type { PrintOptimizeOptions } from "./types";

export interface PrintTarget {
	id: string;
	name: string;
	preset: PrintOptimizeOptions;
	recommend(stats: ImageStats): {
		recommendation: PrintOptimizeOptions;
		notes: Array<string>;
	};
	finish: FrameFinish;
	policy?: PlanPolicy;
}

// Tuned for YMCKO dye-sublimation ribbon printers.
const DYE_SUB_PRESET: PrintOptimizeOptions = {
	saturation: 1.3,
	contrast: 1.2,
	sharpness: 0.3,
	gamma: 0.85,
	darkness: 0.25,
};

// The whole-frame finishing for-print recommends alongside the per-layer
// adjustments — the conjunctive/spatial output ops that aren't a per-layer Adjust.
// Pass to freshcoat's compile/render `finish`. Mirrors the old buffer pipeline's
// defaults: snap near-black (<30) to resin-friendly black, near-white (>248) to
// white, and ±2 levels of deterministic monochrome dither to break dye-sub
// gradient banding without colored grain.
const DYE_SUB_FINISH: FrameFinish = {
	blackExtract: 30,
	whiteClamp: 248,
	dither: { amount: 2, seed: 0, mode: "monochrome" },
};

// Dye-sub tuned recommendation from robust image statistics. Brightness
// decisions key off the median (not the mean), with explicit guards for the tails —
// protect near-clipping highlights, and ease off darkening when shadows are already
// crushed. Contrast keys off the p5–p95 spread.
function recommendDyeSub(stats: ImageStats): {
	recommendation: PrintOptimizeOptions;
	notes: Array<string>;
} {
	const {
		medianBrightness: mid,
		shadow,
		highlight,
		avgSaturation,
		contrast,
	} = stats;
	const notes: Array<string> = [];
	let saturation = 1.0;
	let contrastMul = 1.0;
	let gamma = 1.0;
	const sharpness = 0.3;
	let darkness = 0.0;

	// Pastel/light designs: bright, desaturated, low tonal spread.
	const isPastel = mid > 180 && avgSaturation < 0.3 && contrast < 0.3;

	// Saturated designed art — a brand gradient or flat vector ground rather than a
	// photograph. The intersection of the two buckets below that would otherwise
	// fire hardest on it: already at the top saturation bucket, and inside the
	// low-spread contrast bucket. Its narrow luma spread is one hue sitting in a
	// band, not a flat exposure, so the boosts those buckets prescribe are aimed at
	// a problem it doesn't have and push its leading channel past full scale.
	const isBrandArt = avgSaturation > 0.55 && contrast < 0.35;

	if (isPastel) {
		saturation = 1.2;
		gamma = 0.92;
		darkness = 0.1;
		contrastMul = 1.1;
		notes.push(
			"Pastel/light design detected — using gentle settings to preserve subtle colors",
		);
		notes.push(
			"Tip: adjust darkness slider manually to taste, heavy overlay will shift delicate tones",
		);
	} else {
		// --- Saturation ---
		if (isBrandArt) {
			saturation = 1.0;
			notes.push(
				"Saturated brand art — already dense, no saturation boost applied",
			);
		} else if (avgSaturation < 0.2) {
			saturation = 1.45;
			notes.push("Very low saturation — aggressive boost needed for dye-sub");
		} else if (avgSaturation < 0.35) {
			saturation = 1.35;
			notes.push("Low saturation — strong boost for dye-sub");
		} else if (avgSaturation < 0.55) {
			saturation = 1.25;
			notes.push("Moderate saturation — standard dye-sub boost");
		} else {
			saturation = 1.15;
			notes.push("Good saturation — light dye-sub compensation");
		}

		// --- Brightness / darkness (median-driven) ---
		if (mid > 200) {
			gamma = 0.85;
			darkness = 0.3;
			notes.push("Very bright image — 30% overlay + gamma to prevent washout");
		} else if (mid > 160) {
			gamma = 0.85;
			darkness = 0.2;
			notes.push("Bright image — 20% overlay + gamma for dye-sub");
		} else if (mid > 120) {
			gamma = 0.88;
			darkness = 0.15;
			notes.push("Moderate brightness — light overlay + gamma");
		} else if (mid < 60) {
			gamma = 0.95;
			darkness = 0.0;
			notes.push("Dark image — minimal adjustment, already dense");
		} else {
			gamma = 0.9;
			darkness = 0.1;
			notes.push("Medium-dark image — light dye-sub compensation");
		}

		// Highlight guard: a bright subject on a mid ground has a moderate median but
		// blown highlights — add a touch of darkening to hold them even so.
		if (highlight > 248 && darkness < 0.15) {
			darkness = 0.15;
			notes.push("Highlights near clipping — light overlay to hold detail");
		}
		// Shadow guard: if the darkest content is already dense, ease off darkening so
		// shadow detail survives the dye-sub compression.
		if (shadow < 12 && darkness > 0.1) {
			darkness = 0.1;
			notes.push("Shadows already dense — easing darkening to keep detail");
		}

		// --- Contrast (p5–p95 spread) ---
		if (isBrandArt) {
			contrastMul = 1.05;
			notes.push(
				"Narrow spread is the hue, not flatness — minimal contrast boost",
			);
		} else if (contrast < 0.35) {
			contrastMul = 1.3;
			notes.push("Low tonal spread — strong contrast boost to add definition");
		} else if (contrast < 0.6) {
			contrastMul = 1.2;
			notes.push("Moderate tonal spread — standard contrast boost");
		} else {
			contrastMul = 1.1;
			notes.push("Wide tonal spread — light compensation for dye spread");
		}
	}

	return {
		recommendation: {
			saturation,
			contrast: contrastMul,
			gamma,
			sharpness,
			darkness,
		},
		notes,
	};
}

export const YMCKO_DYE_SUB: PrintTarget = {
	id: "ymcko-dye-sub",
	name: "Card printer (YMCKO dye-sub)",
	preset: DYE_SUB_PRESET,
	recommend: recommendDyeSub,
	finish: DYE_SUB_FINISH,
};

export const DEFAULT_PRINT_TARGET = YMCKO_DYE_SUB;

export const PRINT_TARGETS: readonly PrintTarget[] = [YMCKO_DYE_SUB];

export function printTarget(id: string | undefined): PrintTarget | undefined {
	if (id === undefined) return DEFAULT_PRINT_TARGET;
	return PRINT_TARGETS.find((t) => t.id === id);
}
