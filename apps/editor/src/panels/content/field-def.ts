import type { FieldDefinition, Template } from "@freshcoat-js/coatfile";
import { FIELD_ID } from "@freshcoat-js/coatfile/mustache";
import { KEY_RULE } from "~/app/copy";

export const FIELD_FORMATS = [
	{ id: "text", name: "Text" },
	{ id: "longText", name: "Long text" },
	{ id: "color", name: "Color" },
	{ id: "url", name: "URL" },
	{ id: "image", name: "Image" },
	{ id: "boolean", name: "Yes / no" },
] as const;

export const FIELD_SOURCES = [
	{ id: "unset", name: "Not set" },
	{ id: "user", name: "User" },
	{ id: "system", name: "System" },
	{ id: "order", name: "Order" },
] as const;

/** Why a key cannot name a new field, or null when it can. */
export function fieldKeyError(
	key: string,
	taken: (key: string) => boolean,
): string | null {
	if (key === "") return "Enter a key";
	if (!FIELD_ID.test(key)) return KEY_RULE;
	if (taken(key)) return `"${key}" is already a field`;
	return null;
}

/** Merges a patch into a definition; an `undefined` value removes the key. */
export function withPatch(
	def: FieldDefinition,
	patch: Partial<FieldDefinition>,
): FieldDefinition {
	const out: Record<string, unknown> = { ...def };
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete out[k];
		else out[k] = v;
	}
	return out as FieldDefinition;
}

/** Adds or drops a field from `fields.required`, dropping an emptied list. */
export function setRequired(t: Template, key: string, on: boolean): Template {
	const current = t.fields.required ?? [];
	if (current.includes(key) === on) return t;
	const required = on ? [...current, key] : current.filter((k) => k !== key);
	const { required: _old, ...rest } = t.fields;
	return {
		...t,
		fields: required.length ? { ...rest, required } : rest,
	};
}
