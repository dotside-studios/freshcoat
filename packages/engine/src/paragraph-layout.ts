// A TextEngine backed by CanvasKit's native Paragraph API. It does line
// breaking AND measurement in the same engine the CanvasKit painter shapes with,
// so layout and paint agree.
//
// Whitespace runs are collapsed before shaping (CSS white-space: pre-line),
// which Paragraph on its own would preserve; a newline stays a hard break. Break opportunities follow Skia's UAX-14
// rules, so breaks inside URLs and punctuation-dense runs can differ from a
// browser's.
//
// getLineMetrics start/end indices are UTF-16 code-unit offsets (JS string
// indices), so per-line text is a direct string slice. Checked for Latin + BMP
// punctuation (em dash etc.); astral/emoji (surrogate pairs) and CJK line-break
// rules are untested.

import type {
	CanvasKit,
	Paragraph,
	ParagraphBuilder,
	ParagraphStyle,
	TextStyle,
} from "canvaskit-wasm";
import {
	createSharedFontProvider,
	makeParagraphBuilder,
	type SharedFontProvider,
} from "./font-collection";
import type {
	ClusterAdvance,
	InlineShapedLine,
	InlineSpan,
	SpanFont,
	TextEngine,
} from "./text-engine";
import { spanTextStyle } from "./text-style";
import {
	largestFitting,
	paragraphGaps,
	type TextLayout,
	type TextLayoutInput,
} from "./text-types";
import type { FontVMetrics } from "./types";

const SHRINK_FLOOR_PX = 8;
const SHAPE_MEMO_MAX = 2000;
const NATURAL_WIDTH = 1e7; // effectively unbounded — single-line advance
// Font size the metrics probe shapes at: big enough that the reported line box
// divides back to a per-em ratio without rounding noise.
const PROBE_EM = 1000;

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

// CSS white-space: pre-line: collapse every other run of whitespace to a
// single space and keep each newline as a hard break. Line-edge trimming is
// handled per line via endExcludingWhitespaces.
function collapse(text: string): string {
	return normalizeNewlines(text)
		.replace(/[^\S\n]+/g, " ")
		.replace(/ ?\n ?/g, "\n");
}

const hardLines = (text: string): number => text.split(/\r\n?|\n/).length;

type Line = { text: string; width: number; hardBreak?: boolean };

// A least-recently-used map from a JSON key to a shaping result.
function memoShape<A extends unknown[], R>(
	max: number,
	fn: (...args: A) => R,
): (...args: A) => R {
	const cache = new Map<string, R>();
	return (...args) => {
		const key = JSON.stringify(args);
		const hit = cache.get(key);
		if (hit !== undefined) {
			cache.delete(key);
			cache.set(key, hit);
			return hit;
		}
		const value = fn(...args);
		cache.set(key, value);
		if (cache.size > max) cache.delete(cache.keys().next().value as string);
		return value;
	};
}

// The paragraph's unresolved codepoints, in the order the text first uses them.
function missingIn(para: Paragraph, text: string): number[] | undefined {
	const unresolved = new Set(para.unresolvedCodepoints());
	if (unresolved.size === 0) return undefined;
	const out: number[] = [];
	for (const ch of text) {
		const cp = ch.codePointAt(0) as number;
		if (unresolved.delete(cp)) out.push(cp);
	}
	return [...out, ...unresolved];
}

