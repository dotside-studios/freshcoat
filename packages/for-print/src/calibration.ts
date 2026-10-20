// @freshcoat-js/for-print/calibration: print a chart, read it back from a
// photo, and turn the reading into a profile's balance.

export {
	assessCalibration,
	type CalibrationAssessment,
	type CalibrationBlocker,
} from "./assess";
export {
	type FitChannelBalanceOptions,
	fitChannelBalance,
	isBalanceMeaningful,
} from "./balance";
export { type PhotoCalibration, profileFromPhoto } from "./calibrate";
export {
	type Box,
	type ChartPatch,
	type ChartSpec,
	chartScene,
	chromaRampChart,
	DIAGNOSTIC_CHARTS,
	grayBalanceChart,
	hslToRgb,
	hueSweepChart,
	latticeCharts,
	layoutGrid,
	type PatchRole,
	type Point,
	type RGB,
	toneWedgeChart,
} from "./chart";
export {
	type FitTargetPresetFailure,
	type FitTargetPresetOptions,
	type FitTargetPresetReading,
	type FitTargetPresetResult,
	type FittedKnob,
	fitTargetPreset,
} from "./fit-preset";
export {
	applyHomography,
	type ChartReading,
	grayCast,
	type Homography,
	homographyFrom,
	type PatchReading,
	readChart,
	readingToCsv,
	repeatSpread,
} from "./measure";
export {
	createPrintProfile,
	type PrintProfileCreation,
	type PrintProfileDetails,
} from "./profile";
