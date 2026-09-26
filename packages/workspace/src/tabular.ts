import { assetForRef } from "./assets";
import { dateToIso, isIsoDate, isoToSerial } from "./columns";
import type {
	CellValue,
	Column,
	Dataset,
	TableFormat,
	TableSheet,
	WrittenTable,
} from "./types";

export type TabularErrorCode =
	| "empty_file"
	| "unsupported_format"
	| "invalid_file";

export class TabularError extends Error {
	constructor(
		readonly code: TabularErrorCode,
		message: string,
	) {
		super(message);
		this.name = "TabularError";
	}
}

type Sheets = { sheets: TableSheet[] };

const TEXT_FORMATS = new Set(["csv", "tsv", "txt"]);
const ZIP_FORMATS = new Set(["xlsx", "xlsm", "ods", "numbers"]);
const WORKBOOK_FORMATS = new Set(["xlsx", "xlsm", "xls", "ods", "numbers"]);

export const TABLE_EXTENSIONS: readonly string[] = [
	"csv",
	"tsv",
	"txt",
	"json",
	"ndjson",
	"jsonl",
	...WORKBOOK_FORMATS,
];

const MEDIA_TYPES: Record<TableFormat, string> = {
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	json: "application/json",
	ndjson: "application/x-ndjson",
};

function extensionOf(fileName: string): string {
	const dot = fileName.lastIndexOf(".");
	return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

// A file saved by Excel on Windows is often not UTF-8; reading it as UTF-8
// would turn every accented letter into a replacement character.
function decodeText(input: Uint8Array | string): string {
	let text: string;
	if (typeof input === "string") text = input;
	else {
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(input);
		} catch {
			text = new TextDecoder("windows-1252").decode(input);
		}
	}
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function cellText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** Rows of equal width, with empty trailing rows and columns removed. */
function trim(rows: string[][]): string[][] {
	const filled = (cell: string | undefined) =>
		cell !== undefined && cell.trim() !== "";
	let height = rows.length;
	while (height > 0 && !(rows[height - 1] ?? []).some(filled)) height -= 1;
	let width = 0;
	for (let r = 0; r < height; r++) {
		const row = rows[r] ?? [];
		for (let c = row.length - 1; c >= width; c--) {
			if (filled(row[c])) {
				width = c + 1;
				break;
			}
		}
	}
	return rows
		.slice(0, height)
		.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? ""));
}

function objectsToRows(items: unknown[]): string[][] {
	if (items.every(Array.isArray)) {
		return (items as unknown[][]).map((row) => row.map(cellText));
	}
	const header: string[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new TabularError("invalid_file", "Expected a list of objects");
		}
		for (const key of Object.keys(item)) {
			if (!seen.has(key)) {
				seen.add(key);
				header.push(key);
			}
		}
	}
	const body = items.map((item) =>
		header.map((key) => cellText((item as Record<string, unknown>)[key])),
	);
	return [header, ...body];
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new TabularError(
			"invalid_file",
			err instanceof Error ? err.message : String(err),
		);
	}
}

function readJson(text: string): string[][] {
	if (text.trim() === "") return [];
	const doc = parseJson(text);
	let items: unknown = doc;
	if (!Array.isArray(doc) && typeof doc === "object" && doc !== null) {
		const wrapper = doc as Record<string, unknown>;
		items = wrapper.records ?? wrapper.rows ?? wrapper.data;
	}
	if (!Array.isArray(items)) {
		throw new TabularError(
			"invalid_file",
			"Expected an array, or an object with records, rows or data",
		);
	}
	return objectsToRows(items);
}

function readNdjson(text: string): string[][] {
	const items = text
		.split(/\r?\n/)
		.filter((line) => line.trim() !== "")
		.map(parseJson);
	return items.length === 0 ? [] : objectsToRows(items);
}

type XlsxModule = typeof import("xlsx");
type WorkSheet = import("xlsx").WorkSheet;

async function loadXlsx(): Promise<XlsxModule> {
	const mod = (await import("xlsx")) as XlsxModule & { default?: XlsxModule };
	return mod.utils ? mod : (mod.default as XlsxModule);
}

function sheetRows(XLSX: XlsxModule, sheet: WorkSheet): string[][] {
	const ref = sheet["!ref"];
	if (ref === undefined) return [];
	const range = XLSX.utils.decode_range(ref);
	const rows: string[][] = [];
	for (let r = range.s.r; r <= range.e.r; r++) {
		const row: string[] = [];
		for (let c = range.s.c; c <= range.e.c; c++) {
			const cell = sheet[XLSX.utils.encode_cell({ r, c })] as
				| { t: string; v?: unknown; w?: string }
				| undefined;
			if (cell === undefined || cell.t === "z") row.push("");
			else if (cell.t === "d" && cell.v instanceof Date) {
				row.push(dateToIso(cell.v) ?? cell.w ?? "");
			} else if (cell.t === "d" && typeof cell.v === "string") {
				row.push(cell.v.slice(0, 10));
			} else row.push(cell.w ?? cellText(cell.v));
		}
		rows.push(row);
	}
	return rows;
}

/**
 * The sheets of a table file, each as a matrix of strings. The extension picks
 * the reader. Rejects with a `TabularError`: `empty_file` when there are no
 * cells, `unsupported_format` for an extension it does not read, and
 * `invalid_file` when the contents do not parse.
 */
