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
