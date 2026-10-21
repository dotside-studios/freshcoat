import {
	FORMAT_MAJOR,
	formatMinor,
	formatVersionStatus,
} from "./format-version";
import { schemaFormatMinor } from "./format-walk";
import { ElementSchema, TemplateSchema } from "./schemas";
import type { Template } from "./types";

// The wire format's own version, as `format_version` carries it.
//
// A major version is a contract: a reader refuses one it does not know. A minor
// version only adds optional fields, so every 1.x file reads with any 1.x kit.
// What a minor version does restrict is writing. Validation strips keys it does
// not recognise, so a kit that re-saves a file from a newer minor would drop
// whatever that minor added. `formatVersionStatus` is how a writer finds out
// before it does that.
//
//   1.0  the original format
//   1.1  `product` and `version` optional; `$schema` kept
//   1.2  linear fill `from` / `to`; element `constraints`
//   1.3  the `barcode` element
//   1.4  variant deltas: `pos`, `size`, `rotation`, `opacity`, `hidden`
//   1.5  `grid` layout; element `adjust`; image `focus` and `crop`; template
//        `bleed` and `safeArea`; text `justify`, `start` and `end` alignment,
//        `alignLast`, `direction`, `paragraphSpacing` and font `features`;
//        per-corner frame `cornerRadius`; `linear-burn` blend mode; barcode
//        `bearerBars`
//   1.6  frame `isolate`; text `arc` and `path`; element `backdropBlur`;
//        gradient stroke `color`; variant `size`; vector `boolean`
//   1.7  rect and vector `slice`; element `hidden`; text `stroke` and
//        `pdfText`; frame `cornerSmoothing`; per-corner image `cornerRadius`
//        and image `cornerSmoothing`; rect and frame stroke `width` per side;
//        element `effects`, with `grain` and `halftone` (and its `anchor`);
//        rect and vector `spot`; QR `quietZone`, `moduleShape`, `finderOuter`,
//        `finderInner`, `gradient` and `logo`

export {
	FORMAT_HISTORY,
	FORMAT_MAJOR,
	FORMAT_MINOR,
	FORMAT_VERSION,
	type FormatVersionStatus,
	formatMinor,
	formatVersionStatus,
} from "./format-version";

/**
 * The lowest 1.x a reader needs to keep every field `template` uses, from the
 * minors `formatHistory` tags in the schema.
 */
export function minimumFormatVersion(template: Template): string {
	let minor = schemaFormatMinor(TemplateSchema, template);
	for (const override of OVERRIDES) minor = Math.max(minor, override(template));
	return `${FORMAT_MAJOR}.${minor}`;
}

// What a tag cannot say, because it turns on a key being absent or on another
// part of the template.
const OVERRIDES: ((template: Template) => number)[] = [
	// 1.1 made `product` and `version` optional.
	(t) => (t.product === undefined || t.version === undefined ? 1 : 0),
	// A delta's `properties` is a bare record: read it as the properties of the
	// element it targets.
	(t) => {
		const types = elementTypes(t);
		let minor = 0;
		for (const variant of t.variants ?? [])
			for (const override of variant.overrides)
				for (const delta of override.elements ?? [])
					for (const type of types.get(delta.id) ?? [])
						minor = Math.max(
							minor,
							schemaFormatMinor(ElementSchema, {
								type,
								properties: delta.properties,
							}),
						);
		return minor;
	},
];

// Each element id's type, wherever in the template the element sits.
function elementTypes(template: Template): Map<string, Set<string>> {
	const types = new Map<string, Set<string>>();
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (node === null || typeof node !== "object") return;
		const o = node as Record<string, unknown>;
		if (typeof o.id === "string" && typeof o.type === "string")
			types.set(o.id, (types.get(o.id) ?? new Set()).add(o.type));
		for (const value of Object.values(o)) visit(value);
	};
	visit(template.template_data);
	visit(template.variants);
	return types;
}

/**
 * `template` with `format_version` raised to `minimumFormatVersion`, so a kit
 * that only reads the older minor refuses to re-save it rather than dropping
 * fields. Never lowers it, and leaves a version this kit does not write alone.
 * Returns `template` itself when nothing changes.
 */
export function raiseFormatVersion<T extends Template>(template: T): T {
	if (formatVersionStatus(template.format_version) !== "current")
		return template;
	const needed = minimumFormatVersion(template);
	return formatMinor(needed) > formatMinor(template.format_version)
		? { ...template, format_version: needed }
		: template;
}
