// @vitest-environment node
import type { Template } from "@freshcoat-js/coatfile";
import { createRenderer, type Renderer } from "@freshcoat-js/engine";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import {
	checkAllGlyphs,
	codepointLabel,
	type GlyphCheckItem,
	summarizeGlyphs,
} from "~/export/glyph-preflight";

const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "badge",
	name: "Badge",
	product: "test",
	width: 240,
	height: 60,
	fields: {
		type: "object",
		properties: { name: { type: "string" }, note: { type: "string" } },
	},
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 240, height: 60 },
				properties: { fill: "#ffffff" },
			},
			elements: ["name", "note"].map((id, i) => ({
				id,
				type: "text",
				pos: { x: 4, y: 4 + i * 28 },
				size: { width: 232, height: 24 },
				properties: {
					value: `{{${id}}}`,
					font: { family: "Geist", size: 14 },
				},
			})),
		},
	],
} as unknown as Template;

const item = (
	recordId: string,
	values: Record<string, string>,
): GlyphCheckItem => ({ recordId, side: "front", values });

const ITEMS = [
	item("r1", { name: "Ada Lovelace", note: "Analyst" }),
	item("r2", { name: "김민준", note: "Seoul" }),
	item("r3", { name: "Zoë", note: "Ships 🚀 fast" }),
];

let renderer: Renderer;

beforeAll(async () => {
	renderer = await createRenderer({
		ck: await loadCanvasKit(),
		fonts: { Geist: [testFontBytes("Geist-Regular.ttf")] },
		cache: false,
	});
});

describe("checkAllGlyphs", () => {
	test("lists each record and element whose text the fonts can't draw", async () => {
		const issues = await checkAllGlyphs(template, ITEMS, renderer);
		expect(issues).toEqual([
			{
				recordId: "r2",
				side: "front",
				elementId: "name",
				text: "김민준",
				codepoints: [0xae40, 0xbbfc, 0xc900],
			},
			{
				recordId: "r3",
				side: "front",
				elementId: "note",
				text: "Ships 🚀 fast",
				codepoints: [0x1f680],
			},
		]);
		expect(summarizeGlyphs(issues ?? [])).toEqual({
			records: 2,
			codepoints: [0xae40, 0xbbfc, 0xc900, 0x1f680],
		});
	});

	test("stops when a newer request takes over", async () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			item(`r${i}`, { name: "漢", note: "" }),
		);
		let checks = 0;
		const out = await checkAllGlyphs(template, many, renderer, () => ++checks > 1);
		expect(out).toBeNull();
	});

	test("codepoints are labelled in U+ form", () => {
		expect(codepointLabel(0x41)).toBe("U+0041");
		expect(codepointLabel(0x1f680)).toBe("U+1F680");
	});
});
