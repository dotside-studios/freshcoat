import { findAssetByName, hasAssetSha, parseAssetRef } from "./assets";
import { newId } from "./ids";
import type {
	CellIssue,
	CellValue,
	CoerceResult,
	Column,
	ColumnType,
	DataRecord,
	DatasetAsset,
	DateOrder,
} from "./types";

export const COLUMN_TYPES: readonly ColumnType[] = [
	"text",
	"longText",
	"number",
	"integer",
	"boolean",
	"date",
	"color",
	"url",
	"email",
	"image",
];

export type CoerceOptions = {
	/** How an ambiguous `03/04/2025` reads. Default `mdy`. */
	dateOrder?: DateOrder;
	/** Image cells naming one of these by file name become `ws:<sha>`. */
	assets?: readonly DatasetAsset[];
};

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "on", "✓"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "off", ""]);

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

// Excel counts days from 1899-12-30 once its phantom 29 February 1900 is
// behind it, which covers every date a record is likely to hold.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
// Below this a bare number is far likelier a typo than a date before 1927.
const MIN_TEXT_SERIAL = 10_000;
const MAX_SERIAL = 2_958_465;

const CSS_COLOR_NAMES = new Set(
	(
		"aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
		"blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
		"chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
		"darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
		"darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
		"darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
		"deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
		"forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
		"greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
		"lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
		"lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " +
		"lightsalmon lightseagreen lightskyblue lightslategray lightslategrey " +
		"lightsteelblue lightyellow lime limegreen linen magenta maroon " +
		"mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
		"mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
		"midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
		"olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise " +
		"palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
		"rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
		"seagreen seashell sienna silver skyblue slateblue slategray slategrey " +
		"snow springgreen steelblue tan teal thistle tomato turquoise violet " +
		"wheat white whitesmoke yellow yellowgreen transparent"
	).split(" "),
);

export function isEmptyValue(value: CellValue | undefined): boolean {
	return value === null || value === undefined || value === "";
}

export function isColor(value: string): boolean {
	return HEX_COLOR.test(value) || CSS_COLOR_NAMES.has(value.toLowerCase());
}

