// Helpers the other Freshcoat packages share. Unstable: anything here can
// change or go in any release, so applications import from the package root.

export {
	applyAdjustColor,
	type ColorMatrix,
	concatColorMatrix,
	contrastMatrix,
	identityColorMatrix,
	saturationMatrix,
} from "./adjust";
export { resolveDirection } from "./bake-text";
export {
	type BooleanOp,
	type BooleanOperand,
	type BooleanShape,
	combineShapes,
} from "./boolean-path";
export { cr80Pixels } from "./card";
export { mixColor, parseColor, toHex } from "./color";
export {
	MAX_SUPERSAMPLE,
	resolveExportScale,
	resolveSupersample,
	withExportScale,
} from "./export-scale";
export {
	clearFontBytesCache,
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
export { FALLBACK_LINE_HEIGHT } from "./line-height";
export { base64ToBytes, bytesToBase64, inheritLoaderPolicy } from "./loader";
export { modulePixels } from "./module-pixels";
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
export { fitRect, strokeInset } from "./paint-helpers";
export { md5 } from "./pdf/md5";
export { resolveLayout, rotatedFootprint } from "./resolve-layout";
export { roundCorners } from "./round-corners";
export {
	type ApplyCaseOptions,
	applyCase,
	applySpanCase,
	type TextCase,
} from "./text-case";
export { spanTextStyle, toColor } from "./text-style";
export { type StrokeTrim, strokeTrim, trimPath } from "./trim";
