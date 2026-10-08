// The coat engine. compileScene lowers the Node IR to a flat Command list, and
// createRenderer paints it to pixels with CanvasKit (WASM Skia). Platform code
// (loading CanvasKit, reading files) lives on the /node and /browser subpaths,
// so this entry stays free of DOM and Node APIs.

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
export { DEFAULT_PRECISION, type Precision } from "./color-policy";
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
	fontBytes,
	resolveFontRequest,
} from "./font-bytes";
export {
	type ByteLoader,
	dataUrlToBytes,
	fetchLoader,
	mapLoader,
} from "./loader";
export {
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
export { type MissingGlyphs, missingGlyphs } from "./missing-glyphs";
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
export {
	PATTERN_DEFAULTS,
	PATTERN_KINDS,
	type PatternFill,
	patternFill,
} from "./pattern";
export { resolveLayout } from "./resolve-layout";
export { outlinePath, rectShape } from "./outline";
export { type StrokeTrim, strokeTrim, trimPath } from "./trim";
export {
	type CanvasFrame,
	createRenderer,
	type DefaultOutput,
	type EncodedFrame,
	type FontLoadReport,
	type FontSources,
	type FrameFor,
	type FrameInfo,
	type Output,
	type PaintOptions,
	type PixelsFrame,
	type RenderedFrame,
	type Renderer,
	type RendererCompileOptions,
	type RendererOptions,
	type RendererStats,
	type RenderOptions,
	type SurfaceCanvas,
} from "./renderer";
export { squircleSvg } from "./squircle";
export type { TextEngineCacheStats } from "./text-cache";
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