export function isUrl(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

/** A real calendar date, `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	return m !== null && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function validDate(y: number, m: number, d: number): boolean {
	if (m < 1 || m > 12 || d < 1) return false;
	const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return d <= days;
}

function isoDate(y: number, m: number, d: number): string {
	return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** SheetJS builds its dates in UTC, so the calendar day is read in UTC. */
export function dateToIso(date: Date): string | null {
	if (Number.isNaN(date.getTime())) return null;
	return isoDate(
		date.getUTCFullYear(),
		date.getUTCMonth() + 1,
		date.getUTCDate(),
	);
}

export function serialToIso(serial: number): string | null {
	if (!Number.isFinite(serial) || serial < 1 || serial > MAX_SERIAL) {
		return null;
	}
	return dateToIso(new Date(EXCEL_EPOCH_MS + Math.floor(serial) * DAY_MS));
}

export function isoToSerial(iso: string): number | null {
	if (!isIsoDate(iso)) return null;
	const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
	return (Date.UTC(y, m - 1, d) - EXCEL_EPOCH_MS) / DAY_MS;
}

/** A date written as text, as `YYYY-MM-DD`, or null when it is not one. */
export function parseDateText(
	text: string,
	order: DateOrder = "mdy",
): string | null {
	const s = text.trim();
	const iso = ISO_DATE.exec(s);
	if (iso) {
		const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
		return validDate(y, m, d) ? isoDate(y, m, d) : null;
	}
	const slash = SLASH_DATE.exec(s);
	if (slash) {
		const a = Number(slash[1]);
		const b = Number(slash[2]);
		const y = Number(slash[3]);
		const [m, d] = order === "dmy" ? [b, a] : [a, b];
		return validDate(y, m, d) ? isoDate(y, m, d) : null;
	}
	if (/^\d+(\.\d+)?$/.test(s) && Number(s) >= MIN_TEXT_SERIAL) {
		return serialToIso(Number(s));
	}
	return null;
}

/** A number typed with thousands separators or spaces, or null. */
export function parseNumberText(text: string): number | null {
	const s = text.replace(/[,\s]/g, "");
	if (s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) {
		return null;
	}
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}

export function parseBooleanText(text: string): boolean | null {
	const s = text.trim().toLowerCase();
	if (TRUE_WORDS.has(s)) return true;
	if (FALSE_WORDS.has(s)) return false;
	return null;
}

function rawText(raw: unknown): string {
	if (raw instanceof Date) return dateToIso(raw) ?? "";
	if (typeof raw === "string") return raw;
	if (raw === null || raw === undefined) return "";
	if (typeof raw === "object") return JSON.stringify(raw);
	return String(raw);
}

function fail(raw: unknown, message: string): CoerceResult {
	return { value: rawText(raw), ok: false, message };
}

/**
 * The value a column stores for whatever was typed or imported. Never throws:
 * a value that does not fit keeps its text, so nothing is lost, and comes
 * back with `ok: false` and the reason. Empty input is `null`, except for a
 * boolean, where it is `false`.
 */
export function coerce(
	column: Column,
	raw: unknown,
	options: CoerceOptions = {},
): CoerceResult {
	if (raw === undefined) raw = null;
	if (raw === null) {
		return { value: column.type === "boolean" ? false : null, ok: true };
	}
	switch (column.type) {
		case "number":
		case "integer": {
			let n: number | null;
			if (typeof raw === "number") n = Number.isFinite(raw) ? raw : null;
			else if (typeof raw === "string") {
				if (raw.trim() === "") return { value: null, ok: true };
				n = parseNumberText(raw);
			} else n = null;
			if (n === null) return fail(raw, "Not a number");
			if (column.type === "integer" && !Number.isInteger(n)) {
				return fail(raw, "Not a whole number");
			}
			return { value: n, ok: true };
		}
		case "boolean": {
			if (typeof raw === "boolean") return { value: raw, ok: true };
			if (typeof raw === "number" && (raw === 0 || raw === 1)) {
				return { value: raw === 1, ok: true };
			}
			const b = typeof raw === "string" ? parseBooleanText(raw) : null;
			return b === null ? fail(raw, "Not yes or no") : { value: b, ok: true };
		}
		case "date": {
			let iso: string | null;
			if (raw instanceof Date) iso = dateToIso(raw);
			else if (typeof raw === "number") iso = serialToIso(raw);
			else if (typeof raw === "string") {
				if (raw.trim() === "") return { value: null, ok: true };
				iso = parseDateText(raw, options.dateOrder);
			} else iso = null;
			return iso === null ? fail(raw, "Not a date") : { value: iso, ok: true };
		}
		case "longText": {
			const text = rawText(raw).replace(/\r\n?/g, "\n");
			return { value: text === "" ? null : text, ok: true };
		}
		case "image": {
			const text = rawText(raw).trim();
			if (text === "") return { value: null, ok: true };
			if (parseAssetRef(text) === null && options.assets) {
				const asset = findAssetByName(options.assets, text);
				if (asset) return { value: `ws:${asset.sha256}`, ok: true };
			}
			return { value: text, ok: true };
		}
		default: {
			const text = rawText(raw).replace(/\r/g, "");
			const value = column.type === "text" ? text : text.trim();
			return { value: value === "" ? null : value, ok: true };
		}
	}
}

function typeIssue(
	column: Column,
	value: CellValue,
	assets: readonly DatasetAsset[] | undefined,
): string | null {
	switch (column.type) {
		case "number":
		case "integer":
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return "Not a number";
			}
			if (column.type === "integer" && !Number.isInteger(value)) {
				return "Not a whole number";
			}
			if (column.minimum !== undefined && value < column.minimum) {
				return `Less than ${column.minimum}`;
			}
			if (column.maximum !== undefined && value > column.maximum) {
				return `More than ${column.maximum}`;
			}
			return null;
		case "boolean":
			return typeof value === "boolean" ? null : "Not yes or no";
		case "date":
			return typeof value === "string" && isIsoDate(value)
				? null
				: "Not a date";
		case "color":
			return typeof value === "string" && isColor(value)
				? null
				: "Not a colour";
		case "url":
			return typeof value === "string" && isUrl(value) ? null : "Not a URL";
		case "email":
			return typeof value === "string" && EMAIL_PATTERN.test(value)
				? null
				: "Not an email address";
		case "image": {
			if (typeof value !== "string") return "Not an image";
			const sha = parseAssetRef(value);
			if (sha !== null) {
				if (assets === undefined || hasAssetSha(assets, sha)) {
					return null;
				}
				return "Photo is not in this dataset";
			}
			if (/^(https?:|data:)/i.test(value)) return null;
			return `No photo named ${value}`;
		}
		default:
			return typeof value === "string" ? null : "Not text";
	}
}

