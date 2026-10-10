import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { createRenderer } from "@freshcoat-js/engine";
import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { describeWarning, renderCompiledPdf } from "../src/render";
import type { Template } from "../src/types";

const rect = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	type: "rect",
	pos: { x: 0, y: 0 },
	size: { width: 40, height: 20 },
	properties: { fill: "#ffffff" },
	...extra,
});

const side = (name: string, elements: unknown[] = []) => ({
	name,
	background: rect(`bg-${name}`),
	elements,
});

const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	description: "d",
	product: "test",
	width: 40,
	height: 20,
	fields: { type: "object", properties: {} },
	template_data: [
		side("front"),
		side("back", [
			rect("card", { shadow: { color: "#0008", dx: 0, dy: 2, blur: 4 } }),
		]),
	],
} as unknown as Template;

describe("renderCompiledPdf", () => {
	test("paints each side as a page and names the layers drawn as images", async () => {
		const renderer = await createRenderer({ ck: await loadCanvasKit() });
		const compiled = compile(template, {}, { width: 40, height: 20 });
		const pages = await renderCompiledPdf(renderer, compiled, { dpi: 72 });
		expect(pages.map((p) => p.name)).toEqual(["front", "back"]);
		expect(pages.map((p) => [p.width, p.height])).toEqual([
			[40, 20],
			[40, 20],
		]);
		expect(new TextDecoder().decode(pages[0]?.bytes.slice(0, 8))).toBe("%PDF-1.7");
		expect(pages[0]?.warnings).toEqual([]);
		expect(pages[1]?.warnings).toEqual([
			{ kind: "vector_rasterized", feature: "shadow", layer: "card" },
		]);
		expect(describeWarning(pages[1]?.warnings[0] as never)).toBe(
			"Drawn as an image in the PDF: shadow (card)",
		);
	});
});
