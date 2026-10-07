import type { Background, Element, Template } from "@freshcoat-js/coatfile";
import { wholeToken } from "@freshcoat-js/coatfile/tokens";
import type { EditorController } from "~/app/controller";
import { type ElementPatch, type OpResult, ok, updateElement } from "~/doc/ops";

export type Layer = Element | Background;

/** Deep equality for the JSON values a template holds. */
export function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

/** The value every entry shares, or null when they differ (shown as Mixed). */
export function commonValue<T>(values: readonly T[]): T | null {
	if (values.length === 0) return null;
	const first = values[0] as T;
	for (let i = 1; i < values.length; i++)
		if (!sameValue(first, values[i])) return null;
	return first;
}

/** A layer's `properties` as a plain record, for reading optional keys. */
export function propsOf(el: Layer): Record<string, unknown> {
	return el.properties as Record<string, unknown>;
}

export type PatchFn = (el: Layer, key: string) => ElementPatch | null;

/** Applies a per-layer patch to every key; a null patch skips that layer. */
export function patchLayers(
	t: Template,
	keys: readonly string[],
	fn: PatchFn,
	lookup: (t: Template, key: string) => Layer | undefined,
): OpResult {
	let next = t;
	for (const key of keys) {
		const el = lookup(next, key);
		if (!el) continue;
		const patch = fn(el, key);
		if (!patch) continue;
		const r = updateElement(next, key, patch);
		if (!r.ok) return r;
		next = r.template;
	}
	return ok(next, [...keys]);
}

export function mergeKeyOf(field: string, keys: readonly string[]): string {
	return `inspector:${field}:${keys.join(",")}`;
}

/** What every section reads: the selected layers and how to write to them. */
export type Inspect = {
	controller: EditorController;
	template: Template;
	side: number;
	keys: string[];
	layers: Layer[];
	/** Patches every selected layer in one undo step; edits to the same
	 *  `field` within a second merge into it. */
	set: (field: string, fn: PatchFn) => void;
	/** As `set`, on the base while a variant is active: for values a
	 *  variant cannot change (effects, blend, constraints, conditions). */
	setShared: (field: string, fn: PatchFn) => void;
	/** Merges `properties` into every selected layer. */
	setProps: (
		field: string,
		fn: (el: Layer, key: string) => Record<string, unknown> | null,
	) => void;
	swatches: string[];
};

/** Hex colours used across the document, most frequent first, for pickers. */
export function documentSwatches(
	drawing: Template["template_data"],
	limit = 16,
): string[] {
	const counts = new Map<string, number>();
	const scan = (v: unknown) => {
		if (typeof v === "string") {
			if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) {
				const k = v.toLowerCase();
				counts.set(k, (counts.get(k) ?? 0) + 1);
			}
			return;
		}
		if (Array.isArray(v)) for (const x of v) scan(x);
		else if (v && typeof v === "object")
			for (const x of Object.values(v)) scan(x);
	};
	scan(drawing);
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([c]) => c);
}

/** Parses "4 2" or "4, 2" into a dash array; empty clears it. */
export function parseDash(text: string): number[] | undefined | null {
	const s = text.trim();
	if (!s) return undefined;
	const parts = s.split(/[\s,]+/).map(Number);
	if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
	return parts;
}

/** Parses OpenType features written as "tnum, ss01, -liga, salt=2": a tag
 *  alone is on, a leading minus is off, `=n` sets a value. Empty clears them;
 *  anything else is null. */
export function parseFeatures(
	text: string,
): Record<string, number> | undefined | null {
	const s = text.trim();
	if (!s) return undefined;
	const out: Record<string, number> = {};
	for (const part of s.split(/[\s,]+/)) {
		const m = /^(-)?([A-Za-z0-9]{4})(?:=(\d+))?$/.exec(part);
		if (!m || (m[1] && m[3] !== undefined)) return null;
		out[m[2]] = m[1] ? 0 : m[3] !== undefined ? Number(m[3]) : 1;
	}
	return out;
}

/** The inverse of parseFeatures. */
export function formatFeatures(features: Record<string, number>): string {
	return Object.entries(features)
		.map(([tag, v]) => (v === 0 ? `-${tag}` : v === 1 ? tag : `${tag}=${v}`))
		.join(", ");
}

type GridLine = number | [number, number];

/** Parses a grid placement: "2" is one track, "1-3" a span, empty or "auto"
 *  flows. Null for a typo. */
export function parseGridLine(text: string): GridLine | undefined | null {
	const s = text.trim().toLowerCase();
	if (!s || s === "auto") return undefined;
	const m = /^(\d+)(?:\s*[-–/]\s*(\d+))?$/.exec(s);
	if (!m) return null;
	const first = Number(m[1]);
	const last = m[2] === undefined ? first : Number(m[2]);
	if (first < 1 || last < first) return null;
	return first === last ? first : [first, last];
}

export function formatGridLine(line: GridLine | undefined): string {
	if (line === undefined) return "";
	return typeof line === "number" ? String(line) : `${line[0]}-${line[1]}`;
}

/** The field an image's focus is bound to, from "{{key}}", or undefined. */
export function focusFieldOf(focus: unknown): string | undefined {
	if (typeof focus !== "string") return undefined;
	return wholeToken(focus);
}
