import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { bakeText } from "../src/bake-text";
import { createText, type TextNode } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { ResolvedFont } from "../src/types";

const FONT = testFontPath("Geist-Regular.ttf");

const font: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 20,
	lineHeight: 1.2,
	letterSpacing: 2,
};

let engine: ReturnType<typeof createParagraphEngine>;

beforeAll(async () => {
	const ck = await loadCanvasKit();
	engine = createParagraphEngine(
		ck,
		new Map([["Geist", [new Uint8Array(readFileSync(FONT))]]]),
	);
});
afterAll(() => engine?.dispose());

const SPANS: TextNode["spans"] = [
	{ text: "A heading that runs long ", font: { size: 40 } },
	{ text: "and a body in a smaller size that wraps across the box" },
];

const bake = (p: Partial<TextNode>) =>
	bakeText(
		createText({
			pos: { x: 0, y: 0 },
			size: { width: 240, height: 80 },
			font,
			color: "#000000",
			spans: SPANS,
			leadingTrim: false,
			...p,
		}),
		{ textEngine: engine },
	);

describe("shrink-to-fit with spans", () => {
	test("scales every span by the same factor until the text fits", () => {
		const full = bake({});
		expect(full.totalHeight).toBeGreaterThan(80);
		expect(full.shrinkApplied).toBe(false);

		const shrunk = bake({ fit: "shrink" });
		expect(shrunk.shrinkApplied).toBe(true);
		expect(shrunk.totalHeight).toBeLessThanOrEqual(80);
		const heading = shrunk.lines[0].spans[0].font;
		expect(heading.size).toBeLessThan(40);
		expect(Number.isInteger(heading.size)).toBe(true);
		const body = shrunk.lines.at(-1)!.spans.at(-1)!.font;
		expect(body.size / heading.size).toBeCloseTo(0.5, 5);
		expect(body.letterSpacing! / body.size).toBeCloseTo(2 / 20, 5);
		expect(shrunk.font.size).toBe(heading.size);
	});

	test("picks the largest whole size that fits", () => {
		const heading = bake({ fit: "shrink" }).lines[0].spans[0].font.size;
		const k = (heading + 1) / 40;
		const oneLarger = bake({
			font: { ...font, size: 20 * k, letterSpacing: 2 * k },
			spans: [{ ...SPANS[0], font: { size: heading + 1 } }, SPANS[1]],
		});
		expect(oneLarger.totalHeight).toBeGreaterThan(80);
	});

	test("leaves text that already fits alone", () => {
		const roomy = bake({ fit: "shrink", size: { width: 240, height: 400 } });
		expect(roomy.shrinkApplied).toBe(false);
		expect(roomy.lines[0].spans[0].font.size).toBe(40);
	});
});
