// bakeText — lay out a TextNode's already-resolved text into a BakedTextLayout
// (per-line spans with absolute x, baseline, and vertical placement) the painter
// draws verbatim. Operates purely on the Node IR — concrete strings +
// ResolvedFont — through the injected TextEngine (the seam compile measures
// through).
//
// Two paths, chosen by content:
//   • wrappable — one span, no per-span overrides → full wrap + shrink-to-fit
//     via engine.layoutText.
//   • inline — multiple spans (or a single span overriding font/color) → one
//     shaped, wrapped paragraph via engine.layoutInline when available, else an
//     independent-span single-line fallback.
import { getFontMetrics } from "./font-metrics";
import type { TextNode } from "./node";
import type { TextEngine } from "./text-engine";
import { paragraphGaps } from "./text-types";
import type {
	BakedTextLayout,
	ClipOutset,
	FontVMetrics,
	ResolvedFont,
	Size,
	TextLine,
	TextLineSpan,
	Vec2,
} from "./types";

export type BakeTextOptions = {
	textEngine: TextEngine;
	// Figma "Cap height to baseline": anchor the cap height to the box top,
	// trimming first-line leading. Figma's default, so this defaults to true.
	// A node's own `leadingTrim` wins over this.
	leadingTrim?: boolean;
	// Per-family vertical metrics; falls back to the global registry, then to
	// typical ratios. Keyed by font family.
	fontMetrics?: Record<string, FontVMetrics>;
	// The export density the scene will be painted at (see ./export-scale). Line
	// advances are snapped to whole pixels so a paragraph doesn't drift sub-pixel
	// down the page — and at 2× a whole pixel is half a design unit, so the snap
	// belongs on the DEVICE grid. Keeping it on the design grid would spend a 2×
	// export reproducing 1×'s rounding error. Omit/1 = the design grid.
	deviceScale?: number;
};

type Span = NonNullable<TextNode["spans"]>[number];

// A node's leadingTrim wins over the compile default; both default to true.
export function resolveLeadingTrim(
	node: TextNode,
	fallback?: boolean,
): boolean {
	return (node.leadingTrim ?? fallback) !== false;
}

// Vertical slack a fit:"clip" rect needs so glyph overshoot isn't sliced.
// - leadingTrim: the cap line tucks against the box top, so the ascent rises
//   (ascent − capHeight) above it and descenders drop a full descent below the
//   last baseline (bottom-align seats it at the box bottom).
// - line-box model: glyphs are already centered via half-leading, so nothing
//   spills unless the line height is tighter than ascent + descent.
export function textClipOutset(
	font: ResolvedFont,
	leadingTrim: boolean,
	metricsMap?: Record<string, FontVMetrics>,
): ClipOutset {
	const m = fontMetrics(font, metricsMap);
	if (leadingTrim) {
		return { top: Math.max(0, m.ascent - m.capHeight), bottom: m.descent };
	}
	const halfLeading =
		(font.size * font.lineHeight - (m.ascent + m.descent)) / 2;
	const spill = Math.max(0, -halfLeading);
	return { top: spill, bottom: spill };
}

export function bakeText(
	node: TextNode,
	opts: BakeTextOptions,
): BakedTextLayout {
	const engine = opts.textEngine;
	const leadingTrim = resolveLeadingTrim(node, opts.leadingTrim);
	const metricsMap = opts.fontMetrics;
	const pos: Vec2 = node.pos ?? { x: 0, y: 0 };
	const size: Size = node.size ?? { width: 0, height: 0 };
	const color = node.color ?? "#000";
	const spans = normalizeSpans(node);
	const rtl =
		(node.direction === "auto"
			? resolveDirection(spans.map((s) => s.text).join(""))
			: node.direction) === "rtl";
	const align: ParagraphStyle = {
		align: physicalAlign(node.align ?? "left", rtl),
		last: physicalAlign(node.alignLast ?? "start", rtl),
		rtl,
		spacing: snapToDevice(
			Math.max(0, node.paragraphSpacing ?? 0),
			opts.deviceScale,
		),
	};
	const verticalAlign = node.verticalAlign ?? "top";
	const fit = node.fit;
	const maxLines = node.maxLines;
	const defaultFont = node.font;
	const lineHeight = defaultFont.lineHeight;

	const deviceScale = opts.deviceScale;
	// Wrappable: a single span with no font/color override keeps the full wrap +
	// shrink path. Anything richer goes through the inline (adjacent) path.
	const wrappable = spans.length === 1 && !hasOverrides(spans[0]);

	return wrappable
		? layoutWrappable(
				spans[0].text,
				defaultFont,
				color,
				pos,
				size,
				align,
				verticalAlign,
				lineHeight,
				fit,
				leadingTrim,
				maxLines,
				engine,
				metricsMap,
				deviceScale,
			)
		: layoutInline(
				spans,
				defaultFont,
				color,
				pos,
				size,
				align,
				verticalAlign,
				fit,
				leadingTrim,
				engine,
				metricsMap,
				deviceScale,
			);
}

