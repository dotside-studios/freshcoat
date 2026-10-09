import { COLUMN_TYPES, coerce } from "./columns";
import { isValidKey, slug, uniqueKey } from "./ids";
import type {
	CellValue,
	Column,
	ColumnOptions,
	ColumnType,
	Dataset,
} from "./types";

export const JSON_SCHEMA_DIALECT =
	"https://json-schema.org/draft/2020-12/schema";

export type JsonSchemaProperty = {
	type: "string" | "number" | "integer" | "boolean";
	format?: string;
	"x-freshcoat-type"?: ColumnType;
	title?: string;
	description?: string;
	default?: CellValue;
	enum?: string[];
	"x-freshcoat-options"?: ColumnOptions;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
};

export type DatasetJsonSchema = {
	$schema: string;
	title: string;
	type: "object";
	properties: Record<string, JsonSchemaProperty>;
	required?: string[];
};

const TYPE_SHAPE: Record<
	ColumnType,
	Pick<JsonSchemaProperty, "type" | "format" | "x-freshcoat-type">
> = {
	text: { type: "string" },
	longText: { type: "string", "x-freshcoat-type": "longText" },
	number: { type: "number" },
	integer: { type: "integer" },
	boolean: { type: "boolean" },
	date: { type: "string", format: "date" },
	color: { type: "string", format: "color" },
	url: { type: "string", format: "uri" },
	email: { type: "string", format: "email" },
	image: { type: "string", format: "image", "x-freshcoat-type": "image" },
};

const TYPE_BY_FORMAT: Record<string, ColumnType> = {
	date: "date",
	color: "color",
	uri: "url",
	url: "url",
	email: "email",
	image: "image",
	longText: "longText",
	// coatfile's toggle, a string field whose value is "true" or "false"
	boolean: "boolean",
};

const TYPE_BY_JSON_TYPE: Record<string, ColumnType> = {
	boolean: "boolean",
	integer: "integer",
	number: "number",
	string: "text",
};

const NUMERIC: ReadonlySet<ColumnType> = new Set(["number", "integer"]);
const TEXTUAL: ReadonlySet<ColumnType> = new Set([
	"text",
	"longText",
	"color",
	"url",
	"email",
]);

// Read without a warning: annotations, and the keywords coatfile writes
// on a field that mean nothing to a column.
const QUIET_KEYWORDS = new Set([
	"$id",
	"$comment",
	"examples",
	"readOnly",
	"writeOnly",
	"deprecated",
	"x-widget",
	"x-source",
	"x-image-aspect",
]);
const PROPERTY_KEYWORDS = new Set([
	"type",
	"format",
	"x-freshcoat-type",
	"title",
	"description",
	"default",
	"enum",
	"x-freshcoat-options",
	"minimum",
	"maximum",
	"minLength",
	"maxLength",
	"pattern",
]);
const ROOT_KEYWORDS = new Set([
	"$schema",
	"$id",
	"$comment",
	"title",
	"description",
	"type",
	"properties",
	"required",
	"additionalProperties",
]);

