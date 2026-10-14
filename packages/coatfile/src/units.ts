import { MM_PER_INCH } from "@freshcoat-js/engine";

/** A unit a design length can be shown in. Design px are dots at the DPI. */
export type LengthUnit = "px" | "mm" | "in" | "pt";

export const LENGTH_UNITS: readonly LengthUnit[] = ["px", "mm", "in", "pt"];

const POINTS_PER_INCH = 72;

export function isLengthUnit(value: unknown): value is LengthUnit {
	return LENGTH_UNITS.includes(value as LengthUnit);
}

/** Design px in one `unit` at `dpi`. */
export function pxPerUnit(unit: LengthUnit | "cm", dpi: number): number {
	switch (unit) {
		case "px":
			return 1;
		case "mm":
			return dpi / MM_PER_INCH;
		case "cm":
			return (dpi / MM_PER_INCH) * 10;
		case "in":
			return dpi;
		case "pt":
			return dpi / POINTS_PER_INCH;
	}
}

export function pxToUnit(px: number, unit: LengthUnit, dpi: number): number {
	return unit === "px" ? px : px / pxPerUnit(unit, dpi);
}

export function unitToPx(value: number, unit: LengthUnit, dpi: number): number {
	return unit === "px" ? value : value * pxPerUnit(unit, dpi);
}

/** Fraction digits a length shows in `unit`. */
export function unitPrecision(unit: LengthUnit): number {
	return unit === "in" ? 3 : 2;
}

/** `value` rounded for display in `unit`. */
export function roundForUnit(value: number, unit: LengthUnit): number {
	const f = 10 ** unitPrecision(unit);
	const r = Math.round(value * f) / f;
	return r === 0 ? 0 : r;
}

/** A design px length as text in `unit`, e.g. `85.68 mm`. */
export function formatLength(
	px: number,
	unit: LengthUnit,
	dpi: number,
	{ suffix = true }: { suffix?: boolean } = {},
): string {
	const v = String(roundForUnit(pxToUnit(px, unit, dpi), unit));
	return suffix ? `${v} ${unit}` : v;
}

const SUFFIXED = /(\d+\.?\d*|\.\d+)\s*(px|mm|cm|in|pt)(?![a-z])/gi;

/**
 * Rewrites each suffixed number in `text` (`3mm`, `0.125 in`, `12pt`, `40px`,
 * `1cm`) as that length in `unit`, so `10mm + 2` in inches reads as
 * `0.3937… + 2`. Bare numbers are left in `unit`.
 */
export function resolveUnitSuffixes(
	text: string,
	unit: LengthUnit,
	dpi: number,
): string {
	return text.replace(SUFFIXED, (_, n: string, from: string) => {
		const suffix = from.toLowerCase() as LengthUnit | "cm";
		if (suffix === unit) return n;
		const px = Number.parseFloat(n) * pxPerUnit(suffix, dpi);
		return plain(pxToUnit(px, unit, dpi));
	});
}

/**
 * Reads one length such as `3mm`, `0.125in` or `40`, with a bare number in
 * `unit`. Returns design px, or null when the text is not a length.
 */
export function parseLength(
	text: string,
	unit: LengthUnit,
	dpi: number,
): number | null {
	const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(px|mm|cm|in|pt)?\s*$/i.exec(
		text,
	);
	if (!m) return null;
	const n = Number.parseFloat(m[1] as string);
	const from = (m[2]?.toLowerCase() ?? unit) as LengthUnit | "cm";
	return n * pxPerUnit(from, dpi);
}

function plain(n: number): string {
	const s = String(n);
	return s.includes("e") ? n.toFixed(12) : s;
}
