// Text-layout vocabulary shared by every TextEngine (the CanvasKit Paragraph
// engine, the dependency-free approx engine, and compile). Kept impl-free so it
// carries no CanvasKit weight.
import type { FontFeatures, FontVariations, ResolvedFont } from "./types";

// Wrapped/natural width + height of a run (maxWidth null = single line).
export type MeasureText = (
	text: string,
	font: ResolvedFont,
	maxWidth: number | null,
) => { width: number; height: number };

export type TextLayoutInput = {
	value: string;
	font: {
		family: string;
		size: number;
		weight?: number;
		style?: string;
		// Extra tracking (target px) between glyphs. Honored by engines that can.
		letterSpacing?: number;
		variations?: FontVariations;
		features?: FontFeatures;
	};
	maxWidth: number;
	maxHeight: number;
	lineHeight: number;
	fit: "shrink" | "clip" | undefined;
	direction?: "ltr" | "rtl";
	// Extra space after each line that ends a paragraph, but the last. Counted
	// in totalHeight, so shrink-to-fit makes room for it.
	paragraphSpacing?: number;
};

// hardBreak: the line ends its paragraph (a newline, or the end of the text).
export type MeasuredLine = { text: string; width: number; hardBreak?: boolean };

// The paragraph gaps a set of lines opens: one per hard break but the last line's.
export function paragraphGaps(lines: { hardBreak?: boolean }[]): number {
	let n = 0;
	for (let i = 0; i < lines.length - 1; i++) if (lines[i].hardBreak) n++;
	return n;
}

export type TextLayout = {
	lines: MeasuredLine[];
	totalHeight: number;
	effectiveFontSize: number;
	shrinkApplied: boolean;
	// Codepoints no registered face covers, in text order. Absent when every
	// glyph resolved or the engine cannot tell.
	missing?: number[];
};
