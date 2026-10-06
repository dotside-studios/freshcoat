// freshcoat — the rendering foundation. Compiles the composable Node IR
// (via compileScene) to a flat Command list and paints it to pixels via CanvasKit
// (WASM Skia) — no native canvas anywhere. The paint TARGET (offscreen vs live
// canvas) lives on its own subpaths — freshcoat/browser | /headless — and
// each env's `paint(frames, ck)` defaults to the CanvasKit painter, so the barrel
// stays free of DOM / WASM weight. The backend seam itself is
// freshcoat/runtime (Painter + makeRuntime); the `Painter` TYPE is
// re-exported here, since a type costs nothing.

export {
	type AdjustOptions,
	applyAdjustColor,
	brightnessMatrix,
	buildAdjust,
	type ColorMatrix,
	composeAdjust,
	concatColorMatrix,
	contrastMatrix,
	gammaLut,
	identityColorMatrix,
	identityLut3d,
	saturationMatrix,
} from "./adjust";
export { approxEngine } from "./approx-layout";
export {
	type BakeTextOptions,
	bakeText,
	resolveDirection,
	resolveLeadingTrim,
	textClipOutset,
} from "./bake-text";
export { hslToRgb } from "./color";
export {
	type CompileSceneOptions,
	compileScene,
	prepareScene,
	sceneAssets,
} from "./compile-scene";
export {
	type ColorResolver,
	oklchToHex,
	parseCssColor,
	parseLinearGradient,
} from "./css";
export {
	type DecodedPixels,
	type DecodeOptions,
	decodePixels,
	drawImageToPixels,
	type ImageBytesLoader,
	type ImageSampleOptions,
	type PixelRect,
	sampleImageNode,
} from "./decode";
export {
	type ExportConstraint,
	type ExportSetting,
	exportPixelSize,
	MAX_EXPORT_DIMENSION,
	MAX_SUPERSAMPLE,
	resolveExportScale,
	resolveSupersample,
} from "./export-scale";
export {
	clearFontBytesCache,
	dataUrlToBytes,
	fontBytes,
	resolveFontRequest,
} from "./font-bytes";
export {
	deriveFontMetrics,
	getFontMetrics,
	readFontMetrics,
	registerFontMetrics,
} from "./font-metrics";
export {
	autoLineHeight,
	FALLBACK_LINE_HEIGHT,
	type MetricsLookup,
	metricsLookup,
	resolveAutoLineHeights,
} from "./line-height";
export type {
	Align,
	BitmapNode,
	ChildLayout,
	EllipseNode,
	FlexLayout,
	GridLayout,
	GroupNode,
	ImageNode,
	Justify,
	Layout,
	MaskNode,
	Node,
	Padding,
	PathNode,
	RectNode,
	TextNode,
	TrackSize,
	Transform,
} from "./node";
export {
	autoLayout,
	createBitmap,
	createCircle,
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createMask,
	createPath,
	createRect,
	createText,
	gridLayout,
} from "./node";
export {
	createPaintCache,
	type PaintCache,
	type PaintCacheOptions,
	type PaintCacheStats,
} from "./paint-cache";
export {
	decorationLine,
	type FitOptions,
	fitRect,
	insetCorner,
	strokeInset,
} from "./paint-helpers";
export { createParagraphEngine } from "./paragraph-layout";
export { scalePathData } from "./path-data";
export { flattenOverWhite } from "./jpeg";
export {
	DEFAULT_JPEG_QUALITY,
	DEFAULT_WEBP_QUALITY,
	type EncodeFormat,
	type EncodeOptions,
	type EncodePngOptions,
	encodeDecodedPng,
	encodePng,
	type PngEffort,
} from "./png";
export { resolveLayout } from "./resolve-layout";
export { squircleSvg } from "./squircle";
export {
	type CachedTextEngine,
	memoizeTextEngine,
	type TextEngineCacheStats,
} from "./text-cache";
export type {
	ClusterAdvance,
	SpanFont,
	TextEngine,
} from "./text-engine";
export type {
	MeasuredLine,
	MeasureText,
	TextLayout,
	TextLayoutInput,
} from "./text-types";
export type * from "./types";
export { type IrIssue, validateCommands } from "./validate-commands";
