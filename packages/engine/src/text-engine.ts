// A pluggable text-layout engine — the seam compile measures + line-breaks
// through. Two implementations exist:
//   • createParagraphEngine(ck, fonts) — CanvasKit Paragraph doing breaking +
//     measurement natively (see ./paragraph-layout), the same engine the painter
//     shapes with. Used by every production render path.
//   • approxEngine — a zero-dependency approximation (see ./approx-layout),
//     compile's DEFAULT, for callers with no CanvasKit instance (the browser
//     skeleton underlay, SSR, tests).
//
// compile takes one via CompileOptions.textEngine (default approxEngine).
import type { MeasureText, TextLayout, TextLayoutInput } from "./text-types";
import type { FontVMetrics } from "./types";

export type SpanFont = TextLayoutInput["font"];

// One styled run of a mixed-style ("inline") text element.
export type InlineSpan = { text: string; font: SpanFont };
// A styled run's geometry on a laid-out line: which input span, its text on this
// line, and its box left/width relative to the line's left edge (target px).
export type InlineFragment = {
	spanIndex: number;
	text: string;
	x: number;
	width: number;
};
export type InlineShapedLine = {
	fragments: InlineFragment[];
	width: number;
	hardBreak?: boolean;
};

export type TextEngine = {
	// Wrapped/natural width + height of a run (maxWidth null = single line).
	measureText: MeasureText;
	// Natural single-line advance width of one styled span.
	measureSpanWidth: (text: string, font: SpanFont) => number;
	// Full wrap (+ optional shrink-to-fit) of a single-style paragraph.
	layoutText: (input: TextLayoutInput) => TextLayout;
	// Optional: shape multiple styled spans as ONE paragraph and wrap at maxWidth,
	// returning per-line span fragments with correct cross-span geometry. Engines
	// that can't shape across styles omit it, and compile falls back to
	// independent-span, single-line placement.
	layoutInline?: (
		spans: InlineSpan[],
		maxWidth: number,
		direction?: "ltr" | "rtl",
	) => { lines: InlineShapedLine[] };
	// Optional: a family's vertical metrics as the engine's own backend reads
	// them. The sfnt reader (readFontMetrics) parses ttf/otf only, so a family
	// delivered as woff2 — what Google Fonts serves a browser — has none; an
	// engine holding the decoded face can still answer. Used to resolve AUTO line
	// heights (see ./line-height).
	metricsFor?: (family: string) => FontVMetrics | undefined;
};
