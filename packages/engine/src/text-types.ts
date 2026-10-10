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

// The trial for the largest whole size in [lo, hi] that fits, or the floor's
// trial when none does. Fitting is monotone in size, so the search starts at
// `seed` and widens by doubling steps until it brackets the answer, then
// bisects: a good seed settles in two or three trials where bisecting the whole
// range takes log2(hi - lo).
export function largestFitting<T>(
	lo: number,
	hi: number,
	seed: number,
	trial: (size: number) => T,
	fits: (t: T) => boolean,
): T {
	if (hi < lo) return trial(lo);
	let best: T | undefined;
	let floor: T | undefined;
	let fitN = lo - 1;
	let failN = hi + 1;
	const probe = (n: number) => {
		const t = trial(n);
		if (n === lo) floor = t;
		if (fits(t)) {
			best = t;
			fitN = n;
		} else failN = n;
	};
	probe(Math.min(hi, Math.max(lo, Math.round(seed) || lo)));
	for (let step = 1; failN - fitN > 1 && (best === undefined || failN > hi); ) {
		probe(
			best === undefined
				? Math.max(lo, failN - step)
				: Math.min(hi, fitN + step),
		);
		step *= 2;
	}
	while (failN - fitN > 1) probe(Math.floor((fitN + failN) / 2));
	return best ?? (floor as T);
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
