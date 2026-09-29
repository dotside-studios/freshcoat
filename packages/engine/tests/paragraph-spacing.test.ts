import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { approxEngine } from "../src/approx-layout";
import { bakeText } from "../src/bake-text";
import { createGroup, createText, type TextNode } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import { resolveLayout } from "../src/resolve-layout";
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

const font: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 20,
	lineHeight: 1,
};

let engine: ReturnType<typeof createParagraphEngine>;

beforeAll(async () => {
	const ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
		locateFile: (f: string) => join(CK_BIN, f),
	});
	engine = createParagraphEngine(
		ck,
		new Map([["Geist", [new Uint8Array(readFileSync(FONT))]]]),
	);
});
afterAll(() => engine?.dispose());

const node = (p: Partial<TextNode>) =>
	createText({
		pos: { x: 0, y: 0 },
		size: { width: 400, height: 300 },
		font,
		color: "#000000",
		leadingTrim: false,
		...p,
	});

const steps = (ys: number[]) => ys.slice(1).map((y, i) => y - ys[i]);

describe("hard line breaks", () => {
	test("a newline in single-style text breaks the line", () => {
		const layout = bakeText(node({ text: "One\nTwo  words\n\nFour" }), {
			textEngine: engine,
		});
		expect(layout.lines.map((l) => l.text)).toEqual([
			"One",
			"Two words",
			"",
			"Four",
		]);
	});

	test("the approximate engine breaks on newlines too", () => {
		const layout = bakeText(node({ text: "One\nTwo" }), {
			textEngine: approxEngine,
		});
		expect(layout.lines.map((l) => l.text)).toEqual(["One", "Two"]);
	});
});

describe("paragraph spacing", () => {
	test("opens after each hard break, not after a soft wrap", () => {
		const layout = bakeText(
			node({
				size: { width: 120, height: 300 },
				text: "First paragraph wraps here\nSecond",
				paragraphSpacing: 10,
			}),
			{ textEngine: engine },
		);
		const ys = layout.lines.map((l) => l.y);
		expect(ys.length).toBeGreaterThan(2);
		const expected = ys.slice(1).map(() => 20);
		expected[expected.length - 1] = 30;
		expect(steps(ys)).toEqual(expected);
		expect(layout.totalHeight).toBe(ys.length * 20 + 10);
	});

	test("spaces styled paragraphs the same way", () => {
		const layout = bakeText(
			node({
				spans: [
					{ text: "One\n" },
					{ text: "Two\n", font: { weight: 700 } },
					{ text: "Three" },
				],
				paragraphSpacing: 6,
			}),
			{ textEngine: engine },
		);
		expect(steps(layout.lines.map((l) => l.y))).toEqual([26, 26]);
	});

	test("counts toward bottom alignment", () => {
		const bottom = (paragraphSpacing: number) =>
			bakeText(
				node({ text: "One\nTwo", verticalAlign: "bottom", paragraphSpacing }),
				{ textEngine: engine },
			).lines[0].y;
		expect(bottom(0) - bottom(12)).toBe(12);
	});

	test("shrink-to-fit makes room for the gaps", () => {
		const shrink = (paragraphSpacing: number) =>
			bakeText(
				node({
					text: "One\nTwo",
					size: { width: 400, height: 40 },
					fit: "shrink",
					paragraphSpacing,
				}),
				{ textEngine: engine },
			);
		expect(shrink(0).shrinkApplied).toBe(false);
		const spaced = shrink(10);
		expect(spaced.shrinkApplied).toBe(true);
		expect(spaced.totalHeight).toBeLessThanOrEqual(40);
	});

	test("hugs the box around the gaps", () => {
		const text = node({
			text: "One\nTwo\nThree",
			paragraphSpacing: 8,
			layoutChild: { height: "hug" },
		});
		const root = resolveLayout(
			createGroup([text], {
				size: { width: 400, height: 300 },
				layout: { type: "flex", direction: "column" },
			}),
			{ measure: engine.measureText },
		);
		const hugged = (root as { children: TextNode[] }).children[0];
		expect(hugged.size?.height).toBe(3 * 20 + 2 * 8);
	});
});