export function columnsToJsonSchema(
	dataset: Pick<Dataset, "name" | "columns">,
): DatasetJsonSchema {
	const properties: Record<string, JsonSchemaProperty> = {};
	for (const column of dataset.columns) {
		const property: JsonSchemaProperty = { ...TYPE_SHAPE[column.type] };
		if (column.title !== undefined) property.title = column.title;
		if (column.description !== undefined) {
			property.description = column.description;
		}
		if (column.default !== undefined) property.default = column.default;
		if (column.enum !== undefined) property.enum = [...column.enum];
		if (column.options !== undefined) {
			property["x-freshcoat-options"] = { ...column.options };
		}
		for (const key of [
			"minimum",
			"maximum",
			"minLength",
			"maxLength",
		] as const) {
			if (column[key] !== undefined) property[key] = column[key];
		}
		if (column.pattern !== undefined) property.pattern = column.pattern;
		properties[column.key] = property;
	}
	const required = dataset.columns.filter((c) => c.required).map((c) => c.key);
	return {
		$schema: JSON_SCHEMA_DIALECT,
		title: dataset.name,
		type: "object",
		properties,
		...(required.length > 0 ? { required } : {}),
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonTypeOf(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		const types = value.filter((t) => t !== "null");
		return types.length === 1 && typeof types[0] === "string"
			? types[0]
			: undefined;
	}
	return undefined;
}

/**
 * Columns from a JSON Schema object, or from a coatfile `fields` block,
 * which has the same shape. What a column cannot hold is dropped and named in
 * `warnings`: references, combinators, nested objects and arrays (each such
 * property becomes a text column), and keywords this reader does not know.
 */
export function jsonSchemaToColumns(doc: unknown): {
	columns: Column[];
	warnings: string[];
} {
	const warnings: string[] = [];
	if (!isObject(doc) || !isObject(doc.properties)) {
		return {
			columns: [],
			warnings: ["Not an object schema with properties"],
		};
	}
	for (const keyword of Object.keys(doc)) {
		if (!ROOT_KEYWORDS.has(keyword)) {
			warnings.push(`Ignored the schema's ${keyword}`);
		}
	}
	const required = new Set(
		Array.isArray(doc.required)
			? doc.required.filter((k): k is string => typeof k === "string")
			: [],
	);

	const columns: Column[] = [];
	const taken: string[] = [];
	for (const [name, raw] of Object.entries(doc.properties)) {
		let key = name;
		if (!isValidKey(key) || taken.includes(key)) {
			key = uniqueKey(slug(name), taken);
			warnings.push(`${name}: renamed to ${key}`);
		}
		taken.push(key);
		const property = isObject(raw) ? raw : {};
		const column = readProperty(key, property, (message) =>
			warnings.push(`${name}: ${message}`),
		);
		if (required.has(name)) column.required = true;
		columns.push(column);
	}
	return { columns, warnings };
}

function readProperty(
	key: string,
	p: Record<string, unknown>,
	warn: (message: string) => void,
): Column {
	const type = readType(p, warn);
	const column: Column = { key, type };
	if (typeof p.title === "string") column.title = p.title;
	if (typeof p.description === "string") column.description = p.description;

	for (const keyword of Object.keys(p)) {
		if (keyword === "$ref") warn("ignored $ref");
		else if (["anyOf", "oneOf", "allOf"].includes(keyword)) {
			warn(`ignored ${keyword}`);
		} else if (
			!PROPERTY_KEYWORDS.has(keyword) &&
			!QUIET_KEYWORDS.has(keyword) &&
			!(keyword === "properties" || keyword === "items")
		) {
			warn(`ignored ${keyword}`);
		}
	}

	if (p.enum !== undefined) {
		if (
			type === "text" &&
			Array.isArray(p.enum) &&
			p.enum.every((v) => typeof v === "string")
		) {
			column.enum = [...p.enum];
		} else warn("ignored enum");
	}
	const options = p["x-freshcoat-options"];
	if (options !== undefined) {
		const read = type === "text" ? readOptions(options) : undefined;
		if (read) column.options = read;
		else warn("ignored x-freshcoat-options");
	}
	for (const bound of ["minimum", "maximum"] as const) {
		if (p[bound] === undefined) continue;
		if (NUMERIC.has(type) && typeof p[bound] === "number") {
			column[bound] = p[bound];
		} else warn(`ignored ${bound}`);
	}
	for (const bound of ["minLength", "maxLength"] as const) {
		if (p[bound] === undefined) continue;
		if (TEXTUAL.has(type) && typeof p[bound] === "number") {
			column[bound] = p[bound];
		} else warn(`ignored ${bound}`);
	}
	if (p.pattern !== undefined) {
		if (TEXTUAL.has(type) && typeof p.pattern === "string") {
			column.pattern = p.pattern;
		} else warn("ignored pattern");
	}
	if (p.default !== undefined) {
		const value = readDefault(column, p.default);
		if (value === undefined) warn("ignored default");
		else column.default = value;
	}
	return column;
}

function readOptions(raw: unknown): ColumnOptions | undefined {
	if (!isObject(raw)) return undefined;
	if (raw.kind === "variants" && typeof raw.templateId === "string") {
		return { kind: "variants", templateId: raw.templateId };
	}
	return undefined;
}

function readType(
	p: Record<string, unknown>,
	warn: (message: string) => void,
): ColumnType {
	const declared = p["x-freshcoat-type"];
	if (
		typeof declared === "string" &&
		COLUMN_TYPES.includes(declared as ColumnType)
	) {
		return declared as ColumnType;
	}
	if (declared !== undefined) warn(`unknown x-freshcoat-type ${declared}`);

	const jsonType = jsonTypeOf(p.type);
	if (jsonType === "object" || jsonType === "array") {
		warn(`nested ${jsonType} read as text`);
		return "text";
	}
	if (typeof p.format === "string") {
		const byFormat = TYPE_BY_FORMAT[p.format];
		if (byFormat !== undefined) return byFormat;
		warn(`ignored format ${p.format}`);
	}
	if (jsonType !== undefined) {
		const byType = TYPE_BY_JSON_TYPE[jsonType];
		if (byType !== undefined) return byType;
		warn(`type ${jsonType} read as text`);
	} else if (p.type !== undefined) warn("type read as text");
	return "text";
}

function readDefault(column: Column, raw: unknown): CellValue | undefined {
	const matches =
		raw === null ||
		(NUMERIC.has(column.type) && typeof raw === "number") ||
		(column.type === "boolean" && typeof raw === "boolean") ||
		(!NUMERIC.has(column.type) &&
			column.type !== "boolean" &&
			typeof raw === "string");
	if (matches) return raw as CellValue;
	if (typeof raw === "object") return undefined;
	const coerced = coerce(column, raw);
	return coerced.ok ? coerced.value : undefined;
}
