import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import {
	compileScene,
	createFrame,
	createGroup,
	createText,
	missingGlyphs,
} from "../src/index";
import { createParagraphEngine } from "../src/paragraph-layout";
import { memoizeTextEngine } from "../src/text-cache";
import type { TextEngine } from "../src/text-engine";
import type { ResolvedFont } from "../src/types";

const FONT: ResolvedFont = {
	family: "Geist",
	size: 16,
	weight: 400,
	style: "normal",
	lineHeight: 1.2,
};

let engine: TextEngine & { dispose(): void };

beforeAll(async () => {
	const ck = await loadCanvasKit();
	engine = createParagraphEngine(
		ck,
		new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]),
	);
});

const layout = (value: string) =>
	engine.layoutText({
		value,
		font: FONT,
		maxWidth: 400,
		maxHeight: 100,
		lineHeight: 1.2,
		fit: undefined,
	});

const scene = (...children: ReturnType<typeof createText>[]) =>
	createFrame({
		pos: { x: 0, y: 0 },
		size: { width: 400, height: 200 },
		children: [createGroup(children)],
	});

const text = (id: string, value: string, extra = {}) =>
	createText({
		id,
		pos: { x: 0, y: 0 },
		size: { width: 400, height: 40 },
		font: FONT,
		...(value ? { text: value } : {}),
		...extra,
	});

describe("unresolved codepoints", () => {
	test("layoutText reports CJK and emoji in text order", () => {
		expect(layout("Hi 漢字 😀").missing).toEqual([0x6f22, 0x5b57, 0x1f600]);
	});

	test("covered text reports nothing", () => {
		expect(layout("Hello, world").missing).toBeUndefined();
	});

	test("a repeated character is reported once", () => {
		expect(layout("字 and 字").missing).toEqual([0x5b57]);
	});

	test("layoutInline reports across spans", () => {
		const out = engine.layoutInline?.(
			[
				{ text: "Name: ", font: FONT },
				{ text: "李", font: { ...FONT, weight: 700 } },
			],
			400,
		);
		expect(out?.missing).toEqual([0x674e]);
	});

	test("the memoized engine keeps the report on a cache hit", () => {
		const cached = memoizeTextEngine(engine);
		const input = {
			value: "😀",
			font: FONT,
			maxWidth: 400,
			maxHeight: 100,
			lineHeight: 1.2,
			fit: undefined,
		};
		cached.layoutText(input);
		expect(cached.layoutText(input).missing).toEqual([0x1f600]);
		expect(cached.cacheStats().hits).toBe(1);
	});
});

describe("missingGlyphs", () => {
	test("names each text command with characters the fonts lack", () => {
		const commands = compileScene(
			scene(text("name", "Zoë 李"), text("title", "Engineer")),
			{ width: 400, height: 200, textEngine: engine },
		);
		expect(missingGlyphs(commands)).toEqual([
			{ id: "name", text: "Zoë 李", codepoints: [0x674e] },
		]);
	});

	test("styled spans are checked too", () => {
		const commands = compileScene(
			scene(
				text("greeting", "", {
					spans: [
						{ text: "Hello " },
						{ text: "世界", font: { weight: 700 } },
					],
				}),
			),
			{ width: 400, height: 200, textEngine: engine },
		);
		expect(missingGlyphs(commands)).toEqual([
			{ id: "greeting", text: "Hello 世界", codepoints: [0x4e16, 0x754c] },
		]);
	});

	test("characters cut by truncation are not reported", () => {
		const commands = compileScene(
			scene(
				text("bio", "Short line\n漢字 on a second line", {
					maxLines: 1,
				}),
			),
			{ width: 400, height: 200, textEngine: engine },
		);
		expect(missingGlyphs(commands)).toEqual([]);
	});
});