// `shared`, when given, must hold every face in `fonts`; the engine holds a
// reference to it until disposed.
export function createParagraphEngine(
	canvasKit: unknown,
	fonts: Map<string, Uint8Array[]>,
	shared?: SharedFontProvider,
): TextEngine & { dispose(): void } {
	const ck = canvasKit as CanvasKit;
	shared?.retain();
	const fontSet = shared ?? createSharedFontProvider(ck, fonts);
	const provider = fontSet.provider;
	let disposed = false;
	// Every registered family, in insertion order, used as the per-glyph fallback
	// chain: a span names one family, but CanvasKit only falls back to families it
	// sees in `fontFamilies`, so append the rest. Without this, any glyph the span's
	// font lacks (emoji, CJK, Arabic…) renders as tofu even when a covering font is
	// registered. Callers order the map so broader fallbacks come after the primary.
	const fallbackFamilies = [...fonts.keys()];

	function paragraphStyle(
		font: SpanFont,
		direction?: "ltr" | "rtl",
	): ParagraphStyle {
		return new ck.ParagraphStyle({
			textStyle: spanTextStyle(ck, font, fallbackFamilies),
			...(direction === "rtl"
				? {
						textDirection: ck.TextDirection.RTL,
						textAlign: ck.TextAlign.Left,
					}
				: {}),
		});
	}

	function build(
		text: string,
		font: SpanFont,
		direction?: "ltr" | "rtl",
	): { para: Paragraph; builder: ParagraphBuilder } {
		const style = paragraphStyle(font, direction);
		const builder = makeParagraphBuilder(ck, style, provider);
		builder.addText(text);
		return { para: builder.build(), builder };
	}

	// Shape every styled span as ONE paragraph and wrap at maxWidth, so cross-span
	// shaping, per-fragment geometry, and wrapping of mixed-style text all match
	// what canvaskit.ts paints. Spans are added with newlines normalized, and
	// each line's fragments are sliced by the intersection of the span's text range with the line, positioned via
	// getRectsForRange (advance-based selection rects) relative to the line's left.
	function layoutInline(
		spans: InlineSpan[],
		maxWidth: number,
		direction?: "ltr" | "rtl",
	): { lines: InlineShapedLine[]; missing?: number[] } {
		if (spans.length === 0) return { lines: [] };
		const pstyle = paragraphStyle(spans[0]!.font, direction);
		const builder = makeParagraphBuilder(ck, pstyle, provider);
		const ranges: { start: number; end: number; spanIndex: number }[] = [];
		let cursor = 0;
		let full = "";
		spans.forEach((s, i) => {
			// Typed as constructor only; CanvasKit also allows the plain call.
			builder.pushStyle(
				(ck.TextStyle as unknown as (ts: TextStyle) => TextStyle)(
					spanTextStyle(ck, s.font, fallbackFamilies),
				),
			);
			const text = normalizeNewlines(s.text);
			builder.addText(text);
			builder.pop();
			ranges.push({ start: cursor, end: cursor + text.length, spanIndex: i });
			cursor += text.length;
			full += text;
		});
		const para = builder.build();
		try {
			para.layout(maxWidth);
			const lines: InlineShapedLine[] = para
				.getLineMetrics()
				.map(
					(lm: {
						startIndex: number;
						endExcludingWhitespaces: number;
						width: number;
						left: number;
						isHardBreak: boolean;
					}) => {
						const fragments = [];
						for (const r of ranges) {
							const fs = Math.max(r.start, lm.startIndex);
							const fe = Math.min(r.end, lm.endExcludingWhitespaces);
							if (fe <= fs) continue; // span absent from this line (or only ws)
							const rects = para.getRectsForRange(
								fs,
								fe,
								ck.RectHeightStyle.Tight,
								ck.RectWidthStyle.Tight,
							);
							if (!rects.length) continue;
							let left = Number.POSITIVE_INFINITY;
							let right = Number.NEGATIVE_INFINITY;
							for (const rd of rects) {
								left = Math.min(left, rd.rect[0]);
								right = Math.max(right, rd.rect[2]);
							}
							fragments.push({
								spanIndex: r.spanIndex,
								text: full.slice(fs, fe),
								x: left - lm.left,
								width: right - left,
							});
						}
						return { fragments, width: lm.width, hardBreak: lm.isHardBreak };
					},
				);
			const missing = missingIn(para, full);
			return missing ? { lines, missing } : { lines };
		} finally {
			para.delete();
			builder.delete();
		}
	}

	function shapeLines(
		text: string,
		font: SpanFont,
		maxWidth: number,
		direction: "ltr" | "rtl" | undefined,
	): { lines: Line[]; missing?: number[] } {
		const norm = collapse(text);
		const { para, builder } = build(norm, font, direction);
		try {
			para.layout(maxWidth);
			const lines = para
				.getLineMetrics()
				.map(
					(m: {
						startIndex: number;
						endExcludingWhitespaces: number;
						width: number;
						isHardBreak: boolean;
					}) => ({
						// UTF-16 code-unit offsets → direct string slice.
						text: norm.slice(m.startIndex, m.endExcludingWhitespaces).trim(),
						width: m.width,
						hardBreak: m.isHardBreak,
					}),
				);
			const missing = missingIn(para, norm);
			return missing ? { lines, missing } : { lines };
		} finally {
			para.delete();
			builder.delete();
		}
	}

	function shapeNaturalWidth(text: string, font: SpanFont): number {
		const { para, builder } = build(collapse(text), font);
		try {
			para.layout(NATURAL_WIDTH);
			return para.getMaxIntrinsicWidth();
		} finally {
			para.delete();
			builder.delete();
		}
	}

	// measureText and layoutText meet at the same (text, font, width): a hug box
	// and the bake at its width shape once, and the shrink search reuses trials.
	// Shaping is a pure function of these for the engine's fixed faces. Results
	// are shared, so callers treat them as read-only (memoizeTextEngine freezes).
	const breakLines = memoShape(SHAPE_MEMO_MAX, shapeLines);
	const naturalWidth = memoShape(SHAPE_MEMO_MAX, shapeNaturalWidth);

	const measureText: TextEngine["measureText"] = (text, font, maxWidth) => {
		const lineHeightPx = font.size * font.lineHeight;
		if (text.length === 0) return { width: 0, height: lineHeightPx };
		if (maxWidth === null) {
			// Round the single-line (hug) width UP to a whole pixel: laying a
			// paragraph out at exactly getMaxIntrinsicWidth wraps (CanvasKit breaks on
			// `>=`, not `>`), so a hug box sized to the raw width would wrap/ellipsize.
			return {
				width: Math.ceil(naturalWidth(text, font)),
				height: hardLines(text) * lineHeightPx,
			};
		}
		const { lines } = breakLines(text, font, maxWidth, undefined);
		const width = lines.reduce((max, l) => Math.max(max, l.width), 0);
		const height = Math.max(1, lines.length) * lineHeightPx;
		return { width, height };
	};

	const measureSpanWidth: TextEngine["measureSpanWidth"] = (text, font) => {
		if (text.length === 0) return 0;
		return naturalWidth(text, font);
	};

	// Cluster widths summed in logical order, so the advance up to a boundary
	// holds for either direction.
	const clusterAdvances: NonNullable<TextEngine["clusterAdvances"]> = (
		text,
		font,
	) => {
		const out: ClusterAdvance[] = [];
		if (text.length === 0) return out;
		const { para, builder } = build(text, font);
		try {
			para.layout(NATURAL_WIDTH);
			let x = 0;
			let i = 0;
			while (i < text.length) {
				const info = para.getGlyphInfoAt(i);
				if (!info) break;
				const { end } = info.graphemeClusterTextRange;
				if (end <= i) break;
				const [l, , r] = info.graphemeLayoutBounds;
				x += r - l;
				out.push({ end, x });
				i = end;
			}
			return out;
		} finally {
			para.delete();
			builder.delete();
		}
	};

	// Mirrors text-layout.ts's layoutText/shrinkToFit so the two engines are
	// interchangeable inside compile.
	const layoutText: TextEngine["layoutText"] = (
		input: TextLayoutInput,
	): TextLayout => {
		const lh = input.lineHeight;
		const once = (size: number) => {
			const { lines, missing } = breakLines(
				input.value,
				{ ...input.font, size },
				input.maxWidth,
				input.direction,
			);
			return {
				lines,
				...(missing ? { missing } : {}),
				totalHeight:
					lines.length * size * lh +
					paragraphGaps(lines) * (input.paragraphSpacing ?? 0),
				effectiveFontSize: size,
			};
		};

		if (input.fit !== "shrink")
			return { ...once(input.font.size), shrinkApplied: false };
		if (input.font.size < SHRINK_FLOOR_PX)
			return { ...once(input.font.size), shrinkApplied: false };

		const full = once(input.font.size);
		if (full.totalHeight <= input.maxHeight)
			return { ...full, shrinkApplied: false };

		// The full size was just shown not to fit, so search below it, starting
		// from the size at which the height would fit if it scaled with the size.
		const chosen = largestFitting(
			SHRINK_FLOOR_PX,
			Math.ceil(input.font.size) - 1,
			input.font.size * Math.sqrt(input.maxHeight / full.totalHeight),
			once,
			(trial) => trial.totalHeight <= input.maxHeight,
		);
		return { ...chosen, shrinkApplied: true };
	};

	// A family's vertical metrics as Skia reads them from the decoded face, for
	// the AUTO line height (see ./line-height). This exists because the sfnt
	// reader parses ttf/otf only and a browser is served woff2 — the bytes are
	// already decoded here, so ask the engine that holds them. Measured off a
	// probe paragraph at PROBE_EM, which reports the line box the font itself
	// declares; cached per family, since it costs a shape.
	const metricsCache = new Map<string, FontVMetrics | undefined>();
	function metricsFor(family: string): FontVMetrics | undefined {
		const hit = metricsCache.get(family);
		if (hit !== undefined || metricsCache.has(family)) return hit;
		let out: FontVMetrics | undefined;
		if (fonts.has(family)) {
			const { para, builder } = build("Hg", {
				family,
				size: PROBE_EM,
				weight: 400,
				lineHeight: 1,
			} as SpanFont);
			try {
				para.layout(NATURAL_WIDTH);
				const lm = para.getLineMetrics()[0];
				if (lm) {
					out = {
						ascent: lm.ascent / PROBE_EM,
						descent: lm.descent / PROBE_EM,
						// Skia folds the font's leading into the line's ascent/descent, so
						// counting it again here would double it.
						lineGap: 0,
						// Not what the paragraph reports; a caller that needs cap height
						// (leading trim) still goes through readFontMetrics.
						capHeight: 0,
					};
				}
			} finally {
				para.delete();
				builder.delete();
			}
		}
		metricsCache.set(family, out);
		return out;
	}

	return {
		measureText,
		measureSpanWidth,
		layoutText,
		layoutInline,
		clusterAdvances,
		metricsFor,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			fontSet.release();
		},
	};
}
