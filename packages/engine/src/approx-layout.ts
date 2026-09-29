// A zero-dependency approximate text engine — compile's default when no real
// engine is supplied. Estimates advance widths as charCount × size × factor
// (plus letterSpacing between glyphs) and wraps proportionally. No canvas and
// no CanvasKit, so it runs in any environment (the browser skeleton
// underlay, SSR, tests) synchronously.
//
// It is deliberately coarse: the one runtime consumer, CardSkeletonPreview,
// draws placeholder BARS (not glyphs) from the layout, so exact break positions
// don't matter — only rough line counts and widths. Production render paths pass
// createParagraphEngine for pixel-exact layout.
import type { SpanFont, TextEngine } from "./text-engine";
import {
	type MeasuredLine,
	paragraphGaps,
	type TextLayout,
	type TextLayoutInput,
} from "./text-types";

// Mean glyph advance as a fraction of font size — a serviceable stand-in for a
// proportional font's average character width.
const CHAR_W = 0.5;
const SHRINK_FLOOR_PX = 8;

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

// Each newline-separated paragraph, collapsed on its own.
function paragraphs(text: string): string[] {
	return text.split(/\r\n?|\n/).map(collapse);
}

function advance(text: string, size: number, letterSpacing = 0): number {
	const n = [...text].length;
	if (n === 0) return 0;
	return n * size * CHAR_W + Math.max(0, n - 1) * letterSpacing;
}

function wrap(
	text: string,
	size: number,
	letterSpacing: number,
	maxWidth: number,
): MeasuredLine[] {
	return paragraphs(text).flatMap((p) => {
		const lines = wrapParagraph(p, size, letterSpacing, maxWidth);
		lines[lines.length - 1] = { ...lines[lines.length - 1], hardBreak: true };
		return lines;
	});
}

// Proportional char-count wrap: split into ceil(natural / maxWidth) even chunks.
// Bars, not glyphs, are drawn from this, so mid-word splits are invisible.
function wrapParagraph(
	norm: string,
	size: number,
	letterSpacing: number,
	maxWidth: number,
): MeasuredLine[] {
	const chars = [...norm];
	const natural = advance(norm, size, letterSpacing);
	if (natural <= maxWidth || chars.length <= 1) {
		return [{ text: norm, width: natural }];
	}
	const lineCount = Math.max(1, Math.ceil(natural / maxWidth));
	const perLine = Math.ceil(chars.length / lineCount);
	const lines: MeasuredLine[] = [];
	for (let i = 0; i < chars.length; i += perLine) {
		const chunk = chars.slice(i, i + perLine).join("");
		lines.push({
			text: chunk,
			width: Math.min(advance(chunk, size, letterSpacing), maxWidth),
		});
	}
	return lines;
}

const measureText: TextEngine["measureText"] = (text, font, maxWidth) => {
	const lineHeightPx = font.size * font.lineHeight;
	if (text.length === 0) return { width: 0, height: lineHeightPx };
	if (maxWidth === null) {
		const paras = paragraphs(text);
		return {
			width: Math.max(
				...paras.map((p) => advance(p, font.size, font.letterSpacing ?? 0)),
			),
			height: paras.length * lineHeightPx,
		};
	}
	const lines = wrap(text, font.size, font.letterSpacing ?? 0, maxWidth);
	const width = lines.reduce((max, l) => Math.max(max, l.width), 0);
	return { width, height: Math.max(1, lines.length) * lineHeightPx };
};

const measureSpanWidth: TextEngine["measureSpanWidth"] = (
	text,
	font: SpanFont,
) => advance(collapse(text), font.size, font.letterSpacing ?? 0);

const layoutText: TextEngine["layoutText"] = (
	input: TextLayoutInput,
): TextLayout => {
	const lh = input.lineHeight;
	const ls = input.font.letterSpacing ?? 0;
	const once = (size: number) => {
		const lines = wrap(input.value, size, ls, input.maxWidth);
		return {
			lines,
			totalHeight:
				lines.length * size * lh +
				paragraphGaps(lines) * (input.paragraphSpacing ?? 0),
			effectiveFontSize: size,
		};
	};
	if (input.fit !== "shrink" || input.font.size < SHRINK_FLOOR_PX) {
		return { ...once(input.font.size), shrinkApplied: false };
	}
	const full = once(input.font.size);
	if (full.totalHeight <= input.maxHeight)
		return { ...full, shrinkApplied: false };
	let lo = SHRINK_FLOOR_PX;
	let hi = input.font.size;
	let best: ReturnType<typeof once> | null = null;
	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		const trial = once(mid);
		if (trial.totalHeight <= input.maxHeight) {
			best = trial;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return best
		? { ...best, shrinkApplied: true }
		: { ...once(SHRINK_FLOOR_PX), shrinkApplied: true };
};

// compile's default engine. No layoutInline — compile falls back to
// independent-span single-line placement, which is fine for the skeleton.
export const approxEngine: TextEngine = {
	measureText,
	measureSpanWidth,
	layoutText,
};
