import type { FrameFinish } from "freshcoat";
import type { PrintOptimizeOptions } from "./types";

// Tuned for YMCKO dye-sublimation ribbon printers.
export const YMCKO_PRESET: PrintOptimizeOptions = {
	saturation: 1.3,
	contrast: 1.2,
	sharpness: 0.3,
	gamma: 0.85,
	darkness: 0.25,
};

export const NO_PROCESSING: PrintOptimizeOptions = {
	saturation: 1,
	contrast: 1,
	sharpness: 0,
	gamma: 1,
	darkness: 0,
};

// The whole-frame finishing for-print recommends alongside the per-layer
// adjustments — the conjunctive/spatial output ops that aren't a per-layer Adjust.
// Pass to freshcoat's compile/render `finish`. Mirrors the old buffer pipeline's
// defaults: snap near-black (<30) to resin-friendly black, near-white (>248) to
// white, and ±2 levels of deterministic monochrome dither to break dye-sub
// gradient banding without colored grain.
export const YMCKO_FINISH: FrameFinish = {
	blackExtract: 30,
	whiteClamp: 248,
	dither: { amount: 2, seed: 0, mode: "monochrome" },
};
