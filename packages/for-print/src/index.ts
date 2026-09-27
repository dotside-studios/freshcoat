// @freshcoat-js/for-print — an ANALYSIS module. Image statistics + print intent in,
// freshcoat adjustments out. It holds no canvas, no rasterizer, and no pixel
// output: freshcoat applies the per-layer `Adjust`s and the whole-frame
// `FrameFinish` this module recommends. Pure and engine-agnostic throughout.

export {
	analyzePixels,
	analyzeStats,
	buildRecommendation,
	correctionMatrix,
	type ImageStats,
	measureGamut,
} from "./analyze";
export {
	type FitChannelBalanceOptions,
	fitChannelBalance,
	isBalanceMeaningful,
} from "./balance";
export {
	assessCalibration,
	type CalibrationAssessment,
	type CalibrationBlocker,
} from "./calibration";
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
	CR80_ASPECT,
	CR80_LONG,
	CR80_SHORT,
	cr80CropAspect,
	cr80Dimensions,
	defaultCropRegion,
	detectOrientation,
	fitCr80CropToImage,
} from "./geometry";
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
	analyzeScene,
	classifyIntent,
	type ImageSampler,
	type LayerIntent,
	type LayerIntentResolver,
	type PlanPolicy,
	planScene,
	printAdjust,
} from "./plan";
export { NO_PROCESSING, YMCKO_FINISH, YMCKO_PRESET } from "./presets";
export {
	createPrintProfile,
	type PrintProfile,
	type PrintProfileConditions,
	type PrintProfileCreation,
	type PrintProfileDetails,
	parsePrintProfile,
	profileCacheKey,
	UNMEASURED_PROFILE,
	withProfile,
} from "./profile";
export type {
	CardOrientation,
	ChannelBalance,
	CropRegion,
	GamutReport,
	ImageAnalysis,
	PixelData,
	PrintOptimizeOptions,
} from "./types";
