import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { TextLayoutInput } from "../src/text-types";

const FONT = testFontPath("Geist-Regular.ttf");
const font = {
	family: "Geist",
	size: 18,
	weight: 400,
	style: "normal" as const,
	lineHeight: 1.2,
};

const fonts = () => new Map([["Geist", [new Uint8Array(readFileSync(FONT))]]]);

let ck: any;
let engine: ReturnType<typeof createParagraphEngine>;
let shapes = 0;

beforeAll(async () => {
	ck = await loadCanvasKit();
	const make = ck.ParagraphBuilder.MakeFromFontCollection;
	ck.ParagraphBuilder.MakeFromFontCollection = (style: any, fc: any) => {
		shapes++;
		return make(style, fc);
	};
	engine = createParagraphEngine(
		ck,
		new Map([["Geist", [new Uint8Array(readFileSync(FONT))]]]),
	);
});
afterAll(() => engine?.dispose());

const text = "A heading that wraps across a narrow box more than once";

const input = (
	size: number,
	maxHeight: number,
	fit?: "shrink",
): TextLayoutInput => ({
	value: text,
	font: { ...font, size },
	maxWidth: 140,
	maxHeight,
	lineHeight: 1.2,
	fit,
});

describe("shaping memo", () => {
	test("repeated measures of the same box shape once", () => {
		shapes = 0;
		const a = engine.measureText(text, font, null);
		const b = engine.measureText(text, font, null);
		const c = engine.measureText(text, font, 140);
		const d = engine.measureText(text, font, 140);
		expect(b).toEqual(a);
		expect(d).toEqual(c);
		expect(shapes).toBe(2);
	});

	test("a wrapped measure and the layout at its width share a shape", () => {
		const measured = engine.measureText(text, { ...font, size: 19 }, 150);
		shapes = 0;
		const laid = engine.layoutText({
			...input(19, 1000),
			maxWidth: 150,
		});
		expect(shapes).toBe(0);
		expect(laid.lines.reduce((w, l) => Math.max(w, l.width), 0)).toBe(
			measured.width,
		);
	});

	test("different widths and fonts do not collide", () => {
		const narrow = engine.measureText(text, font, 100);
		const wide = engine.measureText(text, font, 400);
		const big = engine.measureText(text, { ...font, size: 30 }, 100);
		expect(narrow.height).toBeGreaterThan(wide.height);
		expect(big.height).toBeGreaterThan(narrow.height);
	});
});

// The bisection the shrink search replaced, over the same trial function.
function bisect(
	lo: number,
	hi: number,
	fits: (size: number) => boolean,
): { size: number; shapes: number } {
	let shapes = 0;
	let best = lo;
	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		shapes++;
		if (fits(mid)) {
			best = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return { size: best, shapes };
}

describe("shrink search", () => {
	test("lands where bisecting the range does, in fewer shapes", () => {
		const other = createParagraphEngine(ck, fonts());
		let seeded = 0;
		let bisected = 0;
		for (const size of [14, 24, 40, 72, 72.5, 120])
			for (const maxHeight of [20, 45, 80, 140, 300]) {
				const base = input(size, maxHeight);
				if (other.layoutText(base).totalHeight <= maxHeight) continue;
				const ref = bisect(
					8,
					Math.ceil(size) - 1,
					(s) =>
						other.layoutText({ ...base, font: { ...font, size: s } })
							.totalHeight <= maxHeight,
				);
				shapes = 0;
				const mine = createParagraphEngine(ck, fonts());
				const fitted = mine.layoutText({ ...base, fit: "shrink" });
				mine.dispose();
				seeded += shapes;
				bisected += ref.shapes + 1;
				expect(fitted.effectiveFontSize).toBe(ref.size);
			}
		other.dispose();
		expect(seeded).toBeLessThan(bisected);
	});
});
