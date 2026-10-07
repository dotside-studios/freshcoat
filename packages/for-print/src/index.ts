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
export type {
	CalibrationAssessment,
	CalibrationBlocker,
} from "./assess";
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
	type AnalysisCache,
	type AnalyzeSceneOptions,
	analyzeScene,
	classifyIntent,
	createAnalysisCache,
	type ImageSampler,
	type LayerIntent,
	type LayerIntentResolver,
	type PlanPolicy,
	type PrintPlan,
	type PrintPlanOptions,
	planForPrint,
	planScene,
	printAdjust,
	printFinish,
} from "./plan";
export { NO_PROCESSING, YMCKO_FINISH, YMCKO_PRESET } from "./presets";
export {
	type PrintProfile,
	type PrintProfileConditions,
	type PrintProfileParse,
	parsePrintProfile,
	profileCacheKey,
	UNMEASURED_PROFILE,
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