// ─────────────── span normalization ───────────────

function normalizeSpans(node: TextNode): Span[] {
	if (node.spans && node.spans.length > 0) return node.spans;
	return [{ text: node.text ?? "" }];
}

function hasOverrides(span: Span): boolean {
	if (span.color !== undefined) return true;
	const f = span.font;
	if (!f) return false;
	return (
		f.family !== undefined ||
		f.size !== undefined ||
		f.weight !== undefined ||
		f.style !== undefined ||
		f.letterSpacing !== undefined ||
		f.lineHeight !== undefined ||
		f.variations !== undefined ||
		f.features !== undefined
	);
}

// ─────────────── metrics + baseline ───────────────

// Font ascent/descent (+ line gap, cap height) in target pixels. Prefers the
// OS/2 sTypo metrics Figma uses (registered from font bytes); falls back to
// typical ratios when a family isn't registered.
function fontMetrics(
	font: ResolvedFont,
	metricsMap?: Record<string, FontVMetrics>,
): { ascent: number; descent: number; lineGap: number; capHeight: number } {
	const reg = metricsMap?.[font.family] ?? getFontMetrics(font.family);
	if (reg) {
		return {
			ascent: reg.ascent * font.size,
			descent: reg.descent * font.size,
			lineGap: reg.lineGap * font.size,
			capHeight: reg.capHeight * font.size,
		};
	}
	return {
		ascent: font.size * 0.8,
		descent: font.size * 0.2,
		lineGap: 0,
		capHeight: font.size * 0.7,
	};
}

// Distance from a line's top to its alphabetic baseline.
// - default: Figma centers (ascent + descent) in the line height, so the
//   baseline sits half a leading below the top, plus the ascent.
// - leadingTrim: cap height is anchored to the box top, so baseline = capHeight.
function baselineOffset(
	font: ResolvedFont,
	lineHeightPx: number,
	leadingTrim: boolean,
	metricsMap?: Record<string, FontVMetrics>,
): number {
	const m = fontMetrics(font, metricsMap);
	if (leadingTrim && m.capHeight > 0) return m.capHeight;
	const halfLeading = (lineHeightPx - (m.ascent + m.descent)) / 2;
	return halfLeading + m.ascent;
}

// ─────────────── wrappable (single-style) path ───────────────

