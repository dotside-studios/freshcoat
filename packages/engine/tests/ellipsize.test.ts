import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { approxEngine } from "../src/approx-layout";
import { ellipsize } from "../src/bake-text";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { TextEngine } from "../src/text-engine";
import type { ResolvedFont } from "../src/types";

const FONT = testFontPath("Geist-Regular.ttf");

const font: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 16,
	lineHeight: 1.2,
};

const ELL = "…";

// The implementation ellipsize replaced: a binary search that reshapes a
// candidate string per step.
function bisect(text: string, maxWidth: number, engine: TextEngine): string {
	if (engine.measureText(`${text}${ELL}`, font, null).width <= maxWidth)
		return `${text}${ELL}`;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		const candidate = `${text.slice(0, mid).trimEnd()}${ELL}`;
		if (engine.measureText(candidate, font, null).width <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return `${text.slice(0, lo).trimEnd()}${ELL}`;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const boundaries = (text: string): Set<number> =>
	new Set(
		[...segmenter.segment(text)].map((s) => s.index + s.segment.length),
	).add(0);

// The longest grapheme-aligned prefix that fits, found by brute force.
function oracle(text: string, maxWidth: number, engine: TextEngine): string {
	const fits = (s: string) =>
		engine.measureText(`${s}${ELL}`, font, null).width <= maxWidth;
	if (fits(text)) return `${text}${ELL}`;
	let best = "";
	for (const end of boundaries(text)) {
		const prefix = text.slice(0, end).trimEnd();
		if (prefix.length > best.length && fits(prefix)) best = prefix;
	}
	return `${best}${ELL}`;
}

// Every glyph is font.size wide per UTF-16 code unit.
const stub: TextEngine = {
	measureText: (text, f) => ({
		width: text.length * f.size,
		height: f.size * f.lineHeight,
	}),
	measureSpanWidth: (text, f) => text.length * f.size,
	layoutText: () => {
		throw new Error("unused");
	},
	clusterAdvances: (text, f) =>
		[...segmenter.segment(text)].map((s) => ({
			end: s.index + s.segment.length,
			x: (s.index + s.segment.length) * f.size,
		})),
};

const CASES: { name: string; text: string }[] = [
	{ name: "ASCII", text: "The quick brown fox jumps over the lazy dog" },
	{ name: "ASCII with spaces", text: "a b c d e f g h i j k l m n o p" },
	{ name: "CJK", text: "東京都渋谷区神南一丁目二十三番十号のビル" },
	{
		name: "emoji",
		text: "Party 🎉🎉 time 👍🏽 with 👨‍👩‍👧‍👦 family 🇯🇵 flag",
	},
	{
		name: "combining marks",
		text: "Café naïve résumé á̂̃b",
	},
];

function widthsFor(text: string, engine: TextEngine): number[] {
	const ellW = engine.measureText(ELL, font, null).width;
	const full = engine.measureText(`${text}${ELL}`, font, null).width;
	const out = [0, 1, ellW / 2, ellW - 1, ellW, ellW + 1];
	for (let w = ellW + 2; w < full + 4; w += 3.7) out.push(w);
	return out;
}

let ck: TextEngine & { dispose(): void };

beforeAll(async () => {
	const bytes = new Uint8Array(readFileSync(FONT));
	const kit = await loadCanvasKit();
	// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
	ck = createParagraphEngine(kit as any, new Map([["Geist", [bytes]]]));
});

describe("ellipsize matches the binary search it replaced", () => {
	const engines: [string, () => TextEngine][] = [
		["stub", () => stub],
		["approx", () => approxEngine],
		["paragraph", () => ck],
	];
	for (const [engineName, get] of engines) {
		for (const { name, text } of CASES) {
			test(`${engineName}: ${name}`, () => {
				const engine = get();
				const cuts = boundaries(text);
				for (const w of widthsFor(text, engine)) {
					const got = ellipsize(text, font, w, engine);
					expect(got).toBe(oracle(text, w, engine));
					const old = bisect(text, w, engine);
					// The old search cut by code unit; where that landed on a cluster
					// boundary the results agree, elsewhere the new one does not split.
					if (cuts.has(old.length - ELL.length)) expect(got).toBe(old);
				}
			});
		}
	}

	test("a 5000 character line matches the binary search", () => {
		const text = "lorem ipsum   dolor sit amet ".repeat(173).slice(0, 5000);
		for (const engine of [stub, ck]) {
			for (const w of [40, 333.3, 1200, 20000]) {
				expect(ellipsize(text, font, w, engine)).toBe(bisect(text, w, engine));
			}
		}
	});

	test("widths below the ellipsis give the bare ellipsis", () => {
		for (const engine of [stub, approxEngine, ck]) {
			expect(ellipsize("Hello world", font, 0, engine)).toBe(ELL);
			expect(ellipsize("Hello world", font, 1, engine)).toBe(ELL);
		}
	});

	test("text that fits with the ellipsis is kept whole", () => {
		for (const engine of [stub, approxEngine, ck]) {
			expect(ellipsize("Hi", font, 1000, engine)).toBe(`Hi${ELL}`);
		}
	});

	test("trims trailing whitespace before the ellipsis", () => {
		const got = ellipsize("ab    cdefgh", font, 16 * 5, stub);
		expect(got).toBe(`ab${ELL}`);
	});

	test("engines without clusterAdvances fall back to binary search", () => {
		const { clusterAdvances: _, ...plain } = stub;
		for (const { text } of CASES) {
			for (const w of widthsFor(text, plain)) {
				expect(ellipsize(text, font, w, plain)).toBe(bisect(text, w, plain));
			}
		}
	});
});

describe("ellipsize shaping cost", () => {
	function counting(engine: TextEngine) {
		const calls = { n: 0 };
		const wrapped: TextEngine = {
			...engine,
			measureText: (...a) => {
				calls.n++;
				return engine.measureText(...a);
			},
			clusterAdvances: (...a) => {
				calls.n++;
				return engine.clusterAdvances!(...a);
			},
		};
		return { wrapped, calls };
	}

	for (const [name, get] of [
		["stub", () => stub],
		["approx", () => approxEngine],
		["paragraph", () => ck],
	] as const) {
		test(`${name}: shaping calls do not grow with text length`, () => {
			const counts = [10, 100, 1000, 10000].map((n) => {
				const text = "lorem ipsum ".repeat(n).trim();
				const { wrapped, calls } = counting(get());
				ellipsize(text, font, 200, wrapped);
				return calls.n;
			});
			expect(Math.max(...counts)).toBeLessThanOrEqual(5);
			expect(new Set(counts).size).toBe(1);
		});
	}
});
