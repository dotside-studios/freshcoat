import { substitute } from "./mustache";

export type StrokeTrimInput = {
	trimStart?: number | string;
	trimEnd?: number | string;
	trimOffset?: number | string;
};

export type ResolvedStrokeTrim = {
	trimStart?: number;
	trimEnd?: number;
	trimOffset?: number;
};

const NUMBER = /^\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)\s*(%?)\s*$/i;

/** A trim value as a number: a number as is, a string as a number or a
 *  percentage. Anything else, such as an empty field, is undefined. */
export function parseTrimValue(value: unknown): number | undefined {
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value !== "string") return undefined;
	const m = NUMBER.exec(value);
	if (!m) return undefined;
	const n = Number(m[1]) / (m[2] ? 100 : 1);
	return Number.isFinite(n) ? n : undefined;
}

/** A stroke's trim with its fields substituted from `values` and parsed.
 *  Start and end are clamped to [0, 1]; unset or unreadable values are left
 *  out. */
export function resolveStrokeTrim(
	stroke: StrokeTrimInput,
	values: Record<string, unknown> = {},
): ResolvedStrokeTrim {
	const out: ResolvedStrokeTrim = {};
	const read = (v: unknown) => parseTrimValue(substitute(v, values));
	const start = read(stroke.trimStart);
	const end = read(stroke.trimEnd);
	const offset = read(stroke.trimOffset);
	if (start !== undefined) out.trimStart = clamp01(start);
	if (end !== undefined) out.trimEnd = clamp01(end);
	if (offset !== undefined) out.trimOffset = offset;
	return out;
}

function clamp01(v: number): number {
	return Math.min(Math.max(v, 0), 1);
}
