import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { createGroup, createText } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import { memoizeTextEngine } from "../src/text-cache";
import type { ResolvedFont } from "../src/types";

const FONT = testFontPath("Geist-Regular.ttf");

const font: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 24,
	lineHeight: 1.2,
};

// Every text path bakeText and resolveLayout take: wrapped, shrink-to-fit,
// truncated, mixed spans, and hug-sized text inside an auto-layout row.
function scene(label: string) {
	return createGroup(
		[
			createText({
				pos: { x: 10, y: 10 },
				size: { width: 200, height: 120 },
				font,
				color: "#111",
				text: `A paragraph that wraps across lines, ${label}`,
			}),
			createText({
				pos: { x: 220, y: 10 },
				size: { width: 120, height: 30 },
				font,
				color: "#111",
				text: "Shrinks to fit this box",
				fit: "shrink",
			}),
			createText({
				pos: { x: 360, y: 10 },
				size: { width: 140, height: 60 },
				font,
				color: "#111",
				text: "Truncated after two lines of text here",
				maxLines: 2,
			}),
			createText({
				pos: { x: 10, y: 150 },
				size: { width: 300, height: 100 },
				font,
				color: "#111",
				spans: [
					{ text: "Mixed " },
					{ text: "styles ", font: { weight: 700, size: 30 } },
					{ text: label },
				],
			}),
			createGroup(
				["one", "two", label].map((v) =>
					createText({
						pos: { x: 0, y: 0 },
						size: { width: 0, height: 0 },
						font,
						color: "#111",
						text: v,
						layoutChild: { width: "hug", height: "hug" },
					}),
				),
				{
					pos: { x: 10, y: 280 },
					size: { width: 500, height: 60 },
					layout: { type: "flex", direction: "row", gap: 12 },
				},
			),
		],
		{ pos: { x: 0, y: 0 }, size: { width: 600, height: 400 } },
	);
}

let engine: ReturnType<typeof createParagraphEngine>;

beforeAll(async () => {
	const ck = await loadCanvasKit();
	engine = createParagraphEngine(
		ck,
		new Map([["Geist", [new Uint8Array(readFileSync(FONT))]]]),
	);
});

const compile = (textEngine: typeof engine, label: string) =>
	compileScene(scene(label), { width: 600, height: 400, textEngine });

describe("memoizeTextEngine", () => {
	test("compiles exactly the commands the engine it wraps does", () => {
		const cached = memoizeTextEngine(engine);
		for (const label of ["first", "second", "first"])
			expect(compile(cached, label)).toEqual(compile(engine, label));
	});

	test("a repeated frame is answered from the cache", () => {
		const cached = memoizeTextEngine(engine);
		compile(cached, "frame");
		const cold = cached.cacheStats();
		compile(cached, "frame");
		const warm = cached.cacheStats();
		expect(warm.misses).toBe(cold.misses);
		expect(warm.hits).toBeGreaterThan(cold.hits);
	});

	test("only the text that changed is shaped again", () => {
		const cached = memoizeTextEngine(engine);
		compile(cached, "before");
		const a = cached.cacheStats().misses;
		compile(cached, "after");
		const b = cached.cacheStats().misses;
		compile(cached, "after");
		expect(b - a).toBeGreaterThan(0);
		expect(b - a).toBeLessThan(a);
		expect(cached.cacheStats().misses).toBe(b);
	});

	test("results are frozen so a caller cannot corrupt them", () => {
		const cached = memoizeTextEngine(engine);
		const layout = cached.layoutText({
			value: "Frozen",
			font,
			maxWidth: 200,
			maxHeight: 100,
			lineHeight: 1.2,
			fit: undefined,
		});
		expect(Object.isFrozen(layout)).toBe(true);
		expect(Object.isFrozen(layout.lines[0])).toBe(true);
	});

	test("evicts the least recently used entry past the limit", () => {
		const cached = memoizeTextEngine(engine, { maxEntries: 2 });
		cached.measureText("a", font, null);
		cached.measureText("b", font, null);
		cached.measureText("a", font, null);
		cached.measureText("c", font, null);
		const before = cached.cacheStats().misses;
		cached.measureText("a", font, null);
		expect(cached.cacheStats().misses).toBe(before);
		cached.measureText("b", font, null);
		expect(cached.cacheStats().misses).toBe(before + 1);
	});

	test("keeps the engine's own extras", () => {
		const cached = memoizeTextEngine(engine);
		expect(cached.metricsFor).toBe(engine.metricsFor);
		expect(typeof cached.dispose).toBe("function");
	});
});
