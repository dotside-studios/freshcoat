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

import { fontArrayBuffer } from "./font-bytes";
import { fontFeatureList, fontVariationList } from "./paint-helpers";
import type {
	ClusterAdvance,
	InlineShapedLine,
	InlineSpan,
	SpanFont,
	TextEngine,
} from "./text-engine";
import {
	paragraphGaps,
	type TextLayout,
	type TextLayoutInput,
} from "./text-types";
import type { FontVMetrics } from "./types";

// biome-ignore lint/suspicious/noExplicitAny: caller-supplied CanvasKit instance
type CK = any;

const WEIGHTS: Record<number, string> = {
	100: "Thin",
	200: "ExtraLight",
	300: "Light",
	400: "Normal",
	500: "Medium",
	600: "SemiBold",
	700: "Bold",
	800: "ExtraBold",
	900: "Black",
};

const SHRINK_FLOOR_PX = 8;
const NATURAL_WIDTH = 1e7; // effectively unbounded — single-line advance
// Font size the metrics probe shapes at: big enough that the reported line box
// divides back to a per-em ratio without rounding noise.
const PROBE_EM = 1000;

// CSS white-space: pre-line: collapse every other run of whitespace to a
// single space and keep each newline as a hard break. Line-edge trimming is
// handled per line via endExcludingWhitespaces.
function collapse(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[^\S\n]+/g, " ")
		.replace(/ ?\n ?/g, "\n");
}

const hardLines = (text: string): number => text.split(/\r\n?|\n/).length;

type Line = { text: string; width: number; hardBreak?: boolean };

export function createParagraphEngine(
	ck: CK,
	fonts: Map<string, Uint8Array[]>,
): TextEngine & { dispose(): void } {
	const provider = ck.TypefaceFontProvider.Make();
	for (const [family, list] of fonts) {
		for (const bytes of list) {
			provider.registerFont(fontArrayBuffer(bytes), family);
		}
	}
	// Every registered family, in insertion order, used as the per-glyph fallback
	// chain: a span names one family, but CanvasKit only falls back to families it
	// sees in `fontFamilies`, so append the rest. Without this, any glyph the span's
	// font lacks (emoji, CJK, Arabic…) renders as tofu even when a covering font is
	// registered. Callers order the map so broader fallbacks come after the primary.
	const fallbackFamilies = [...fonts.keys()];

	function ckWeight(weight: number | undefined): CK {
		return ck.FontWeight[
			WEIGHTS[Math.round((weight || 400) / 100) * 100] ?? "Normal"
		];
	}

	// The CanvasKit TextStyle for a span — the same shape canvaskit.ts paints
	// with. CanvasKit adds letterSpacing after each glyph, so measuring/breaking
	// with it here matches the render exactly.
	function spanTextStyle(font: SpanFont): CK {
		return {
			fontFamilies: [
				font.family,
				...fallbackFamilies.filter((f) => f !== font.family),
			],
			fontSize: font.size,
			fontStyle: {
				weight: ckWeight(font.weight),
				slant:
					font.style === "italic" ? ck.FontSlant.Italic : ck.FontSlant.Upright,
			},
			// The same weight again as a variation axis, plus any other axes the
			// span sets. A family delivered as one variable file (what Google Fonts
			// serves a browser, one woff2 per subset reused across every weight row)
			// would otherwise shape a 700 span as the 400 instance under synthetic
			// bold: lighter strokes and 400's advances, so thin and mis-wrapped.
			fontVariations: fontVariationList(font.weight, font.variations),
			...(font.features
				? { fontFeatures: fontFeatureList(font.features) }
				: {}),
			...(font.letterSpacing ? { letterSpacing: font.letterSpacing } : {}),
		};
	}

	function paragraphStyle(font: SpanFont, direction?: "ltr" | "rtl"): CK {
		return new ck.ParagraphStyle({
			textStyle: spanTextStyle(font),
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
	): { para: CK; builder: CK } {
		const style = paragraphStyle(font, direction);
		const builder = ck.ParagraphBuilder.MakeFromFontProvider(style, provider);
		builder.addText(text);
		return { para: builder.build(), builder };
	}

	// Shape every styled span as ONE paragraph and wrap at maxWidth, so cross-span
	// shaping, per-fragment geometry, and wrapping of mixed-style text all match
	// what canvaskit.ts paints. Spans are added verbatim
	// — the painter does the same — and each line's fragments are sliced by the
	// intersection of the span's text range with the line, positioned via
	// getRectsForRange (advance-based selection rects) relative to the line's left.
	function layoutInline(
		spans: InlineSpan[],
		maxWidth: number,
		direction?: "ltr" | "rtl",
	): { lines: InlineShapedLine[] } {
		if (spans.length === 0) return { lines: [] };
		const pstyle = paragraphStyle(spans[0]!.font, direction);
		const builder = ck.ParagraphBuilder.MakeFromFontProvider(pstyle, provider);
		const ranges: { start: number; end: number; spanIndex: number }[] = [];
		let cursor = 0;
		let full = "";
		spans.forEach((s, i) => {
			builder.pushStyle(ck.TextStyle(spanTextStyle(s.font)));
			builder.addText(s.text);
			builder.pop();
			ranges.push({ start: cursor, end: cursor + s.text.length, spanIndex: i });
			cursor += s.text.length;
			full += s.text;
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
			return { lines };
		} finally {
			para.delete();
			builder.delete();
		}
	}

	function breakLines(
		text: string,
		font: SpanFont,
		maxWidth: number,
		direction?: "ltr" | "rtl",
	): Line[] {
		const norm = collapse(text);
		const { para, builder } = build(norm, font, direction);
		try {
			para.layout(maxWidth);
			return para
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
		} finally {
			para.delete();
			builder.delete();
		}
	}

	function naturalWidth(text: string, font: SpanFont): number {
		const { para, builder } = build(collapse(text), font);
		try {
			para.layout(NATURAL_WIDTH);
			return para.getMaxIntrinsicWidth();
		} finally {
			para.delete();
			builder.delete();
		}
	}

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
		const lines = breakLines(text, font, maxWidth);
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
			const lines = breakLines(
				input.value,
				{ ...input.font, size },
				input.maxWidth,
				input.direction,
			);
			return {
				lines,
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

		let lo = SHRINK_FLOOR_PX;
		// The full size was just shown not to fit, so search below it.
		let hi = Math.ceil(input.font.size) - 1;
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
		if (best) return { ...best, shrinkApplied: true };
		return { ...once(SHRINK_FLOOR_PX), shrinkApplied: true };
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
		dispose: () => provider.delete(),
	};
}
