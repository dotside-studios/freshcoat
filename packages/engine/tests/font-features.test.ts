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

const bake = (p: Partial<TextNode>) =>
	bakeText(
		createText({
			pos: { x: 0, y: 0 },
			size: { width: 400, height: 100 },
			font,
			color: "#000000",
			...p,
		}),
		{ textEngine: engine },
	);

// Geist's proportional "1" is narrow; tnum gives it a figure-wide advance.
describe("OpenType features", () => {
	test("tabular figures widen a run of ones", () => {
		const plain = bake({ text: "1111" }).lines[0].spans[0];
		const tabular = bake({
			text: "1111",
			font: { ...font, features: { tnum: 1 } },
		}).lines[0].spans[0];
		expect(tabular.width).toBeGreaterThan(plain.width + 10);
		expect(tabular.font.features).toEqual({ tnum: 1 });
	});

	test("a span's features merge over the element's", () => {
		const line = bake({
			font: { ...font, features: { tnum: 1, liga: 0 } },
			spans: [
				{ text: "1111 " },
				{ text: "1111", font: { features: { tnum: 0 } } },
			],
		}).lines[0];
		const [tabular, proportional] = line.spans;
		expect(tabular.font.features).toEqual({ tnum: 1, liga: 0 });
		expect(proportional.font.features).toEqual({ tnum: 0, liga: 0 });
		expect(proportional.width).toBeLessThan(tabular.width - 10);
	});
});
