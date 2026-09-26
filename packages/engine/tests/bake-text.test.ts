// Phase 1b: bakeText lays a TextNode's resolved text into a BakedTextLayout via
// an injected TextEngine — freshcoat owns glyph shaping, but no template. A
// deterministic stub engine (every glyph = font.size wide, char-count wrap)
// makes the placement math exact, and a registered cap-height fixes the baseline.
import { describe, expect, test } from "vitest";
import type { TextEngine } from "../src/index";
import { bakeText, createText } from "../src/index";
import type { FontVMetrics, ResolvedFont } from "../src/types";

// capHeight 0.7 → with leadingTrim (default), baseline = 0.7 * size.
const METRICS: Record<string, FontVMetrics> = {
	Stub: { ascent: 0.8, descent: 0.2, lineGap: 0, capHeight: 0.7 },
};

const font = (over: Partial<ResolvedFont> = {}): ResolvedFont => ({
	family: "Stub",
	weight: 400,
	style: "normal",
	size: 10,
	lineHeight: 1.2,
	...over,
});

// Char-count wrap: perLine = floor(maxWidth / size). Whitespace kept as-is.
function wrapChars(text: string, size: number, maxWidth: number) {
	const per = Math.max(1, Math.floor(maxWidth / size));
	const chars = [...text];
	const lines: { text: string; width: number }[] = [];
	for (let i = 0; i < chars.length; i += per) {
		const t = chars.slice(i, i + per).join("");
		lines.push({ text: t, width: t.length * size });
	}
	if (lines.length === 0) lines.push({ text: "", width: 0 });
	return lines;
}

const stub: TextEngine = {
	measureText: (text, f, maxWidth) => {
		const lh = f.size * f.lineHeight;
		if (maxWidth == null) return { width: text.length * f.size, height: lh };
		const lines = wrapChars(text, f.size, maxWidth);
		return {
			width: lines.reduce((m, l) => Math.max(m, l.width), 0),
			height: lines.length * lh,
		};
	},
	measureSpanWidth: (text, f) => text.length * f.size,
	layoutText: (input) => {
		const size = input.font.size;
		const lines = wrapChars(input.value, size, input.maxWidth);
		return {
			lines,
			totalHeight: lines.length * size * input.lineHeight,
			effectiveFontSize: size,
			shrinkApplied: false,
		};
	},
};

// A stub WITH cross-span shaping: one line, fragments placed left→right.
const stubInline: TextEngine = {
	...stub,
	layoutInline: (spans) => {
		let x = 0;
		const fragments = spans.map((s, spanIndex) => {
			const width = [...s.text].length * s.font.size;
			const fr = { spanIndex, text: s.text, x, width };
			x += width;
			return fr;
		});
		return { lines: [{ fragments, width: x }] };
	},
};

describe("bakeText — wrappable (single style)", () => {
	test("wraps by width; center-aligns; baseline from cap height", () => {
		const node = createText({
			pos: { x: 0, y: 0 },
			size: { width: 30, height: 100 },
			text: "abcdef",
			align: "center",
			font: font(),
		});
		const out = bakeText(node, { textEngine: stub, fontMetrics: METRICS });
		expect(out.lines.length).toBe(2); // perLine 3 → "abc","def"
		expect(out.lines[0].spans[0].text).toBe("abc");
		expect(out.lines[0].spans[0].x).toBe(0); // (30-30)/2
		expect(out.lines[0].baseline).toBe(7); // cap 0.7 * 10
		expect(out.lines[1].y).toBe(12); // lineAdvance round(10*1.2)
		expect(out.lines[1].baseline).toBe(19);
	});

	test("maxLines truncates + ellipsizes the last kept line", () => {
		const node = createText({
			pos: { x: 0, y: 0 },
			size: { width: 30, height: 100 },
			text: "abcdefghi",
			maxLines: 2,
			font: font(),
		});
		const out = bakeText(node, { textEngine: stub, fontMetrics: METRICS });
		expect(out.lines.length).toBe(2);
		expect(out.lines[1].spans[0].text).toBe("de…"); // "def" trimmed to fit 30
	});

	test("verticalAlign bottom seats content at the box bottom", () => {
		const node = createText({
			pos: { x: 0, y: 0 },
			size: { width: 30, height: 100 },
			text: "abc",
			verticalAlign: "bottom",
			font: font(),
		});
		const out = bakeText(node, { textEngine: stub, fontMetrics: METRICS });
		// contentHeight = baseline 7 (single line, leadingTrim) → startY = 100 - 7
		expect(out.lines[0].y).toBe(93);
	});
});

describe("bakeText — inline (multi style)", () => {
	test("engine path: fragments carry per-span x, font, color", () => {
		const node = createText({
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 40 },
			spans: [
				{ text: "AB" },
				{ text: "CD", font: { size: 20 }, color: "#f00" },
			],
			font: font(),
		});
		const out = bakeText(node, {
			textEngine: stubInline,
			fontMetrics: METRICS,
		});
		expect(out.lines.length).toBe(1);
		const [s0, s1] = out.lines[0].spans;
		expect(s0.x).toBe(0);
		expect(s0.color).toBe("#000"); // default
		expect(s1.x).toBe(20); // after "AB" = 2*10
		expect(s1.font.size).toBe(20);
		expect(s1.color).toBe("#f00");
		// dominant font (largest span) drives the layout font
		expect(out.font.size).toBe(20);
	});

	test("fallback path (no layoutInline): independent spans, single line", () => {
		const node = createText({
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 40 },
			spans: [{ text: "AB" }, { text: "CD", font: { size: 20 } }],
			font: font(),
		});
		const out = bakeText(node, { textEngine: stub, fontMetrics: METRICS });
		expect(out.lines.length).toBe(1);
		const [s0, s1] = out.lines[0].spans;
		expect(s0.x).toBe(0);
		expect(s1.x).toBe(20); // cursor advanced by measureSpanWidth("AB")
	});
});
