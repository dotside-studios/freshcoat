import { describe, expect, it } from "vitest";
import { columnsToJsonSchema, jsonSchemaToColumns } from "./json-schema";
import { deepFreeze, memberCard, members } from "./test-fixtures";
import type { Column, Dataset } from "./types";

const everyType: Dataset = deepFreeze({
	id: "d",
	name: "Every type",
	records: [],
	assets: [],
	columns: [
		{
			key: "name",
			title: "Name",
			description: "Full name",
			type: "text",
			required: true,
			minLength: 1,
			maxLength: 40,
			pattern: "^\\S",
			default: "Anon",
		},
		{ key: "tier", type: "text", enum: ["gold", "silver"] },
		{ key: "bio", type: "longText" },
		{ key: "score", type: "number", minimum: 0, maximum: 1.5, default: 0.5 },
		{ key: "age", type: "integer", minimum: 18, required: true },
		{ key: "vip", type: "boolean", default: false },
		{ key: "joined", type: "date", default: "2024-01-01" },
		{ key: "brand", type: "color" },
		{ key: "site", type: "url" },
		{ key: "mail", type: "email" },
		{ key: "photo", type: "image", title: "Photo" },
	] satisfies Column[],
});

describe("columnsToJsonSchema", () => {
	it("writes a draft 2020-12 object schema", () => {
		const schema = columnsToJsonSchema(everyType);
		expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		expect(schema.title).toBe("Every type");
		expect(schema.type).toBe("object");
		expect(Object.keys(schema.properties)).toEqual(
			everyType.columns.map((c) => c.key),
		);
		expect(schema.required).toEqual(["name", "age"]);
		expect(schema.properties.name).toEqual({
			type: "string",
			title: "Name",
			description: "Full name",
			default: "Anon",
			minLength: 1,
			maxLength: 40,
			pattern: "^\\S",
		});
		expect(schema.properties.bio).toEqual({
			type: "string",
			"x-freshcoat-type": "longText",
		});
		expect(schema.properties.joined).toMatchObject({
			type: "string",
			format: "date",
		});
		expect(schema.properties.site).toMatchObject({ format: "uri" });
		expect(schema.properties.photo).toMatchObject({
			type: "string",
			format: "image",
			"x-freshcoat-type": "image",
		});
	});

	it("round-trips every column type", () => {
		for (const dataset of [everyType, members]) {
			const back = jsonSchemaToColumns(
				JSON.parse(JSON.stringify(columnsToJsonSchema(dataset))),
			);
			expect(back.warnings).toEqual([]);
			expect(back.columns).toEqual(dataset.columns);
		}
	});
});

describe("jsonSchemaToColumns", () => {
	it("reads a foreign schema, warning about what it drops", () => {
		const { columns, warnings } = jsonSchemaToColumns({
			$schema: "http://json-schema.org/draft-07/schema#",
			$defs: { x: {} },
			type: "object",
			properties: {
				"First Name": { type: "string" },
				ref: { $ref: "#/$defs/x" },
				either: { anyOf: [{ type: "string" }, { type: "number" }] },
				address: { type: "object", properties: { city: { type: "string" } } },
				tags: { type: "array", items: { type: "string" } },
				level: { type: "integer", enum: [1, 2], "x-custom": true },
				when: { type: "string", format: "date-time" },
				maybe: { type: ["number", "null"] },
				link: { type: "string", format: "url" },
			},
			required: ["First Name", "missing"],
		});
		expect(columns).toEqual([
			{ key: "first_name", type: "text", required: true },
			{ key: "ref", type: "text" },
			{ key: "either", type: "text" },
			{ key: "address", type: "text" },
			{ key: "tags", type: "text" },
			{ key: "level", type: "integer" },
			{ key: "when", type: "text" },
			{ key: "maybe", type: "number" },
			{ key: "link", type: "url" },
		]);
		expect(warnings).toEqual([
			"Ignored the schema's $defs",
			"First Name: renamed to first_name",
			"ref: ignored $ref",
			"either: ignored anyOf",
			"address: nested object read as text",
			"tags: nested array read as text",
			"level: ignored x-custom",
			"level: ignored enum",
			"when: ignored format date-time",
		]);
	});

	it("reads a coatfile fields block", () => {
		const { columns, warnings } = jsonSchemaToColumns(memberCard.fields);
		expect(warnings).toEqual([]);
		expect(columns).toEqual([
			{
				key: "name",
				title: "Name",
				type: "text",
				default: "Member",
				required: true,
			},
			{ key: "number", type: "text", default: "0000" },
			{ key: "photo", type: "image" },
			{ key: "vip", type: "boolean", default: false },
		]);
	});

	it("uses x-freshcoat-type before format and type", () => {
		const { columns } = jsonSchemaToColumns({
			type: "object",
			properties: {
				a: { type: "string", format: "email", "x-freshcoat-type": "longText" },
				b: { type: "number", format: "color" },
				c: { type: "boolean" },
			},
		});
		expect(columns.map((c) => c.type)).toEqual([
			"longText",
			"color",
			"boolean",
		]);
	});

	it("dedupes slugged keys and refuses a non-object", () => {
		const { columns } = jsonSchemaToColumns({
			type: "object",
			properties: { "a b": {}, a_b: {} },
		});
		expect(columns.map((c) => c.key)).toEqual(["a_b", "a_b_2"]);
		expect(jsonSchemaToColumns([1]).warnings).toEqual([
			"Not an object schema with properties",
		]);
	});
});
