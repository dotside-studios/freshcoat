import type { Template } from "@freshcoat-js/coatfile";

export type RefusalCode =
	| "not_found"
	| "background"
	| "mask_source"
	| "not_a_container"
	| "not_a_frame"
	| "into_descendant"
	| "cross_side"
	| "not_siblings"
	| "empty_selection"
	| "rotated"
	| "auto_layout"
	| "empty_id"
	| "duplicate_id"
	| "empty_name"
	| "duplicate_side"
	| "last_side"
	| "invalid_index"
	| "invalid_size"
	| "invalid_inset"
	| "safe_area_too_large"
	| "invalid_field_key"
	| "duplicate_field"
	| "unknown_field"
	| "field_in_use"
	| "duplicate_font"
	| "unknown_font"
	| "font_in_use"
	| "too_few"
	| "not_a_shape"
	| "empty_result"
	| "last_operand"
	| "unknown_variant"
	| "empty_label"
	| "invalid_variant_id"
	| "duplicate_variant_id";

export type OpOk = { ok: true; template: Template; keys?: string[] };
export type OpRefused = {
	ok: false;
	code: RefusalCode;
	/** A sentence for the person, fit for a toast. */
	reason: string;
	/** Layer keys (or `variant:<id>`) that block the operation. */
	references?: string[];
};
export type OpResult = OpOk | OpRefused;

export function ok(template: Template, keys?: string[]): OpOk {
	return keys === undefined
		? { ok: true, template }
		: { ok: true, template, keys };
}

export function refuse(
	code: RefusalCode,
	reason: string,
	references?: string[],
): OpRefused {
	return references === undefined
		? { ok: false, code, reason }
		: { ok: false, code, reason, references };
}

/** The successful result, or a throw carrying the refusal's reason. */
export function unwrap(r: OpResult): OpOk {
	if (!r.ok) throw new Error(`${r.code}: ${r.reason}`);
	return r;
}
