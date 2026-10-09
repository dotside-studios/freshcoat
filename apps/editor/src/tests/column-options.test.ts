import type { Template } from "@freshcoat-js/coatfile";
import type { Binding, Column } from "@freshcoat-js/workspace";
import { describe, expect, test } from "vitest";
import {
	choiceOf,
	columnChoices,
	type TemplateSlot,
} from "~/data/column-options";
import { doc } from "./doc-fixture";

const template = {
	...doc(),
	variants: [
		{ id: "dark", label: "Dark", overrides: [] },
		{ id: "portrait", label: "Portrait", overrides: [] },
	],
} as Template;

const columns: Column[] = [
	{ key: "name", type: "text" },
	{
		key: "look",
		type: "text",
		options: { kind: "variants", templateId: "t_card" },
	},
	{
		key: "gone",
		type: "text",
		options: { kind: "variants", templateId: "t_gone" },
	},
];

const slot = (binding?: Binding): TemplateSlot => ({
	id: "t_card",
	fileName: "Card.coat",
	template,
	...(binding ? { binding } : {}),
});

describe("columnChoices", () => {
	test("offers a template's variants, empty meaning Default", () => {
		const choices = columnChoices(columns, [slot()], "d");
		expect([...choices.keys()]).toEqual(["look"]);
		expect(choices.get("look")).toEqual({
			options: [
				{ value: "dark", label: "Dark" },
				{ value: "portrait", label: "Portrait" },
			],
			empty: "Default",
		});
	});

	test("says what an empty cell falls back to when the template reads the column", () => {
		const reads = slot({
			datasetId: "d",
			fields: {},
			variant: {
				kind: "column",
				column: "look",
				fallback: { kind: "image", field: "photo" },
			},
		});
		const choices = columnChoices(columns, [reads], "d").get("look");
		expect(choices?.empty).toBe("Auto: Photo shape");
		expect(choices?.options[0]).toEqual({ value: "default", label: "Default" });
		expect(columnChoices(columns, [reads], "other").get("look")?.empty).toBe(
			"Default",
		);
	});

	test("matches a cell by value, then label, ignoring case", () => {
		const choices = columnChoices(columns, [slot()], "d").get("look");
		if (!choices) throw new Error("no choices");
		expect(choiceOf(choices, "DARK")?.value).toBe("dark");
		expect(choiceOf(choices, " portrait ")?.value).toBe("portrait");
		expect(choiceOf(choices, "nope")).toBeUndefined();
		expect(choiceOf(choices, null)).toBeUndefined();
	});
});
