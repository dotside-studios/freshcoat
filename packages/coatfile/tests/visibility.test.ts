import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import type { Element, GroupNode, Template } from "../src/types";
import { validate, validateValues } from "../src/validate";
import { fieldIsSet, isElementVisible } from "../src/visibility";

const text = (id: string, extra: Partial<Element> = {}): Element =>
	({
		id,
		type: "text",
		size: { width: 80, height: 10 },
		properties: { value: id, font: { family: "Inter", size: 8 } },
		...extra,
	}) as Element;

function template(elements: Element[]): Template {
	return {
		format_version: "1.0",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "card_cr80",
		width: 100,
		height: 60,
		fields: {
			type: "object",
			properties: {
				show_badge: { type: "string", format: "boolean", default: "false" },
				title: { type: "string" },
				tier: { type: "string" },
			},
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#fff" },
				},
				elements,
			},
		],
	};
}

const ids = (root: GroupNode): string[] =>
	root.children.flatMap((c) =>
		c.kind === "group" && c.id ? [c.id, ...ids(c)] : c.id ? [c.id] : [],
	);

const compiledIds = (tpl: Template, values: Record<string, unknown> = {}) =>
	ids(compile(tpl, values, { width: 100, height: 60 }).frames[0].root);

describe("fieldIsSet", () => {
	test("a boolean field is set only when true", () => {
		const def = { type: "string" as const, format: "boolean" as const };
		expect(fieldIsSet("true", def)).toBe(true);
		expect(fieldIsSet(true, def)).toBe(true);
		expect(fieldIsSet("false", def)).toBe(false);
		expect(fieldIsSet(undefined, def)).toBe(false);
	});

	test("any other field is set when it is not blank", () => {
		const def = { type: "string" as const };
		expect(fieldIsSet("Ana", def)).toBe(true);
		expect(fieldIsSet("false", def)).toBe(true);
		expect(fieldIsSet("  ", def)).toBe(false);
		expect(fieldIsSet(undefined, def)).toBe(false);
	});
});

describe("isElementVisible", () => {
	const fields = template([]).fields.properties;

	test("equals compares the exact value, not truthiness", () => {
		const el = { visibleWhen: { field: "tier", equals: "gold" } };
		expect(isElementVisible(el, { tier: "gold" }, fields)).toBe(true);
		expect(isElementVisible(el, { tier: "silver" }, fields)).toBe(false);
	});

	test("not inverts the condition", () => {
		const el = { visibleWhen: { field: "title", not: true } };
		expect(isElementVisible(el, { title: "" }, fields)).toBe(true);
		expect(isElementVisible(el, { title: "Hi" }, fields)).toBe(false);
	});

	test("every condition in a list must hold", () => {
		const el = {
			visibleWhen: [{ field: "show_badge" }, { field: "tier", equals: "gold" }],
		};
		const both = { show_badge: "true", tier: "gold" };
		expect(isElementVisible(el, both, fields)).toBe(true);
		expect(isElementVisible(el, { ...both, tier: "x" }, fields)).toBe(false);
	});
});

describe("compile drops hidden elements", () => {
	const tpl = template([
		text("always"),
		text("badge", { visibleWhen: { field: "show_badge" } }),
		{
			id: "row",
			type: "frame",
			size: { width: 100, height: 20 },
			properties: {
				layout: { direction: "row" },
				children: [
					text("title", { visibleWhen: { field: "title" } }),
					text("placeholder", { visibleWhen: { field: "title", not: true } }),
				],
			},
		} as Element,
	]);

	test("the boolean default hides until the value says otherwise", () => {
		expect(compiledIds(tpl)).toEqual(["always", "row", "placeholder"]);
		expect(compiledIds(tpl, { show_badge: "true", title: "Hi" })).toEqual([
			"always",
			"badge",
			"row",
			"title",
		]);
	});
});

describe("validation", () => {
	test("accepts a condition naming a declared field", () => {
		const r = validate(
			template([text("a", { visibleWhen: { field: "title" } })]),
		);
		expect(r.ok).toBe(true);
	});

	test("rejects a condition naming an unknown field, nested ones included", () => {
		const r = validate(
			template([
				{
					id: "f",
					type: "frame",
					properties: {
						children: [text("a", { visibleWhen: [{ field: "nope" }] })],
					},
				} as Element,
			]),
		);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors.map((e) => e.code)).toContain("unknown_field_reference");
	});

	test("rejects a boolean default that is not true or false", () => {
		const tpl = template([]);
		tpl.fields.properties.show_badge.default = "yes";
		const r = validate(tpl);
		expect(r.ok).toBe(false);
		if (!r.ok)
			expect(r.errors.map((e) => e.code)).toContain("invalid_boolean_default");
	});

	test("a boolean value must be true or false, and is never missing", () => {
		const fields = {
			type: "object" as const,
			properties: {
				show_badge: { type: "string" as const, format: "boolean" as const },
			},
			required: ["show_badge"],
		};
		expect(validateValues({}, fields).ok).toBe(true);
		expect(validateValues({ show_badge: "false" }, fields).ok).toBe(true);
		const bad = validateValues({ show_badge: "yes" }, fields);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.errors[0].code).toBe("invalid_boolean_value");
	});
});
