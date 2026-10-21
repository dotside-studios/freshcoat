import type { z } from "zod";
import { formatHistory, formatMinor } from "./format-version";

type Schema = z.core.$ZodType;
type Def = z.core.$ZodTypeDef & Record<string, unknown>;

const WRAPPERS = new Set([
	"optional",
	"nullable",
	"default",
	"prefault",
	"nonoptional",
	"readonly",
	"catch",
]);

const defOf = (schema: Schema) => schema._zod.def as Def;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

function inner(schema: Schema): Schema | undefined {
	const def = defOf(schema);
	if (WRAPPERS.has(def.type)) return def.innerType as Schema;
	if (def.type === "lazy")
		return (schema as z.core.$ZodLazy)._zod.innerType as Schema;
	if (def.type === "pipe") return def.in as Schema;
	return undefined;
}

function ownMinor(schema: Schema, value: unknown): number {
	const tag = formatHistory.get(schema);
	if (!tag) return 0;
	let minor = tag.since ? formatMinor(tag.since) : 0;
	const key = String(value);
	if (tag.values && Object.hasOwn(tag.values, key))
		minor = Math.max(minor, formatMinor(tag.values[key]));
	return minor;
}

/**
 * The highest minor `formatHistory` tags on the parts of `schema` that `value`
 * uses. A union counts each member `value` could be; a key the schema does not
 * have counts nothing.
 */
export function schemaFormatMinor(schema: Schema, value: unknown): number {
	if (value === undefined) return 0;
	let minor = ownMinor(schema, value);
	const need = (m: number) => {
		if (m > minor) minor = m;
	};
	const wrapped = inner(schema);
	if (wrapped) {
		need(schemaFormatMinor(wrapped, value));
		return minor;
	}
	const def = defOf(schema);
	switch (def.type) {
		case "object": {
			if (!isRecord(value)) break;
			const shape = def.shape as Record<string, Schema>;
			for (const key of Object.keys(shape))
				if (Object.hasOwn(value, key))
					need(schemaFormatMinor(shape[key], value[key]));
			break;
		}
		case "record":
			if (!isRecord(value)) break;
			for (const [key, item] of Object.entries(value)) {
				need(schemaFormatMinor(def.keyType as Schema, key));
				need(schemaFormatMinor(def.valueType as Schema, item));
			}
			break;
		case "array":
			if (!Array.isArray(value)) break;
			for (const item of value)
				need(schemaFormatMinor(def.element as Schema, item));
			break;
		case "tuple": {
			if (!Array.isArray(value)) break;
			const items = def.items as Schema[];
			value.forEach((item, i) => {
				const at = items[i] ?? (def.rest as Schema | null);
				if (at) need(schemaFormatMinor(at, item));
			});
			break;
		}
		case "union":
			for (const option of def.options as Schema[])
				if (couldBe(option, value)) need(schemaFormatMinor(option, value));
			break;
		case "intersection":
			need(schemaFormatMinor(def.left as Schema, value));
			need(schemaFormatMinor(def.right as Schema, value));
			break;
	}
	return minor;
}

// Whether `value` could be `schema`, looking one level deep: its type, and the
// literal fields that tell a union's objects apart.
function couldBe(schema: Schema, value: unknown): boolean {
	const def = defOf(schema);
	if (def.type === "optional" && value === undefined) return true;
	if (def.type === "nullable" && value === null) return true;
	const wrapped = inner(schema);
	if (wrapped) return couldBe(wrapped, value);
	switch (def.type) {
		case "object":
			return (
				isRecord(value) &&
				Object.entries(def.shape as Record<string, Schema>).every(
					([key, field]) => {
						const fieldDef = defOf(field);
						return (
							fieldDef.type !== "literal" ||
							(fieldDef.values as unknown[]).includes(value[key])
						);
					},
				)
			);
		case "record":
			return isRecord(value);
		case "array":
		case "tuple":
			return Array.isArray(value);
		case "union":
			return (def.options as Schema[]).some((option) => couldBe(option, value));
		case "literal":
			return (def.values as unknown[]).includes(value);
		case "enum":
			return Object.values(def.entries as Record<string, unknown>).includes(
				value,
			);
		case "string":
		case "number":
		case "boolean":
		case "bigint":
			return typeof value === def.type;
		case "null":
			return value === null;
		default:
			return true;
	}
}

