// Text-layout vocabulary shared by every TextEngine (the CanvasKit Paragraph
// engine, the dependency-free approx engine, and compile). Kept impl-free so it
// carries no CanvasKit weight.
import type { FontVariations, ResolvedFont } from "./types";

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
	};
	maxWidth: number;
	maxHeight: number;
	lineHeight: number;
	fit: "shrink" | "clip" | undefined;
};

// hardBreak: the line ends its paragraph (a newline, or the end of the text).
export type MeasuredLine = { text: string; width: number; hardBreak?: boolean };

export type TextLayout = {
	lines: MeasuredLine[];
	totalHeight: number;
	effectiveFontSize: number;
	shrinkApplied: boolean;
};