function layoutWrappable(
	text: string,
	defaultFont: ResolvedFont,
	color: string,
	pos: Vec2,
	size: Size,
	align: ParagraphStyle,
	verticalAlign: "top" | "middle" | "bottom",
	lineHeight: number,
	fit: "shrink" | "clip" | undefined,
	leadingTrim: boolean,
	maxLines: number | undefined,
	engine: TextEngine,
	metricsMap?: Record<string, FontVMetrics>,
	deviceScale?: number,
): BakedTextLayout {
	const measured = engine.layoutText({
		value: text,
		font: {
			family: defaultFont.family,
			size: defaultFont.size,
			weight: defaultFont.weight,
			style: defaultFont.style,
			letterSpacing: defaultFont.letterSpacing,
			variations: defaultFont.variations,
			...(defaultFont.features ? { features: defaultFont.features } : {}),
		},
		maxWidth: size.width,
		maxHeight: size.height,
		lineHeight,
		fit,
		...(align.rtl ? { direction: "rtl" as const } : {}),
		...(align.spacing ? { paragraphSpacing: align.spacing } : {}),
	});
	const effFont: ResolvedFont = {
		...defaultFont,
		size: measured.effectiveFontSize,
	};

	// Figma "Truncate text": keep the first maxLines, ellipsize the last on overflow.
	let mlines = measured.lines;
	if (maxLines !== undefined && mlines.length > maxLines) {
		const kept = mlines.slice(0, maxLines);
		const last = kept[maxLines - 1];
		const truncated = ellipsize(last.text, effFont, size.width, engine);
		kept[maxLines - 1] = {
			...last,
			text: truncated,
			width: engine.measureText(truncated, effFont, null).width,
		};
		mlines = kept;
	}

	const lineHeightPx = measured.effectiveFontSize * lineHeight;
	// Per-line advance, pixel-rounded like Figma to avoid sub-px drift down a
	// paragraph — on the grid the export will be painted on. (No authoring ratio
	// here — the Node IR is already in target px.)
	const lineAdvance = snapToDevice(lineHeightPx, deviceScale);
	const baseOffset = baselineOffset(
		effFont,
		lineHeightPx,
		leadingTrim,
		metricsMap,
	);
	const nLines = mlines.length;
	const steps = mlines.map(
		(l, i) => lineAdvance + (l.hardBreak && i < nLines - 1 ? align.spacing : 0),
	);
	const contentHeight = leadingTrim
		? baseOffset + sum(steps.slice(0, -1))
		: sum(steps);
	const startY = startYForVAlign(
		verticalAlign,
		pos.y,
		size.height,
		contentHeight,
	);

	let cursorY = startY;
	const lines: TextLine[] = mlines.map((line, i) => {
		const placed = placeLine(
			align,
			i === nLines - 1 || line.hardBreak === true,
			line.text,
			pos.x,
			size.width,
			line.width,
		);
		const y = cursorY;
		cursorY += steps[i];
		return {
			text: line.text,
			y,
			baseline: y + baseOffset,
			...(placed.wordSpacing ? { wordSpacing: placed.wordSpacing } : {}),
			...(align.rtl ? { direction: "rtl" as const } : {}),
			spans: [
				{
					text: line.text,
					x: placed.x,
					width: placed.width,
					font: effFont,
					color,
				},
			],
		};
	});
	return {
		font: effFont,
		lines,
		totalHeight: nLines * lineHeightPx + paragraphGaps(mlines) * align.spacing,
		shrinkApplied: measured.shrinkApplied,
	};
}

// Trim `text` so `text + "…"` fits within maxWidth. With engine.clusterAdvances
// the cut comes from one shaping pass over `text`, checked against the real
// measure of the result and moved a cluster at a time if kerning or rounding
// disagrees; without it, binary search on length.
export function ellipsize(
	text: string,
	font: ResolvedFont,
	maxWidth: number,
	engine: TextEngine,
): string {
	const ell = "…";
	const fits = (prefix: string) =>
		engine.measureText(`${prefix}${ell}`, font, null).width <= maxWidth;
	if (fits(text)) return `${text}${ell}`;
	if (!engine.clusterAdvances) return bisectEllipsize(text, ell, fits);

	const xAt = new Map<number, number>([[0, 0]]);
	const clusters = engine.clusterAdvances(text, font);
	for (const c of clusters) xAt.set(c.end, c.x);
	// Distinct trimmed cut points, ascending. The untrimmed full text is
	// already known not to fit.
	const cuts: { end: number; x: number }[] = [{ end: 0, x: 0 }];
	for (const c of clusters) {
		const end = text.slice(0, c.end).trimEnd().length;
		const x = xAt.get(end);
		if (x === undefined || end === cuts[cuts.length - 1].end) continue;
		if (end === text.length) continue;
		cuts.push({ end, x });
	}

	const budget = maxWidth - engine.measureText(ell, font, null).width;
	let i = 0;
	while (i + 1 < cuts.length && cuts[i + 1].x <= budget) i++;
	const cut = (k: number) => text.slice(0, cuts[k].end);
	if (i > 0 && !fits(cut(i))) {
		do i--;
		while (i > 0 && !fits(cut(i)));
	} else {
		while (i + 1 < cuts.length && fits(cut(i + 1))) i++;
	}
	return `${cut(i)}${ell}`;
}

