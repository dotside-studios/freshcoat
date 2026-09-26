import { describe, expect, test } from "vitest";
import { collectFontRequests, defaultFontFamily } from "../src/fonts";
import type { Template } from "../src/types";

// A template whose text uses three families: one declared (google), one nested
// inside a frame reusing the declared family (must dedupe), and one undeclared
// (must fall back to a bare `{ family }` request).
const template = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	product: "card_cr80",
	width: 100,
	height: 60,
	fields: { type: "object", properties: {} },
	fonts: [
		{
			kind: "google",
			family: "Playfair Display",
			url: "https://fonts.googleapis.com/css2?family=Playfair+Display&display=swap",
		},
	],
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 60 },
				properties: { fill: "#fff" },
			},
			elements: [
				{
					id: "title",
					type: "text",
					pos: { x: 0, y: 0 },
					size: { width: 100, height: 20 },
					properties: {
						value: "Title",
						font: { family: "Playfair Display", size: 16 },
						color: "#000",
					},
				},
				{
					id: "sub",
					type: "text",
					pos: { x: 0, y: 20 },
					size: { width: 100, height: 20 },
					properties: {
						value: "Sub",
						font: { family: "Roboto", size: 10 },
						color: "#000",
					},
				},
				{
					id: "grp",
					type: "frame",
					pos: { x: 0, y: 40 },
					size: { width: 100, height: 20 },
					properties: {
						children: [
							{
								id: "nested",
								type: "text",
								pos: { x: 0, y: 0 },
								size: { width: 100, height: 20 },
								properties: {
									value: "Nested",
									font: { family: "Playfair Display", size: 8 },
									color: "#000",
								},
							},
						],
					},
				},
			],
		},
	],
} as unknown as Template;

describe("collectFontRequests", () => {
	test("dedupes used families and resolves declared descriptors, bare otherwise", () => {
		const reqs = collectFontRequests(template);
		expect(reqs).toHaveLength(2);

		const playfair = reqs.find((r) => r.family === "Playfair Display");
		const roboto = reqs.find((r) => r.family === "Roboto");

		// Declared → carries its descriptor; nested reuse is deduped to one request.
		expect(playfair).toEqual({
			family: "Playfair Display",
			descriptor: template.fonts?.[0],
		});
		// Undeclared → bare by-name request, no descriptor.
		expect(roboto).toEqual({ family: "Roboto" });
	});

	test("empty when a template declares no text", () => {
		const bare = {
			...template,
			template_data: [
				{
					...template.template_data[0],
					elements: [],
				},
			],
		} as unknown as Template;
		expect(collectFontRequests(bare)).toEqual([]);
	});

	test("includes families a variant delta introduces", () => {
		const withVariant = {
			...template,
			variants: [
				{
					id: "v",
					label: "V",
					overrides: [
						{
							name: "front",
							elements: [
								{
									id: "nested",
									properties: { font: { family: "Lora", size: 8 } },
								},
								{ id: "sub", properties: {}, hidden: true },
							],
						},
					],
				},
			],
		} as unknown as Template;
		expect(collectFontRequests(withVariant).map((r) => r.family)).toEqual([
			"Playfair Display",
			"Roboto",
			"Lora",
		]);
	});
});

describe("defaultFontFamily", () => {
	const noText = {
		...template,
		fonts: undefined,
		template_data: [{ ...template.template_data[0], elements: [] }],
	} as unknown as Template;

	test("the first declared font, else the first text family", () => {
		expect(defaultFontFamily(template)).toBe("Playfair Display");
		expect(defaultFontFamily({ ...template, fonts: undefined })).toBe(
			"Playfair Display",
		);
		expect(defaultFontFamily(noText)).toBeUndefined();
	});
});
