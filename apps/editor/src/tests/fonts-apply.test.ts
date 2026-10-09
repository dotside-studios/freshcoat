import type { Template } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { fontUsage, templateFamilies } from "~/fonts/apply";

const text = (id: string, font: Record<string, unknown>) => ({
	id,
	type: "text",
	pos: { x: 0, y: 0 },
	size: { width: 100, height: 20 },
	properties: { value: "hi", font: { size: 12, ...font }, color: "#000" },
});

function template(): Template {
	return {
		format_version: "1.1",
		name: "T",
		width: 100,
		height: 100,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					size: { width: 100, height: 100 },
					properties: {},
				},
				elements: [
					text("t", { family: "Inter", weight: 600 }),
					{
						id: "b",
						type: "barcode",
						pos: { x: 0, y: 0 },
						size: { width: 50, height: 20 },
						properties: {
							symbology: "code128",
							value: "1",
							fontFamily: "Vend Sans",
						},
					},
				],
			},
		],
		variants: [
			{
				id: "alt",
				label: "Alt",
				overrides: [
					{
						name: "front",
						elements: [
							{
								id: "t",
								properties: {
									font: { family: "Lora", weight: 600, style: "italic" },
								},
							},
						],
					},
				],
			},
		],
	} as unknown as Template;
}

describe("templateFamilies", () => {
	test("includes barcode and variant-only families", () => {
		expect(templateFamilies(template())).toEqual([
			"Inter",
			"Vend Sans",
			"Lora",
		]);
	});
});

describe("fontUsage", () => {
	test("reports a variant's italic", () => {
		expect(fontUsage(template(), "Lora")).toEqual({
			weights: [600],
			italic: true,
		});
	});

	test("adds the layers about to take the family", () => {
		expect(fontUsage(template(), "Vend Sans", ["0/0"])).toEqual({
			weights: [400, 600],
			italic: false,
		});
	});
});