function bisectEllipsize(
	text: string,
	ell: string,
	fits: (prefix: string) => boolean,
): string {
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (fits(text.slice(0, mid).trimEnd())) lo = mid;
		else hi = mid - 1;
	}
	return `${text.slice(0, lo).trimEnd()}${ell}`;
}

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

const SHRINK_FLOOR_PX = 8;

function scaleFont(font: ResolvedFont, k: number): ResolvedFont {
	return {
		...font,
		size: font.size * k,
		...(font.letterSpacing ? { letterSpacing: font.letterSpacing * k } : {}),
	};
}

// Snap to the pixel grid the scene will actually be painted on.
function snapToDevice(v: number, deviceScale: number | undefined): number {
	const s = deviceScale && deviceScale > 0 ? deviceScale : 1;
	return Math.round(v * s) / s;
}

// ─────────────── inline (multi-style) path ───────────────

function layoutInline(
	spans: Span[],
	defaultFont: ResolvedFont,
	defaultColor: string,
	pos: Vec2,
	size: Size,
	align: ParagraphStyle,
	verticalAlign: "top" | "middle" | "bottom",
	fit: "shrink" | "clip" | undefined,
	leadingTrim: boolean,
	engine: TextEngine,
	metricsMap?: Record<string, FontVMetrics>,
	deviceScale?: number,
): BakedTextLayout {
	const authored = spans.map((s) => {
		const f = s.font ?? {};
		const font: ResolvedFont = {
			family: f.family ?? defaultFont.family,
			size: f.size ?? defaultFont.size,
			weight: f.weight ?? defaultFont.weight,
			style: f.style ?? defaultFont.style,
			letterSpacing: f.letterSpacing ?? defaultFont.letterSpacing,
			lineHeight: f.lineHeight ?? defaultFont.lineHeight,
			decoration: f.decoration ?? defaultFont.decoration,
			// A span's axes adjust the element's rather than replacing them.
			variations:
				f.variations || defaultFont.variations
					? { ...defaultFont.variations, ...f.variations }
					: undefined,
			...(f.features || defaultFont.features
				? { features: { ...defaultFont.features, ...f.features } }
				: {}),
		};
		return { text: s.text, font, color: s.color ?? defaultColor };
	});

	const dominantOf = (rs: typeof authored) =>
		rs.reduce((d, r) => (r.font.size > d.font.size ? r : d)).font;
	let resolved = authored;
	let dominantFont = dominantOf(resolved);
	let lineHeightPx = dominantFont.size * dominantFont.lineHeight;
	let baseOffset = baselineOffset(
		dominantFont,
		lineHeightPx,
		leadingTrim,
		metricsMap,
	);

	// Engine path: one shaped, wrappable paragraph across all spans (cross-span
	// shaping + mixed-style wrapping). This module owns vertical placement (line
	// advance / baseline / vertical-align); the engine returns per-line fragment
	// geometry only.
	if (engine.layoutInline) {
		const layoutInlineWith = engine.layoutInline;
		const shape = (rs: typeof authored) => {
			const input = rs.map((r) => ({ text: r.text, font: r.font }));
			const shaped = align.rtl
				? layoutInlineWith(input, size.width, "rtl")
				: layoutInlineWith(input, size.width);
			const dominant = dominantOf(rs);
			// Each line gets the box ITS OWN spans ask for, not the node's tallest.
			// Line height varies within a text node as freely as size does — a
			// signature block set to 132% on its first line and Auto on the rest is
			// one node with two different line boxes — and using a single advance
			// stacks every later line where the first line's box would have put it.
			const measured = shaped.lines.map((sl) => {
				const fonts = sl.fragments.map((fr) => rs[fr.spanIndex].font);
				const tallest = fonts.reduce(
					(best, f) =>
						f.size * f.lineHeight > best.size * best.lineHeight ? f : best,
					fonts[0] ?? dominant,
				);
				const boxPx = tallest.size * tallest.lineHeight;
				return {
					shaped: sl,
					font: tallest,
					boxPx,
					// Pixel-rounded like Figma, so a paragraph doesn't drift sub-pixel.
					advance: snapToDevice(boxPx, deviceScale),
					baseOffset: baselineOffset(tallest, boxPx, leadingTrim, metricsMap),
				};
			});
			const gaps = paragraphGaps(shaped.lines) * align.spacing;
			const totalHeight =
				(sum(measured.map((l) => l.boxPx)) ||
					dominant.size * dominant.lineHeight) + gaps;
			return { measured, gaps, totalHeight };
		};

		let shapedSet = shape(resolved);
		let shrinkApplied = false;
		// Shrink scales every span by the same factor, searching on the largest
		// span's whole-pixel size the way single-style text searches its own.
		const top = dominantFont.size;
		if (
			fit === "shrink" &&
			top >= SHRINK_FLOOR_PX &&
			shapedSet.totalHeight > size.height
		) {
			const scaled = (target: number) =>
				authored.map((r) => ({
					...r,
					font: scaleFont(r.font, target / top),
				}));
			let lo = SHRINK_FLOOR_PX;
			let hi = Math.floor(top) === top ? top - 1 : Math.floor(top);
			let best: { rs: typeof authored; set: typeof shapedSet } | null = null;
			while (lo <= hi) {
				const mid = Math.floor((lo + hi) / 2);
				const rs = scaled(mid);
				const set = shape(rs);
				if (set.totalHeight <= size.height) {
					best = { rs, set };
					lo = mid + 1;
				} else {
					hi = mid - 1;
				}
			}
			const chosen = best ?? {
				rs: scaled(SHRINK_FLOOR_PX),
				set: shape(scaled(SHRINK_FLOOR_PX)),
			};
			resolved = chosen.rs;
			shapedSet = chosen.set;
			shrinkApplied = true;
			dominantFont = dominantOf(resolved);
			lineHeightPx = dominantFont.size * dominantFont.lineHeight;
			baseOffset = baselineOffset(
				dominantFont,
				lineHeightPx,
				leadingTrim,
				metricsMap,
			);
		}

		const { measured: measuredLines, gaps } = shapedSet;
		const advances = measuredLines.map((l) => l.advance);
		const firstOffset = measuredLines[0]?.baseOffset ?? baseOffset;
		const contentHeight =
			(leadingTrim
				? firstOffset + sum(advances.slice(1))
				: sum(advances) || snapToDevice(lineHeightPx, deviceScale)) + gaps;
		const startY = startYForVAlign(
			verticalAlign,
			pos.y,
			size.height,
			contentHeight,
		);
		let cursorY = startY;
		const lines: TextLine[] = measuredLines.map((ml, i) => {
			const sl = ml.shaped;
			const text = sl.fragments.map((f) => f.text).join("");
			const placed = placeLine(
				align,
				i === measuredLines.length - 1 || sl.hardBreak === true,
				text,
				pos.x,
				size.width,
				sl.width,
			);
			const ws = placed.wordSpacing ?? 0;
			const y = cursorY;
			cursorY +=
				ml.advance +
				(sl.hardBreak && i < measuredLines.length - 1 ? align.spacing : 0);
			const spansOut: TextLineSpan[] = spreadFragments(sl.fragments, ws).map(
				(fr) => ({
					text: fr.text,
					x: placed.x + fr.x,
					width: fr.width,
					font: resolved[fr.spanIndex].font,
					color: resolved[fr.spanIndex].color,
				}),
			);
			return {
				text,
				y,
				baseline: y + ml.baseOffset,
				...(ws ? { wordSpacing: ws } : {}),
				...(align.rtl ? { direction: "rtl" as const } : {}),
				spans: spansOut,
			};
		});
		return {
			font: dominantFont,
			lines,
			totalHeight: shapedSet.totalHeight,
			shrinkApplied,
		};
	}

	// Fallback: independent per-span widths, single line, no wrap.
	const widths = resolved.map((r) => engine.measureSpanWidth(r.text, r.font));
	const totalWidth = widths.reduce((s, w) => s + w, 0);
	const startY = startYForVAlign(
		verticalAlign,
		pos.y,
		size.height,
		lineHeightPx,
	);
	const lineX = xForAlign(
		align.align === "justify" ? align.last : align.align,
		pos.x,
		size.width,
		totalWidth,
	);

	let cursor = lineX;
	const spanLayouts: TextLineSpan[] = resolved.map((r, i) => {
		const out: TextLineSpan = {
			text: r.text,
			x: cursor,
			width: widths[i],
			font: r.font,
			color: r.color,
		};
		cursor += widths[i];
		return out;
	});

	return {
		font: dominantFont,
		lines: [
			{
				text: resolved.map((r) => r.text).join(""),
				y: startY,
				baseline: startY + baseOffset,
				spans: spanLayouts,
			},
		],
		totalHeight: lineHeightPx,
		shrinkApplied: false,
	};
}

