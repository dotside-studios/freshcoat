import type { FieldDefinition, Template } from "@freshcoat/coatfile";

export type FieldEntry = { id: string; field: FieldDefinition };

/** A neutral grey stand-in, inline so image-bound layers render offline. */
export const PLACEHOLDER_IMAGE =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mM4efoiVsQwtCQA3z2ZQXrXt2kAAAAASUVORK5CYII=";

/** The template's own declared defaults; everything else stays unset. */
export function defaultValues(template: Template): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [id, field] of fieldEntries(template)) {
		if (field.default !== undefined) out[id] = field.default;
	}
	return out;
}

/**
 * Defaults plus a stand-in for every field left blank, so a template renders
 * complete. Text fields fall back to their own label, which shows which layer
 * each field feeds.
 *
 * A field that shows or hides a layer and declares an empty default keeps it:
 * the empty value is the design's own answer to "is it there", and a stand-in
 * would show an optional layer (a logo, a badge) nobody has filled.
 */
export function sampleValues(template: Template): Record<string, string> {
	const out = defaultValues(template);
	const gates = visibilityFields(template);
	for (const [id, field] of fieldEntries(template)) {
		if (out[id]) continue;
		if (field.default === "" && gates.has(id)) continue;
		out[id] = sampleFor(id, field);
	}
	return out;
}

/** The fields a `visibleWhen` reads. */
export function visibilityFields(template: Template): Set<string> {
	const found = new Set<string>();
	const scan = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const item of value) scan(item);
			return;
		}
		if (value && typeof value === "object") {
			const when = (value as { visibleWhen?: unknown }).visibleWhen;
			for (const cond of Array.isArray(when) ? when : when ? [when] : []) {
				const field = (cond as { field?: unknown }).field;
				if (typeof field === "string") found.add(field);
			}
			for (const item of Object.values(value)) scan(item);
		}
	};
	scan(template.template_data);
	scan(template.variants ?? []);
	return found;
}

function sampleFor(id: string, field: FieldDefinition): string {
	switch (field.format) {
		case "image":
			return PLACEHOLDER_IMAGE;
		case "url":
			return "https://example.com/u/alex";
		case "color":
			return "#F05E94";
		case "boolean":
			return "true";
		default:
			return field.title ?? humanize(id);
	}
}

function fieldEntries(template: Template): [string, FieldDefinition][] {
	return Object.entries(template.fields.properties);
}

/** Fields in declaration order. */
export function listFields(template: Template): FieldEntry[] {
	return fieldEntries(template).map(([id, field]) => ({ id, field }));
}

/** Injected by a pipeline rather than typed by a person. */
export function isSystemField(id: string, field: FieldDefinition): boolean {
	return (
		field.readOnly === true ||
		field["x-source"] === "system" ||
		id.startsWith("$$")
	);
}

export function humanize(id: string): string {
	return id
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^./, (c) => c.toUpperCase());
}

/** The fields a template reads, through tokens or `visibleWhen`. */
export function referencedFields(template: Template): Set<string> {
	const found = new Set<string>();
	const scan = (value: unknown) => {
		if (typeof value === "string") {
			for (const m of value.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g))
				found.add(m[1] as string);
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) scan(item);
			return;
		}
		if (value && typeof value === "object") {
			const when = (value as { visibleWhen?: unknown }).visibleWhen;
			for (const cond of Array.isArray(when) ? when : when ? [when] : []) {
				const field = (cond as { field?: unknown }).field;
				if (typeof field === "string") found.add(field);
			}
			for (const item of Object.values(value)) scan(item);
		}
	};
	scan(template.template_data);
	scan(template.variants ?? []);
	return found;
}
