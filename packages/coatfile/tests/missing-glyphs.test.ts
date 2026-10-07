import { createParagraphEngine, memoizeTextEngine } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { findMissingGlyphs } from "../src/render";
import type { Template } from "../src/types";

const text = (id: string, y: number) => ({
	id,
	type: "text",
	pos: { x: 2, y },
	size: { width: 200, height: 20 },
	properties: { value: `{{${id}}}`, font: { family: "Geist", size: 12 } },
});

const side = (name: string, ids: string[]) => ({
	name,
	background: {
		id: `${name}-bg`,
		type: "rect",
		pos: { x: 0, y: 0 },
		size: { width: 240, height: 80 },
		properties: { fill: "#ffffff" },
	},
	elements: ids.map((id, i) => text(id, 2 + i * 24)),
});

const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	product: "test",
	width: 240,
	height: 80,
	fields: {
		type: "object",
		properties: {
			name: { type: "string" },
			city: { type: "string" },
			motto: { type: "string" },
		},
	},
	template_data: [side("front", ["name", "city"]), side("back", ["motto"])],
} as unknown as Template;

let engine: ReturnType<typeof memoizeTextEngine>;

beforeAll(async () => {
	const ck = await loadCanvasKit();
	engine = memoizeTextEngine(
		createParagraphEngine(
			ck,
			new Map([["Geist", [testFontBytes("Geist-Regular.ttf")]]]),
		),
	);
});

const check = (values: Record<string, string>, frameNames?: string[]) =>
	findMissingGlyphs(
		compile(template, values, { width: 240, height: 80 }),
		frameNames ? { textEngine: engine, frameNames } : { textEngine: engine },
	);

describe("findMissingGlyphs", () => {
	test("reports merged values the fonts can't draw, per frame and element", () => {
		expect(
			check({ name: "Hana 山田", city: "Kyoto", motto: "Ship it 🚀" }),
		).toEqual([
			{ frame: "front", id: "name", text: "Hana 山田", codepoints: [0x5c71, 0x7530] },
			{ frame: "back", id: "motto", text: "Ship it 🚀", codepoints: [0x1f680] },
		]);
	});

	test("a covered record reports nothing", () => {
		expect(check({ name: "Ana", city: "Lisbon", motto: "Olá" })).toEqual([]);
	});

	test("frameNames limits the frames checked", () => {
		expect(
			check({ name: "山", city: "", motto: "🚀" }, ["back"]).map((m) => m.id),
		).toEqual(["motto"]);
	});
});
