import type { FrameFinish } from "@freshcoat-js/engine";
import { YMCKO_DYE_SUB } from "./target";
import type { PrintOptimizeOptions } from "./types";

export const YMCKO_PRESET: PrintOptimizeOptions = YMCKO_DYE_SUB.preset;

export const NO_PROCESSING: PrintOptimizeOptions = {
	saturation: 1,
	contrast: 1,
	sharpness: 0,
	gamma: 1,
	darkness: 0,
};

export const YMCKO_FINISH: FrameFinish = YMCKO_DYE_SUB.finish;
