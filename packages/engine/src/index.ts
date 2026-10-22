// The coat engine. compileScene lowers the Node IR to a flat Command list, and
// createRenderer paints it to pixels with CanvasKit (WASM Skia). Platform code
// (loading CanvasKit, reading files) lives on the /node and /browser subpaths,
// so this entry stays free of DOM and Node APIs.

export { type AdjustOptions, buildAdjust, composeAdjust } from "./adjust";
export { approxEngine } from "./approx-layout";
export {
	CR80_CORNER_MM,
	CR80_LONG_MM,
	CR80_SAFE_MM,
	CR80_SHORT_MM,
	MM_PER_INCH,
} from "./card";
export type { Precision } from "./color-policy";
export { type CompileSceneOptions, compileScene } from "./compile-scene";
export {
	type DecodedPixels,
	type DecodeOptions,
	decodePixels,
	type ImageSampleOptions,
	type PixelRect,
	sampleImageNode,
} from "./decode";
export {
	type ExportConstraint,
	type ExportSetting,
	exportPixelSize,
	MAX_EXPORT_DIMENSION,
} from "./export-scale";
export {
	type FontFetch,
	fontBytes,
	fontRequestKey,
	googleCss2Url,
	googleFamilyParam,
} from "./font-bytes";
export type { OutputIntent } from "./icc";
export {
	type ByteLoader,
	createFetchLoader,
	fetchLoader,
	type LoaderFetch,
	type LoaderPolicy,
	mapLoader,
} from "./loader";
export { type MissingGlyphs, missingGlyphs } from "./missing-glyphs";
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
export type { PaintCacheOptions, PaintCacheStats } from "./paint-cache";
export {
	PATTERN_DEFAULTS,
	PATTERN_KINDS,
	type PatternFill,
	patternFill,
} from "./pattern";
export type { PdfTextMode } from "./pdf/paint";
export {
	type EncodeFormat,
	type EncodeOptions,
	type EncodePngOptions,
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
export type { TextEngineCacheStats } from "./text-cache";
export type { ClusterAdvance, SpanFont, TextEngine } from "./text-engine";
export type {
	MeasuredLine,
	MeasureText,
	TextLayout,
	TextLayoutInput,
} from "./text-types";
export type * from "./types";
