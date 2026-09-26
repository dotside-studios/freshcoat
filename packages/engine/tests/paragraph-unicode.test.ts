// The Paragraph engine slices per-line / per-span text by CanvasKit's
// getLineMetrics / getRectsForRange indices, which are UTF-16 code units. The
// risk with "fancy" Unicode isn't glyph coverage — it's that arithmetic
// splitting a surrogate pair, a combining sequence, or a ZWJ emoji cluster and
// corrupting the text. CanvasKit's ICU only offers break opportunities at
// cluster boundaries, so slicing there is safe; these tests LOCK that in.
//
// Font-independent by design: Geist renders most of these as .notdef boxes, but
// ICU still assigns codepoint properties + cluster boundaries, so the slicing
// paths are fully exercised. (A CJK/emoji font would additionally validate glyph
// rendering + realistic advances — not vendored here; none is available offline.)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { TextEngine } from "../src/text-engine";
import type { ResolvedFont } from "../src/types";

const CK_BIN = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"node_modules",
	"canvaskit-wasm",
	"bin",
);
const FONT = fileURLToPath(
	new URL("./fonts/Geist-Regular.ttf", import.meta.url),
);
const FAMILY = "UnicodeProbe";

let engine: TextEngine & { dispose(): void };

beforeAll(async () => {
	const bytes = new Uint8Array(readFileSync(FONT));
	const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
	engine = createParagraphEngine(ck as any, new Map([[FAMILY, [bytes]]]));
});

// Non-whitespace codepoints, in order — the invariant is that layout neither
// drops, duplicates, reorders, nor corrupts any of them.
const nonWs = (s: string): string =>
	[...s].filter((c) => !/\s/u.test(c)).join("");

// A lone (unpaired) surrogate — the signature of a slice that split an astral
// codepoint. Valid UTF-16 has none.
const hasLoneSurrogate = (s: string): boolean =>
	/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
		s,
	);

const CASES: { name: string; text: string }[] = [
	{
		name: "ZWJ family emoji",
		text: "AAA 👨‍👩‍👧‍👦 BBB CCC DDD EEE FFF GGG HHH",
	},
	{
		name: "regional-indicator flags",
		text: "start 🇺🇸🇯🇵🇬🇧 end more words to force a wrap here",
	},
	{
		name: "skin-tone modifiers",
		text: "like 👍🏽 and 🙋🏾‍♀️ done with several more words to wrap",
	},
	{
		name: "astral math alphanumerics",
		text: "𝐁𝐨𝐥𝐝 and 𝕏 and 𝓯𝓪𝓷𝓬𝔂 letters wrapping across lines",
	},
	{
		name: "CJK (break-anywhere)",
		text: "日本語のテキスト 中文文本測試 한국어 텍스트 more words",
	},
	{
		name: "Arabic RTL + Latin",
		text: "مرحبا بالعالم hello world مزيج of bidi text here",
	},
	{
		name: "combining diacritics",
		text: "café éléve naïve jalapẽo Å Ω words wrapping",
	},
	{
		name: "zero-width + soft hyphen",
		text: "aaa​bbb‌ccc­ddd⁠eee more words here",
	},
];

describe("Paragraph engine survives fancy Unicode (single-style)", () => {
	for (const c of CASES) {
		test(c.name, () => {
			const { lines } = engine.layoutText({
				value: c.text,
				font: { family: FAMILY, size: 20 },
				maxWidth: 130,
				maxHeight: Number.POSITIVE_INFINITY,
				lineHeight: 1.2,
				fit: undefined,
			});
			const joined = lines.map((l) => l.text).join("");
			expect(joined).not.toContain("�"); // no replacement char
			expect(hasLoneSurrogate(joined)).toBe(false); // valid UTF-16
			expect(nonWs(joined)).toBe(nonWs(c.text)); // nothing dropped/corrupted
		});
	}
});

describe("Paragraph engine survives fancy Unicode (multi-style spans)", () => {
	const SPAN_CASES: {
		name: string;
		spans: { text: string; weight: number }[];
	}[] = [
		{
			name: "emoji/astral at span boundaries",
			spans: [
				{ text: "Hello 👨‍👩‍👧‍👦", weight: 400 },
				{ text: "🇺🇸🇯🇵 world", weight: 700 },
				{ text: " 𝐁𝐨𝐥𝐝 and more text to wrap around here", weight: 400 },
			],
		},
		{
			name: "CJK + RTL + combining spans",
			spans: [
				{ text: "日本語 ", weight: 700 },
				{ text: "مرحبا ", weight: 400 },
				{ text: "café éé and extra words to force wrapping", weight: 400 },
			],
		},
	];

	for (const c of SPAN_CASES) {
		test(c.name, () => {
			const spans = c.spans.map((s) => ({
				text: s.text,
				font: { family: FAMILY, size: 22, weight: s.weight },
			}));
			const { lines } = engine.layoutInline!(spans, 190);
			const frags = lines.flatMap((l) => l.fragments);
			const joined = frags.map((f) => f.text).join("");
			const input = spans.map((s) => s.text).join("");

			expect(joined).not.toContain("�");
			expect(hasLoneSurrogate(joined)).toBe(false);
			expect(nonWs(joined)).toBe(nonWs(input));
			// every fragment maps back to a real span, and both weights survive
			expect(
				frags.every((f) => f.spanIndex >= 0 && f.spanIndex < spans.length),
			).toBe(true);
			const weights = new Set(
				frags.map((f) => spans[f.spanIndex]!.font.weight),
			);
			expect(weights.has(400) && weights.has(700)).toBe(true);
		});
	}
});

describe("measureText natural (hug) width does not wrap when baked", () => {
	// Regression: measureText(text, font, null) returned the raw getMaxIntrinsicWidth,
	// but laying a paragraph out at exactly that width wraps (CanvasKit breaks on >=),
	// so a hug-sized box wrapped/ellipsized. The natural width now rounds up.
	const FONT_18: ResolvedFont = {
		family: FAMILY,
		weight: 400,
		style: "normal",
		size: 18,
		lineHeight: 1.2,
	};
	for (const text of ["View this profile on", "@alexrivera", "Hello world"]) {
		test(`"${text}" stays on one line at its natural width`, () => {
			const { width } = engine.measureText(text, FONT_18, null);
			expect(Number.isInteger(width)).toBe(true);
			// Re-measured with that width as the bound, it must not wrap.
			const bounded = engine.measureText(text, FONT_18, width);
			expect(bounded.height).toBeCloseTo(FONT_18.size * FONT_18.lineHeight, 5);
		});
	}
});