// ─────────────── alignment ───────────────

type PhysicalAlign = "left" | "center" | "right" | "justify";

type ParagraphStyle = {
	align: PhysicalAlign;
	last: PhysicalAlign;
	rtl: boolean;
	// Extra advance after a line that ends a paragraph, snapped like a line's.
	spacing: number;
};

function physicalAlign(
	align: NonNullable<TextNode["align"]>,
	rtl: boolean,
): PhysicalAlign {
	if (align === "start") return rtl ? "right" : "left";
	if (align === "end") return rtl ? "left" : "right";
	return align;
}

const RTL_SCRIPT =
	/[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]/u;

// The direction of the first strong (letter) character, as HTML's dir="auto"
// picks it. Text with no letters is ltr.
export function resolveDirection(text: string): "ltr" | "rtl" {
	const first = text.match(/\p{L}/u)?.[0];
	return first && RTL_SCRIPT.test(first) ? "rtl" : "ltr";
}

// A line's left edge and painted width, plus the word spacing that stretches a
// justified line to the box. A justified paragraph's last line takes `last`,
// and a line with no space to stretch falls back to start.
function placeLine(
	align: ParagraphStyle,
	endsParagraph: boolean,
	text: string,
	boxX: number,
	boxWidth: number,
	lineWidth: number,
): { x: number; width: number; wordSpacing?: number } {
	const mode =
		align.align === "justify" && endsParagraph ? align.last : align.align;
	if (mode === "justify") {
		const gaps = countSpaces(text);
		if (gaps > 0 && lineWidth < boxWidth)
			return {
				x: boxX,
				width: boxWidth,
				wordSpacing: (boxWidth - lineWidth) / gaps,
			};
		return {
			x: xForAlign(align.rtl ? "right" : "left", boxX, boxWidth, lineWidth),
			width: lineWidth,
		};
	}
	return { x: xForAlign(mode, boxX, boxWidth, lineWidth), width: lineWidth };
}

