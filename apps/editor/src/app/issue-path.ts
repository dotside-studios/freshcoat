import type {
	FieldDefinition,
	Template,
	ValidationError,
} from "@freshcoat-js/coatfile";
import { FIELD_ID } from "@freshcoat-js/coatfile/mustache";
import { getElement, keyOf, MASK_SOURCE } from "~/doc/path";
import { ISSUE_COPY as C } from "./copy";

/** Splits a JSON pointer (`/a/0`), a slash or dotted path, or a zod path array. */
export function pathSegments(path: string | (string | number)[]): string[] {
	if (Array.isArray(path)) return path.map(String);
	const trimmed = path.replace(/^[/.]+/, "");
	if (trimmed === "") return [];
	const parts = trimmed.includes("/") ? trimmed.split("/") : trimmed.split(".");
	return parts.map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
}

const INDEX = /^\d+$/;

/**
 * The layer key a validation path points into, or null when it points at
 * something that is not a layer (fields, variants, the template itself). With
 * a template, a key that no longer resolves is null too.
 */
export function issuePathToKey(
	path: string | (string | number)[],
	template?: Template,
): string | null {
	const seg = pathSegments(path);
	if (seg[0] !== "template_data" || !INDEX.test(seg[1] ?? "")) return null;
	const side = Number(seg[1]);
	let key: string | null = null;
	if (seg[2] === "background") key = keyOf({ side, background: true });
	else if (seg[2] === "elements" && INDEX.test(seg[3] ?? "")) {
		const indexes = [Number(seg[3])];
		let i = 4;
		while (seg[i] === "properties") {
			if (seg[i + 1] === "children" && INDEX.test(seg[i + 2] ?? "")) {
				indexes.push(Number(seg[i + 2]));
				i += 3;
			} else if (seg[i + 1] === "mask") {
				indexes.push(MASK_SOURCE);
				i += 2;
			} else break;
		}
		key = keyOf({ side, path: indexes });
	}
	if (key && template && !getElement(template, key)) return null;
	return key;
}

/** Names for the schema keys whose own spelling reads badly. */
const KEY_NAMES: Record<string, string> = {
	template_data: "Sides",
	elements: "Layers",
	properties: "Layer settings",
	visibleWhen: "Visibility condition",
	pos: "Position",
	textSize: "Text size",
};

/** A schema key as words: `fontSize` and `font_size` read "Font size". */
function keyName(key: string): string {
	const known = KEY_NAMES[key];
	if (known) return known;
	const words = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What an invalid value is called: the key it sits under, or, for one item
 *  of a list, what the list holds. */
function subject(seg: string[], last: string): string {
	if (INDEX.test(seg.at(-1) ?? "")) {
		if (last === "elements" || last === "children") return "This layer";
		if (last === "template_data") return "This side";
		if (last === "variants") return "This variant";
	}
	return keyName(last);
}

const quoted = (message: string) => /"([^"]+)"/.exec(message)?.[1];

/**
 * A validation issue in the editor's words. The coatfile's own message is
 * written for whoever reads the file (`mustache reference {{x}} has no
 * matching field`), so each code the schema raises gets copy here; a code
 * without any falls back to that message.
 */
export function issueMessage(
	issue: ValidationError,
	template?: Template,
): string {
	const seg = pathSegments(issue.path);
	const last = [...seg].reverse().find((s) => !INDEX.test(s));
	const variant =
		seg[0] === "variants" && INDEX.test(seg[1] ?? "")
			? (template?.variants?.[Number(seg[1])]?.label ?? "A variant")
			: "A variant";
	const name = quoted(issue.message);
	switch (issue.code) {
		case "unknown_field_reference": {
			const missing = missingField(issue);
			if (!missing) return issue.message;
			return missing.condition
				? C.unknownConditionField(missing.id)
				: C.unknownField(missing.id);
		}
		case "duplicate_element_id":
			return name ? C.duplicateLayer(name) : issue.message;
		case "missing_element_id":
			return C.unnamedLayer;
		case "duplicate_frame_name":
			return name ? C.duplicateSide(name) : issue.message;
		case "missing_frame_name":
			return C.unnamedSide;
		case "empty_template_data":
			return C.noSides;
		case "background_must_fill_frame":
			return C.backgroundFill;
		case "invalid_dimension":
			return C.dimension(keyName(last ?? "size"));
		case "missing_required_field":
			return C.required((last ?? "name").toLowerCase());
		case "empty_optional_field":
			return C.emptyOptional((last ?? "version").toLowerCase());
		case "missing_format_version":
			return C.noFormatVersion;
		case "unsupported_format_version":
			return C.newerFormat;
		case "missing_variant_id":
			return C.unnamedVariantId;
		case "duplicate_variant_id":
			return name ? C.duplicateVariant(name) : issue.message;
		case "missing_variant_label":
			return C.unnamedVariant;
		case "missing_override_name":
			return C.overrideNoSide(variant);
		case "unknown_frame_name":
			return name ? C.overrideUnknownSide(variant, name) : issue.message;
		case "duplicate_override_name":
			return name ? C.overrideTwice(variant, name) : issue.message;
		case "invalid_boolean_default":
			return seg[0] === "fields" && seg[2]
				? C.booleanDefault(seg[2])
				: issue.message;
		case "invalid_fill_kind":
			return C.fillKind;
		case "gradient_needs_two_stops":
			return C.twoStops;
		case "invalid_stop_offset":
			return C.stopOffset;
		case "invalid_stop_color":
			return C.stopColor;
		case "gradient_degenerate":
			return C.sameEnds;
		case "font_family_required":
			return C.fontFamily;
		case "duplicate_font_family":
			return name ? C.duplicateFont(name) : issue.message;
		case "stylesheet_font_url_required":
			return C.fontUrl;
		case "local_font_files_required":
			return C.fontFiles;
		case "local_font_file_src_required":
			return C.fontFileSrc;
		case "invalid_background_type":
			return C.backgroundType;
		case "not_an_object":
			return C.notATemplate;
		case "invalid_template_data":
			return C.sides;
		case "invalid_fields_schema":
			return C.fields;
		case "invalid_shape": {
			const unknown = /^Unrecognized keys?: (.+)$/.exec(issue.message)?.[1];
			if (unknown) return C.unknownSetting(unknown.replace(/"/g, ""));
			return last ? C.invalid(subject(seg, last)) : C.notATemplate;
		}
		default:
			return issue.message;
	}
}

/** The field an `unknown_field_reference` names, and the format a field made
 *  for it starts with: an image source's is an image, a condition's yes / no. */
export function missingField(issue: ValidationError): {
	id: string;
	condition: boolean;
	format?: FieldDefinition["format"];
} | null {
	if (issue.code !== "unknown_field_reference") return null;
	const mustache = /\{\{\s*([^}]+?)\s*\}\}/.exec(issue.message)?.[1];
	if (mustache) {
		const src = pathSegments(issue.path).at(-1) === "src";
		return {
			id: mustache,
			condition: false,
			format: src ? "image" : undefined,
		};
	}
	const name = quoted(issue.message);
	return name ? { id: name, condition: true, format: "boolean" } : null;
}

export function canCreateField(id: string, template: Template): boolean {
	return FIELD_ID.test(id) && !(id in template.fields.properties);
}
