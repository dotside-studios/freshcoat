import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import CanvasKitInit from "canvaskit-wasm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { bakeText } from "../src/bake-text";
import { createText, type TextNode } from "../src/node";
import { createParagraphEngine } from "../src/paragraph-layout";
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
	lineHeight: 1.2,
};
const PARAGRAPH =
	"The quick brown fox jumps over the lazy dog and keeps running far away";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
let engine: ReturnType<typeof createParagraphEngine>;

beforeAll(async () => {
	ck = await (CanvasKitInit as (o: unknown) => Promise<unknown>)({
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
		pos: { x: 10, y: 0 },
		size: { width: 240, height: 400 },
		font,
		color: "#000000",
		align: "justify",
		...p,
	});

// The width the painter shapes a baked line to: the same text and word spacing.
function paintedWidth(text: string, wordSpacing = 0): number {
	const provider = ck.TypefaceFontProvider.Make();
	const bytes = readFileSync(FONT);
	provider.registerFont(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		"Geist",
	);
	const builder = ck.ParagraphBuilder.MakeFromFontProvider(
		new ck.ParagraphStyle({
			textStyle: { fontFamilies: ["Geist"], fontSize: 20, wordSpacing },
		}),
		provider,
	);
	builder.addText(text);
	const para = builder.build();
	para.layout(1e6);
	const w = para.getLongestLine();
	para.delete();
	builder.delete();
	provider.delete();
	return w;
}

describe("justified text", () => {
	test("stretches every line but the last to the box", () => {
		const layout = bakeText(node({ text: PARAGRAPH }), { textEngine: engine });
		expect(layout.lines.length).toBeGreaterThan(2);
		const body = layout.lines.slice(0, -1);
		for (const line of body) {
			expect(line.wordSpacing).toBeGreaterThan(0);
			expect(line.spans[0].x).toBe(10);
			expect(line.spans[0].width).toBe(240);
			expect(paintedWidth(line.text, line.wordSpacing)).toBeCloseTo(240, 0);
		}
		const last = layout.lines.at(-1)!;
		expect(last.wordSpacing).toBeUndefined();
		expect(last.spans[0].x).toBe(10);
	});

	test("alignLast sets the last line", () => {
		const layout = bakeText(node({ text: PARAGRAPH, alignLast: "right" }), {
			textEngine: engine,
		});
		const last = layout.lines.at(-1)!.spans[0];
		expect(last.x + last.width).toBeCloseTo(250, 5);
		const justified = bakeText(
			node({ text: `${PARAGRAPH} now`, alignLast: "justify" }),
			{ textEngine: engine },
		);
		expect(justified.lines.at(-1)!.text).toContain(" ");
		expect(justified.lines.at(-1)!.spans[0].width).toBe(240);
	});

	test("a line with nowhere to stretch keeps its width", () => {
		const layout = bakeText(node({ text: "Word" }), { textEngine: engine });
		expect(layout.lines[0].wordSpacing).toBeUndefined();
		expect(layout.lines[0].spans[0].x).toBe(10);
	});

	test("spreads styled fragments by the spaces before them", () => {
		const layout = bakeText(
			node({
				spans: [
					{ text: "The quick brown fox jumps " },
					{ text: "over the lazy dog", font: { weight: 700 } },
					{ text: " and keeps running far away" },
				],
			}),
			{ textEngine: engine },
		);
		const first = layout.lines[0];
		expect(first.wordSpacing).toBeGreaterThan(0);
		const spans = first.spans;
		const right = spans.at(-1)!;
		expect(right.x + right.width).toBeCloseTo(250, 0);
		for (let i = 1; i < spans.length; i++)
			expect(spans[i].x).toBeCloseTo(spans[i - 1].x + spans[i - 1].width, 0);
	});
});
