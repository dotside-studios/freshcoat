// Helpers the other Freshcoat packages share. Unstable: anything here can
// change or go in any release, so applications import from the package root.

export { applyBooleans, cachePathOp } from "./boolean";
export {
	barcodeBox,
	resizeVectorBoolean,
	resizeVectorPath,
} from "./constraints";
export { pieceSpec } from "./piece";
export { isOpenVector, sliceLayers } from "./slices";
export { type ResolvedStrokeTrim, resolveStrokeTrim } from "./stroke-trim";
export { type TextRuleBreak, textRuleBreaks } from "./text-rules";
export { activeVariantId } from "./variants";