export async function readTable(
	input: Uint8Array | string,
	fileName: string,
): Promise<Sheets> {
	const ext = extensionOf(fileName);
	const base = fileName.replace(/\.[^.]*$/, "") || "Sheet1";
	let sheets: TableSheet[];
	if (ext === "json") {
		sheets = [{ name: base, rows: readJson(decodeText(input)) }];
	} else if (ext === "ndjson" || ext === "jsonl") {
		sheets = [{ name: base, rows: readNdjson(decodeText(input)) }];
	} else if (TEXT_FORMATS.has(ext)) {
		const text = decodeText(input);
		if (text.trim() === "") sheets = [];
		else {
			const XLSX = await loadXlsx();
			const wb = XLSX.read(text, {
				type: "string",
				raw: true,
				...(ext === "tsv" ? { FS: "\t" } : {}),
			});
			sheets = wb.SheetNames.map((name) => ({
				name: base,
				rows: sheetRows(XLSX, wb.Sheets[name] as WorkSheet),
			}));
		}
	} else if (WORKBOOK_FORMATS.has(ext)) {
		if (typeof input === "string") {
			throw new TabularError("invalid_file", `A .${ext} file is binary`);
		}
		// SheetJS reads nearly any bytes as some kind of sheet, so a file that
		// names a zip-based format has to be one.
		if (ZIP_FORMATS.has(ext) && !(input[0] === 0x50 && input[1] === 0x4b)) {
			throw new TabularError("invalid_file", `Not a .${ext} file`);
		}
		const XLSX = await loadXlsx();
		let wb: import("xlsx").WorkBook;
		try {
			wb = XLSX.read(input, { type: "array", cellDates: true });
		} catch (err) {
			throw new TabularError(
				"invalid_file",
				err instanceof Error ? err.message : String(err),
			);
		}
		sheets = wb.SheetNames.map((name) => ({
			name,
			rows: sheetRows(XLSX, wb.Sheets[name] as WorkSheet),
		}));
	} else {
		throw new TabularError(
			"unsupported_format",
			ext === "" ? `${fileName} has no extension` : `.${ext} is not a table`,
		);
	}
	const nonEmpty = sheets
		.map((sheet) => ({ name: sheet.name, rows: trim(sheet.rows) }))
		.filter((sheet) => sheet.rows.length > 0);
	if (nonEmpty.length === 0) {
		throw new TabularError("empty_file", `${fileName} has no cells`);
	}
	return { sheets: nonEmpty };
}

/** The text a cell exports as: an image as its asset's file name. */
function exportText(
	dataset: Dataset,
	column: Column,
	value: CellValue | undefined,
): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (column.type === "image") {
		return assetForRef(dataset, value)?.name ?? String(value);
	}
	return String(value);
}

function exportValue(
	dataset: Dataset,
	column: Column,
	value: CellValue | undefined,
): CellValue {
	if (value === undefined) return null;
	if (column.type === "image" && typeof value === "string") {
		return exportText(dataset, column, value);
	}
	return value;
}

function delimited(dataset: Dataset, separator: string): string {
	const quote = (text: string) =>
		text.includes(separator) || /["\r\n]/.test(text)
			? `"${text.replace(/"/g, '""')}"`
			: text;
	const lines = [
		dataset.columns.map((c) => quote(c.key)).join(separator),
		...dataset.records.map((record) =>
			dataset.columns
				.map((c) => quote(exportText(dataset, c, record.values[c.key])))
				.join(separator),
		),
	];
	// The byte order mark is what makes Excel read the file as UTF-8.
	return `﻿${lines.join("\r\n")}\r\n`;
}

function recordObjects(dataset: Dataset): Record<string, CellValue>[] {
	return dataset.records.map((record) =>
		Object.fromEntries(
			dataset.columns.map((c) => [
				c.key,
				exportValue(dataset, c, record.values[c.key]),
			]),
		),
	);
}

/** A sheet name Excel accepts: at most 31 characters, none of `[]:*?/\`. */
export function sheetName(name: string): string {
	const clean = name
		.replace(/[[\]:*?/\\]/g, " ")
		.trim()
		.slice(0, 31)
		.trim();
	return clean === "" ? "Sheet1" : clean;
}

async function xlsxBytes(dataset: Dataset): Promise<Uint8Array> {
	const XLSX = await loadXlsx();
	const header = dataset.columns.map((c) => c.key);
	const body = dataset.records.map((record) =>
		dataset.columns.map((column) => {
			const value = record.values[column.key];
			if (value === null || value === undefined) return null;
			if (column.type === "date" && typeof value === "string") {
				const serial = isIsoDate(value) ? isoToSerial(value) : null;
				if (serial !== null) return { t: "n", v: serial, z: "yyyy-mm-dd" };
			}
			return exportValue(dataset, column, value);
		}),
	);
	const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, sheet, sheetName(dataset.name));
	const out = XLSX.write(wb, {
		type: "array",
		bookType: "xlsx",
		compression: true,
	}) as ArrayBuffer;
	return new Uint8Array(out);
}

/** The dataset as a file. The header row is the column keys. */
export async function writeTable(
	dataset: Dataset,
	format: TableFormat,
): Promise<WrittenTable> {
	const encode = (text: string) => new TextEncoder().encode(text);
	let bytes: Uint8Array;
	switch (format) {
		case "csv":
			bytes = encode(delimited(dataset, ","));
			break;
		case "tsv":
			bytes = encode(delimited(dataset, "\t"));
			break;
		case "json":
			bytes = encode(`${JSON.stringify(recordObjects(dataset), null, 2)}\n`);
			break;
		case "ndjson":
			bytes = encode(
				recordObjects(dataset)
					.map((o) => `${JSON.stringify(o)}\n`)
					.join(""),
			);
			break;
		case "xlsx":
			bytes = await xlsxBytes(dataset);
			break;
	}
	return { bytes, mediaType: MEDIA_TYPES[format], extension: format };
}