function countSpaces(text: string): number {
	let n = 0;
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 32) n++;
	return n;
}

// Shift and widen a line's fragments by the word spacing of every space that
// sits to their left (visually, so it holds for either direction).
function spreadFragments<F extends { text: string; x: number; width: number }>(
	fragments: F[],
	wordSpacing: number,
): F[] {
	if (!wordSpacing) return fragments;
	const order = fragments
		.map((f, i) => ({ f, i }))
		.sort((a, b) => a.f.x - b.f.x);
	const out = fragments.slice();
	let before = 0;
	for (const { f, i } of order) {
		const own = countSpaces(f.text) * wordSpacing;
		out[i] = { ...f, x: f.x + before, width: f.width + own };
		before += own;
	}
	return out;
}

function xForAlign(
	align: "left" | "center" | "right" | "justify",
	boxX: number,
	boxWidth: number,
	lineWidth: number,
): number {
	if (align === "center") return boxX + (boxWidth - lineWidth) / 2;
	if (align === "right") return boxX + boxWidth - lineWidth;
	return boxX;
}

function startYForVAlign(
	va: "top" | "middle" | "bottom",
	boxY: number,
	boxHeight: number,
	layoutHeight: number,
): number {
	// When content overflows the box, aligning would push its start above the box
	// top (middle/bottom) so a clip shows only the tail. Pin to the top instead so
	// the START of the text stays visible; alignment applies only when it fits.
	if (layoutHeight > boxHeight) return boxY;
	if (va === "middle") return boxY + (boxHeight - layoutHeight) / 2;
	if (va === "bottom") return boxY + boxHeight - layoutHeight;
	return boxY;
}
