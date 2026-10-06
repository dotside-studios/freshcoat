// Mixed-style text stacks each line by ITS OWN line box. A text node's line
// height varies per span as freely as its size does — a signature block set to
// 132% on the first line and Auto on the rest is one node with two line boxes —
// and advancing every line by the node's tallest span puts each later line where
// the first line's box would have ended.
import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { bakeText } from "../src/bake-text";
import { createText } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { ResolvedFont } from "../src/types";

const FONT = testFontPath("Geist-Regular.ttf");

const base: ResolvedFont = {
	family: "Geist",
	weight: 400,
	style: "normal",
	size: 20,
	lineHeight: 1,
};

// Three hard-wrapped lines; the middle span asks for a taller box.
const node = (middleLineHeight: number) =>
	createText({
		pos: { x: 0, y: 0 },
		size: { width: 400, height: 300 },
		font: base,
		color: "#000000",
		spans: [
			{ text: "first line\n" },
			{ text: "second line\n", font: { lineHeight: middleLineHeight } },
			{ text: "third line", font: { weight: 700 } },
		],
	});

describe("inline text with per-span line heights", () => {
	test("each line advances by its own box", async () => {
		const ck = await loadCanvasKit();
		const bytes = new Uint8Array(readFileSync(FONT));
		const textEngine = createParagraphEngine(ck, new Map([["Geist", [bytes]]]));
		try {
			const layout = bakeText(node(2), { textEngine, leadingTrim: false });
			expect(layout.lines).toHaveLength(3);
			const [a, b, c] = layout.lines.map((l) => l.y);
			// Line 1 is 20 tall (1 × 20), line 2 is 40 (2 × 20).
			expect(b - a).toBe(20);
			expect(c - b).toBe(40);
			// The taller line's own baseline sits lower within its box.
			const baselines = layout.lines.map((l) => (l.baseline ?? 0) - l.y);
			expect(baselines[1]).toBeGreaterThan(baselines[0] + 5);
			expect(baselines[2]).toBeCloseTo(baselines[0], 5);
		} finally {
			textEngine.dispose();
		}
	});

	test("uniform line heights stack uniformly, as before", async () => {
		const ck = await loadCanvasKit();
		const bytes = new Uint8Array(readFileSync(FONT));
		const textEngine = createParagraphEngine(ck, new Map([["Geist", [bytes]]]));
		try {
			const layout = bakeText(node(1), { textEngine, leadingTrim: false });
			const ys = layout.lines.map((l) => l.y);
			expect(ys[1] - ys[0]).toBe(20);
			expect(ys[2] - ys[1]).toBe(20);
			expect(layout.totalHeight).toBe(60);
		} finally {
			textEngine.dispose();
		}
	});
});
