import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import {
	elementFieldRefs,
	fieldTitle,
	isSystemField,
	PLACEHOLDER_IMAGE,
	sampleValues,
	templateFieldRefs,
	variantFieldRefs,
	visibilityFieldRefs,
} from "../src/fields";
import type { Element, Template } from "../src/types";

const text = (id: string, value: string, extra: object = {}): Element =>
	({
		id,
		type: "text",
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties: { value, font: { family: "Inter", size: 12 } },
		...extra,
	}) as Element;

function card(): Template {
	return {
		format_version: "1.6",
		id: "card",
		name: "Card",
		width: 100,
		height: 60,
		fields: {
			type: "object",
			properties: {
				name: { type: "string", title: "Full name" },
				first_name: { type: "string" },
				photo: { type: "string", format: "image" },
				show: { type: "string", format: "boolean", default: "" },
				brand: { type: "string", format: "color", default: "#000000" },
			},
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "{{brand}}" },
				} as Template["template_data"][number]["background"],
				elements: [
					text("greeting", "Hi {{ first_name }}, {{name}}"),
					{
						id: "frame",
						type: "frame",
						pos: { x: 0, y: 0 },
						size: { width: 50, height: 50 },
						visibleWhen: [{ field: "show" }],
						properties: {
							children: [
								{
									id: "pic",
									type: "image",
									pos: { x: 0, y: 0 },
									size: { width: 10, height: 10 },
									properties: { src: "{{photo}}", fit: "cover" },
								},
								{
									id: "qr",
									type: "qr",
									pos: { x: 0, y: 0 },
									size: { width: 10, height: 10 },
									properties: { value: "https://x.example/{{code}}" },
								},
							],
						},
					} as Element,
				],
			},
			{
				name: "back",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#fff" },
				} as Template["template_data"][number]["background"],
				elements: [
					{
						id: "bar",
						type: "barcode",
						pos: { x: 0, y: 0 },
						size: { width: 10, height: 10 },
						properties: { value: "{{sku}}", symbology: "code128" },
					} as Element,
				],
			},
		],
		variants: [
			{
				id: "dark",
				label: "Dark",
				overrides: [
					{
						name: "front",
						elements: [{ id: "greeting", properties: { color: "{{tint}}" } }],
					},
				],
			},
		],
	} as Template;
}

describe("elementFieldRefs", () => {
	test("reads tokens in its own properties and its visibleWhen", () => {
		const [greeting, frame] = card().template_data[0]?.elements ?? [];
		expect(elementFieldRefs(greeting as Element)).toEqual([
			"first_name",
			"name",
		]);
		expect(elementFieldRefs(frame as Element)).toEqual(["show"]);
	});

	test("ignores what is not a token", () => {
		expect(elementFieldRefs(text("t", "{{ not a token }}"))).toEqual([]);
		expect(
			elementFieldRefs({
				id: "x",
				type: "rect",
				visibleWhen: { field: "vip" },
				properties: { fill: "{{brand}}" },
			} as Element),
		).toEqual(["brand", "vip"]);
	});
});

describe("templateFieldRefs", () => {
	test("reads every side, nested children, the background and variants", () => {
		expect(templateFieldRefs(card()).sort()).toEqual(
			[
				"brand",
				"code",
				"first_name",
				"name",
				"photo",
				"show",
				"sku",
				"tint",
			].sort(),
		);
	});

	test("reads a mask's shape and content, not the mask's own", () => {
		const mask = {
			id: "m",
			type: "mask",
			pos: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
			properties: {
				mask: {
					id: "shape",
					type: "rect",
					properties: { fill: "{{shade}}" },
				},
				children: [text("inside", "{{label}}")],
			},
		} as Element;
		expect(elementFieldRefs(mask)).toEqual([]);
		const t = card();
		const front = t.template_data[0];
		if (!front) throw new Error("no front");
		front.elements = [mask];
		expect(templateFieldRefs(t)).toEqual([
			"brand",
			"shade",
			"label",
			"sku",
			"tint",
		]);
	});

	test("reads the fixtures", () => {
		expect(templateFieldRefs(fixtures.minimalCard)).toEqual(["displayName"]);
	});

	test("lists variant and visibility fields on their own", () => {
		const [dark] = card().variants ?? [];
		expect(variantFieldRefs(dark as NonNullable<typeof dark>)).toEqual([
			"tint",
		]);
		expect(visibilityFieldRefs(card())).toEqual(["show"]);
	});
});

describe("fieldTitle", () => {
	test.each([
		["display_name", "Display name"],
		["display-name", "Display name"],
		["displayName", "Display name"],
		["fontSize", "Font size"],
		["name", "Name"],
		["QR_code", "QR code"],
		["userID", "User ID"],
		["  spaced__out ", "Spaced out"],
	])("%s reads %s", (id, title) => {
		expect(fieldTitle(id)).toBe(title);
	});
});

describe("sampleValues", () => {
	test("fills blanks by format and keeps an empty gate empty", () => {
		expect(sampleValues(card())).toEqual({
			name: "Full name",
			first_name: "First name",
			photo: PLACEHOLDER_IMAGE,
			show: "",
			brand: "#000000",
		});
	});
});

describe("isSystemField", () => {
	test("reads readOnly, x-source and the $$ prefix", () => {
		expect(isSystemField("a", { type: "string", readOnly: true })).toBe(true);
		expect(isSystemField("a", { type: "string", "x-source": "system" })).toBe(
			true,
		);
		expect(isSystemField("$$a", { type: "string" })).toBe(true);
		expect(isSystemField("a", { type: "string", "x-source": "user" })).toBe(
			false,
		);
	});
});
