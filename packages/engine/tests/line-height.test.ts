// AUTO line height: the font's own line box, resolved per family at compile.
// A design tool's "Auto" is not a constant — Vend Sans is 1.48 — so a font
// marked `autoLineHeight` carries only a fallback number until the metrics for
// its family turn up.
import { readFileSync } from "node:fs";
import { loadCanvasKit, testFontPath } from "@freshcoat-js/test-utils";
import { describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { autoLineHeight, FALLBACK_LINE_HEIGHT } from "../src/line-height";
import { createFrame, createText } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
import type { DrawTextCommand } from "../src/types";

// A woff2 — the format a browser is served, and the one readFontMetrics cannot
// parse, so this also covers the engine-probed metrics path.
const VARIABLE = testFontPath("VendSans-Variable-latin.woff2");
// Vend Sans: typo ascent 1.09 + descent 0.39, no line gap.
const VEND_SANS_AUTO = 1.48;

const scene = () =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 400, height: 200 },
		children: [
			createText({
				pos: { x: 0, y: 0 },
				size: { width: 400, height: 200 },
				text: "one two three four five six seven eight nine ten eleven twelve",
				font: {
					family: "Vend Sans",
					weight: 400,
					style: "normal",
					size: 50,
					lineHeight: FALLBACK_LINE_HEIGHT,
					autoLineHeight: true,
				},
				color: "#000000",
			}),
		],
	});

// The distance between two baked baselines, in px — the line box the bake used.
const bakedLineAdvance = (
	commands: ReturnType<typeof compileScene>,
): number => {
	const group = commands.find((c) => "op" in c && c.op === "drawGroup") as {
		children: DrawTextCommand[];
	};
	const text = group.children[0];
	const [a, b] = text.layout.lines;
	if (!a?.baseline || !b?.baseline)
		throw new Error("expected a wrapped layout");
	return b.baseline - a.baseline;
};

describe("autoLineHeight", () => {
	test("is the font's own line box, and the fallback when it is unknown", () => {
		expect(
			autoLineHeight({
				ascent: 1.09,
				descent: 0.39,
				lineGap: 0,
				capHeight: 0.7,
			}),
		).toBeCloseTo(VEND_SANS_AUTO, 5);
		expect(
			autoLineHeight({
				ascent: 0.8,
				descent: 0.2,
				lineGap: 0.1,
				capHeight: 0.7,
			}),
		).toBeCloseTo(1.1, 5);
		expect(autoLineHeight(undefined)).toBe(FALLBACK_LINE_HEIGHT);
	});
});

describe("compileScene with an AUTO line height", () => {
	test("bakes the font's line box, read through the engine when the bytes are woff2", async () => {
		const ck = await loadCanvasKit();
		const fonts = new Map([
			["Vend Sans", [new Uint8Array(readFileSync(VARIABLE))]],
		]);
		const textEngine = createParagraphEngine(ck, fonts);
		try {
			const commands = compileScene(scene(), {
				width: 400,
				height: 200,
				textEngine,
			});
			expect(bakedLineAdvance(commands)).toBe(Math.round(50 * VEND_SANS_AUTO));
		} finally {
			textEngine.dispose();
		}
	});

	test("keeps the fallback for a family nothing knows the metrics of", async () => {
		const ck = await loadCanvasKit();
		const fonts = new Map([
			["Vend Sans", [new Uint8Array(readFileSync(VARIABLE))]],
		]);
		const textEngine = createParagraphEngine(ck, fonts);
		try {
			const unknown = scene();
			// Same tree, a family the engine was never given bytes for.
			const text = (unknown as { children: { font: { family: string } }[] })
				.children[0];
			text.font.family = "Nothing Sans";
			const commands = compileScene(unknown, {
				width: 400,
				height: 200,
				textEngine,
			});
			expect(bakedLineAdvance(commands)).toBe(
				Math.round(50 * FALLBACK_LINE_HEIGHT),
			);
		} finally {
			textEngine.dispose();
		}
	});

	test("an explicit line height is left alone", async () => {
		const ck = await loadCanvasKit();
		const fonts = new Map([
			["Vend Sans", [new Uint8Array(readFileSync(VARIABLE))]],
		]);
		const textEngine = createParagraphEngine(ck, fonts);
		try {
			const authored = scene();
			const text = (
				authored as {
					children: {
						font: { lineHeight: number; autoLineHeight?: boolean };
					}[];
				}
			).children[0];
			text.font.lineHeight = 2;
			text.font.autoLineHeight = undefined;
			const commands = compileScene(authored, {
				width: 400,
				height: 200,
				textEngine,
			});
			expect(bakedLineAdvance(commands)).toBe(100);
		} finally {
			textEngine.dispose();
		}
	});
});