export type SchemaPath = {
	/** Where it sits, as `.key`, `[]`, `|member` and `=value` steps. */
	path: string;
	/** The minor of its own tag or its nearest tagged ancestor's. */
	since?: string;
	/** Set when it carries the tag itself: the name FORMAT_HISTORY uses. */
	feature?: string;
};

/**
 * Every field, union member and enum value `schema` describes, each with the
 * minor that added it. A recursive schema is followed once per path, and an
 * untagged one reached again under no tag is listed only where first reached.
 */
export function schemaPaths(schema: Schema): SchemaPath[] {
	const out: SchemaPath[] = [];
	const expanded = new Set<Schema>();
	const visit = (
		node: Schema,
		path: string,
		name: string,
		since: string | undefined,
		open: Set<Schema>,
	): void => {
		let own: string | undefined;
		let at: Schema | undefined = node;
		const values: Record<string, string> = {};
		while (at) {
			if (open.has(at)) return;
			const tag = formatHistory.get(at);
			if (tag?.since) own = tag.since;
			if (tag?.feature) name = tag.feature;
			Object.assign(values, tag?.values);
			if (defOf(at).type === "lazy") open = new Set(open).add(at);
			node = at;
			at = inner(at);
		}
		const effective = own ?? since;
		if (path)
			out.push({
				path,
				...(effective && { since: effective }),
				...(own && { feature: name }),
			});
		if (!effective) {
			if (expanded.has(node)) return;
			expanded.add(node);
		}
		const def = defOf(node);
		switch (def.type) {
			case "object":
				for (const [key, field] of Object.entries(
					def.shape as Record<string, Schema>,
				))
					visit(field, `${path}.${key}`, key, effective, open);
				break;
			case "record":
				visit(def.valueType as Schema, `${path}{}`, name, effective, open);
				break;
			case "array":
				visit(def.element as Schema, `${path}[]`, name, effective, open);
				break;
			case "tuple":
				(def.items as Schema[]).forEach((item, i) => {
					visit(item, `${path}[${i}]`, name, effective, open);
				});
				break;
			case "union": {
				const seen = new Set<string>();
				for (const option of def.options as Schema[]) {
					const literal = literalLabel(option);
					let label = literal ?? defOf(innermost(option)).type;
					while (seen.has(label)) label += "'";
					seen.add(label);
					visit(option, `${path}|${label}`, literal ?? name, effective, open);
				}
				break;
			}
			case "enum":
			case "literal": {
				const all =
					def.type === "enum"
						? Object.values(def.entries as Record<string, string>)
						: (def.values as unknown[]);
				if (all.length < 2 && !Object.keys(values).length) break;
				for (const value of all) {
					const key = String(value);
					const tagged = Object.hasOwn(values, key) ? values[key] : undefined;
					const valueSince = tagged ?? effective;
					out.push({
						path: `${path}=${key}`,
						...(valueSince && { since: valueSince }),
						...(tagged && { feature: key }),
					});
				}
				break;
			}
		}
	};
	visit(schema, "", "", undefined, new Set());
	return out;
}

function innermost(schema: Schema): Schema {
	let node = schema;
	for (let next = inner(node); next; next = inner(node)) node = next;
	return node;
}

// The value of a union member's literal field, as `barcode` for the barcode
// element, or its own literal value.
function literalLabel(option: Schema): string | undefined {
	const def = defOf(innermost(option));
	if (def.type === "literal") return String((def.values as unknown[])[0]);
	if (def.type !== "object") return undefined;
	for (const field of Object.values(def.shape as Record<string, Schema>)) {
		const fieldDef = defOf(field);
		if (fieldDef.type === "literal")
			return String((fieldDef.values as unknown[])[0]);
	}
	return undefined;
}