const patterns = new Map<string, RegExp | null>();

function compiledPattern(pattern: string): RegExp | null {
	let re = patterns.get(pattern);
	if (re === undefined) {
		try {
			re = new RegExp(pattern, "u");
		} catch {
			re = null;
		}
		patterns.set(pattern, re);
	}
	return re;
}

function textIssue(column: Column, value: string): string | null {
	if (column.minLength !== undefined && value.length < column.minLength) {
		return `Shorter than ${column.minLength} characters`;
	}
	if (column.maxLength !== undefined && value.length > column.maxLength) {
		return `Longer than ${column.maxLength} characters`;
	}
	if (column.pattern !== undefined) {
		const re = compiledPattern(column.pattern);
		if (re !== null && !re.test(value)) return "Does not match the pattern";
	}
	if (
		column.type === "text" &&
		column.enum !== undefined &&
		column.enum.length > 0 &&
		!column.enum.includes(value)
	) {
		return `Not one of ${column.enum.join(", ")}`;
	}
	return null;
}

/** One issue per column at most: the first rule its value breaks. Pass the
 *  dataset's assets to check that `ws:` references resolve. */
export function validateRecord(
	columns: readonly Column[],
	values: Readonly<Record<string, CellValue>>,
	assets?: readonly DatasetAsset[],
): CellIssue[] {
	const issues: CellIssue[] = [];
	for (const column of columns) {
		const value = values[column.key] ?? null;
		if (isEmptyValue(value)) {
			if (column.required) {
				issues.push({ column: column.key, message: "Required" });
			}
			continue;
		}
		const message =
			typeIssue(column, value, assets) ??
			(typeof value === "string" &&
			column.type !== "date" &&
			column.type !== "image"
				? textIssue(column, value)
				: null);
		if (message !== null) issues.push({ column: column.key, message });
	}
	return issues;
}

/** The string coatfile substitutes for a cell. */
export function toTemplateValue(_column: Column, value: CellValue): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value);
}

/** A column's value in a new record: its default, or empty. */
export function defaultValue(column: Column): CellValue {
	if (column.default !== undefined) return column.default;
	return column.type === "boolean" ? false : null;
}

/** The values a new record starts with: each column's default, where it has
 *  one. Empty columns are left out. */
export function defaultValues(
	columns: readonly Column[],
): Record<string, CellValue> {
	const values: Record<string, CellValue> = {};
	for (const column of columns) {
		const value = defaultValue(column);
		if (!isEmptyValue(value)) values[column.key] = value;
	}
	return values;
}

export function newRecord(
	columns: readonly Column[],
	values: Record<string, CellValue> = {},
): DataRecord {
	return {
		id: newId("r"),
		values: { ...defaultValues(columns), ...values },
		status: "pending",
	};
}
