// What a template's fields are called and which of them its layers read.
// Runtime-free apart from the mustache parser, so a Figma plugin's sandbox
// can import it.

import { tokenIds } from "./mustache";
import { childElements } from "./tree";
import type {
	Background,
	Element,
	FieldDefinition,
	Template,
	Variant,
} from "./types";

/** A neutral grey stand-in, inline so image-bound layers render offline. */
export const PLACEHOLDER_IMAGE =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mM4efoiVsQwtCQA3z2ZQXrXt2kAAAAASUVORK5CYII=";

/**
 * A field id as a title in sentence case: `display_name`, `display-name` and
 * `displayName` all read "Display name". A word in capitals, such as `QR` or
 * `ID`, keeps them.
 */
export function fieldTitle(id: string): string {
	const words = id
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[\s_-]+/)
		.filter((w) => w !== "");
	return words
		.map((w, i) => {
			if (w.length > 1 && w === w.toUpperCase()) return w;
			const lower = w.toLowerCase();
			return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
		})
		.join(" ");
}

/** Injected by a pipeline rather than typed by a person. */
export function isSystemField(id: string, field: FieldDefinition): boolean {
	return (
		field.readOnly === true ||
		field["x-source"] === "system" ||
		id.startsWith("$$")
	);
}

function addTokens(value: unknown, out: Set<string>): void {
	if (typeof value === "string") {
		for (const id of tokenIds(value)) out.add(id);
	} else if (Array.isArray(value)) {
		for (const item of value) addTokens(item, out);
	} else if (value !== null && typeof value === "object") {
		for (const item of Object.values(value)) addTokens(item, out);
	}
}

function addConditions(el: Element | Background, out: Set<string>): void {
	const when = "visibleWhen" in el ? el.visibleWhen : undefined;
	if (when) for (const cond of [when].flat()) out.add(cond.field);
}

function ownProperties(properties: object): Record<string, unknown> {
	const {
		children: _c,
		mask: _m,
		...own
	} = properties as Record<string, unknown>;
	return own;
}

function addOwn(el: Element | Background, out: Set<string>): void {
	addTokens(ownProperties(el.properties ?? {}), out);
	addConditions(el, out);
}

function eachElement(
	template: Template,
	visit: (el: Element | Background) => void,
): void {
	const walk = (el: Element | Background) => {
		visit(el);
		for (const child of childElements(el)) walk(child);
	};
	for (const side of template.template_data) {
		walk(side.background);
		for (const el of side.elements) walk(el);
	}
}

/**
 * The fields an element itself reads, in the order it names them: tokens in
 * its own properties (text, image, QR and barcode sources, colors) and the
 * fields its `visibleWhen` tests. What it holds is not included.
 */
export function elementFieldRefs(element: Element | Background): string[] {
	const out = new Set<string>();
	addOwn(element, out);
	return [...out];
}

/** The fields a variant's overrides read through tokens. */
export function variantFieldRefs(variant: Variant): string[] {
	const out = new Set<string>();
	for (const override of variant.overrides) {
		if (override.background) addOwn(override.background, out);
		for (const delta of override.elements ?? [])
			addTokens(ownProperties(delta.properties), out);
	}
	return [...out];
}

/** Every field the template reads: each element's, nested ones included, on
 *  every side, then each variant's. */
export function templateFieldRefs(template: Template): string[] {
	const out = new Set<string>();
	eachElement(template, (el) => addOwn(el, out));
	for (const variant of template.variants ?? [])
		for (const id of variantFieldRefs(variant)) out.add(id);
	return [...out];
}

/** The fields some `visibleWhen` in the template tests. */
export function visibilityFieldRefs(template: Template): string[] {
	const out = new Set<string>();
	eachElement(template, (el) => addConditions(el, out));
	return [...out];
}

/** The template's own declared defaults; everything else stays unset. */
export function defaultFieldValues(template: Template): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [id, field] of Object.entries(template.fields.properties)) {
		if (field.default !== undefined) out[id] = field.default;
	}
	return out;
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
			return field.title ?? fieldTitle(id);
	}
}

/**
 * Defaults plus a stand-in for every field left blank, so a template renders
 * complete. Text fields fall back to their own title, which shows which layer
 * each field feeds.
 *
 * A field that shows or hides a layer and declares an empty default keeps it:
 * the empty value is the design's own answer to "is it there", and a stand-in
 * would show an optional layer (a logo, a badge) nobody has filled.
 */
export function sampleValues(template: Template): Record<string, string> {
	const out = defaultFieldValues(template);
	const gates = new Set(visibilityFieldRefs(template));
	for (const [id, field] of Object.entries(template.fields.properties)) {
		if (out[id]) continue;
		if (field.default === "" && gates.has(id)) continue;
		out[id] = sampleFor(id, field);
	}
	return out;
}
