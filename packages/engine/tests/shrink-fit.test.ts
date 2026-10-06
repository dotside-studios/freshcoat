import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { TextLayoutInput } from "../src/text-types";

const FONT = testFontPath("Geist-Regular.ttf");

let ck: any;
let engine: ReturnType<typeof createParagraphEngine>;
const shaped: number[] = [];

beforeAll(async () => {
	ck = await loadCanvasKit();
	const make = ck.ParagraphBuilder.MakeFromFontProvider;
	ck.ParagraphBuilder.MakeFromFontProvider = (style: any, provider: any) => {
		shaped.push(style.textStyle.fontSize);
		return make(style, provider);
	};
	engine = createParagraphEngine(
		ck,
		new Map([["Geist", [new Uint8Array(readFileSync(FONT))]]]),
	);
});
afterAll(() => engine?.dispose());

const input = (
	size: number,
	maxHeight: number,
	fit?: "shrink",
): TextLayoutInput => ({
	value: "A heading that wraps across a narrow box more than once",
	font: { family: "Geist", size, weight: 400 },
	maxWidth: 140,
	maxHeight,
	lineHeight: 1.2,
	fit,
});

// The largest whole size from the floor up to below `size` that fits.
function exhaustive(size: number, maxHeight: number): number {
	for (let s = Math.ceil(size) - 1; s >= 8; s--)
		if (engine.layoutText(input(s, maxHeight)).totalHeight <= maxHeight)
			return s;
	return 8;
}

describe("shrink to fit", () => {
	test("never shapes the full size twice", () => {
		shaped.length = 0;
		const out = engine.layoutText(input(20, 1000));
		const height = out.totalHeight - 0.01;
		shaped.length = 0;
		const fitted = engine.layoutText(input(20, height, "shrink"));
		expect(fitted.shrinkApplied).toBe(true);
		expect(shaped.filter((s) => s === 20)).toHaveLength(1);
	});

	test("lands on the largest size that fits", () => {
		for (const size of [12, 20, 20.5, 31])
			for (const maxHeight of [10, 30, 45, 60, 90, 120]) {
				const full = engine.layoutText(input(size, maxHeight));
				if (full.totalHeight <= maxHeight) continue;
				const fitted = engine.layoutText(input(size, maxHeight, "shrink"));
				expect(fitted.effectiveFontSize).toBe(exhaustive(size, maxHeight));
			}
	});
});
