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
export {
	type BooleanOp,
	type BooleanOperand,
	type BooleanShape,
	combineShapes,
} from "./boolean-path";
export {
	CR80_CORNER_MM,
	CR80_LONG_MM,
	CR80_SAFE_MM,
	CR80_SHORT_MM,
	cr80Pixels,
	MM_PER_INCH,
} from "./card";
export { hslToRgb, mixColor, parseColor, type Rgba, toHex } from "./color";
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
	withExportScale,
} from "./export-scale";
export {
	clearFontBytesCache,
	type FontFetch,
	fontBytes,
	fontRequestKey,
	googleCss2Url,
	googleFamilyParam,
	policyFetch,
	resolveFontRequest,
} from "./font-bytes";
export {
	createSharedFontProvider,
	makeParagraphBuilder,
	type SharedFontProvider,
} from "./font-collection";
export {
	getFontMetrics,
	readFontMetrics,
	registerFontMetrics,
} from "./font-metrics";
export { linearGradientAngle, linearGradientPoints } from "./gradient";
export {
	type IccColorSpace,
	type IccProfileInfo,
	type IccProfileResult,
	type OutputIntent,
	type ResolvedOutputIntent,
	readIccProfile,
	resolveOutputIntent,
	SRGB_OUTPUT_INTENT,
	SRGB_PROFILE,
} from "./icc";
export { DEFAULT_MAX_IMAGE_DECODE_PIXELS } from "./image-info";
export { flattenOverWhite } from "./jpeg";
export {
	autoLineHeight,
	FALLBACK_LINE_HEIGHT,
	type MetricsLookup,
	metricsLookup,
	resolveAutoLineHeights,
} from "./line-height";
export {
	assertLoadableUrl,
	type ByteLoader,
	base64ToBytes,
	bytesToBase64,
	createFetchLoader,
	dataUrlToBytes,
	fetchLoader,
	inheritLoaderPolicy,
	type LoaderFetch,
	type LoaderPolicy,
	mapLoader,
} from "./loader";
export { type MissingGlyphs, missingGlyphs } from "./missing-glyphs";
export { modulePixels } from "./module-pixels";
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
	TextPathNode,
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
	ellipsePath,
	isEllipsePath,
	type OutlineGeometry,
	outlineGeometry,
	outlinePath,
	outlineSvg,
	rectShape,
	type SideStrokeGeometry,
	sideStrokeGeometry,
} from "./outline";
export {
	createPaintCache,
	type PaintCache,
	type PaintCacheOptions,
	type PaintCacheStats,
} from "./paint-cache";
export {
	type DecorationMetrics,
	decorationLine,
	type FitOptions,
	fitRect,
	insetCorner,
	skipInkSegments,
	strokeInset,
} from "./paint-helpers";
export { scalePathData } from "./path-data";
export {
	PATTERN_DEFAULTS,
	PATTERN_KINDS,
	type PatternFill,
	patternFill,
} from "./pattern";
export type { PdfTextMode } from "./pdf/paint";
export {
	DEFAULT_JPEG_QUALITY,
	DEFAULT_WEBP_QUALITY,
	type EncodeFormat,
	type EncodeOptions,
	type EncodePngOptions,
	encodeDecodedPng,
	encodePng,
	type PngAlpha,
	type PngEffort,
} from "./png";
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
	type PaintPdfOptions,
	type PdfFrame,
	type PixelsFrame,
	type RenderedFrame,
	type Renderer,
	type RendererCompileOptions,
	type RendererOptions,
	type RendererStats,
	type RenderOptions,
	type RenderPdfOptions,
	type SurfaceCanvas,
} from "./renderer";
export { resolveLayout, rotatedFootprint } from "./resolve-layout";
export { roundCorners } from "./round-corners";
export { squircleSvg } from "./squircle";
export type { TextEngineCacheStats } from "./text-cache";
export {
	type ApplyCaseOptions,
	applyCase,
	applySpanCase,
	type TextCase,
} from "./text-case";
export type {
	ClusterAdvance,
	SpanFont,
	TextEngine,
} from "./text-engine";
export {
	type FontWeightName,
	fontWeight,
	fontWeightName,
	spanTextStyle,
	toColor,
} from "./text-style";
export type {
	MeasuredLine,
	MeasureText,
	TextLayout,
	TextLayoutInput,
} from "./text-types";
export { type StrokeTrim, strokeTrim, trimPath } from "./trim";
export type * from "./types";
export { type IrIssue, validateCommands } from "./validate-commands";
