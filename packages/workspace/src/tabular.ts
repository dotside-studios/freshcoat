import { assetForRef } from "./assets";
import { isIsoDate } from "./columns";
import type {
	CellValue,
	Column,
	Dataset,
	TableFormat,
	TableSheet,
	WrittenTable,
} from "./types";
import {
	WORKBOOK_READERS,
	WORKBOOK_WRITERS,
	type WorkbookCell,
} from "./workbook/index";

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
const ZIP_FORMATS = new Set(["xlsx", "xlsm", "ods"]);

export const TABLE_EXTENSIONS: readonly string[] = [
	"csv",
	"tsv",
	"txt",
	"json",
	"ndjson",
	"jsonl",
	...Object.keys(WORKBOOK_READERS),
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

/** Rows of equal width, with empty trailing rows and columns removed. The
 *  matrix is trimmed in place. */
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
	rows.length = height;
	for (let r = 0; r < height; r++) {
		const row = rows[r] ?? [];
		rows[r] = row;
		if (row.length > width) row.length = width;
		for (let c = 0; c < width; c++) row[c] ??= "";
	}
	return rows;
}

const SEPARATORS = [",", "\t", ";", "|"];

/** The separator used most outside quotes in the first 1024 characters,
 *  ties going to the earlier one in `SEPARATORS`, and a comma when none is. */
function guessSeparator(text: string): string {
	const counts = SEPARATORS.map(() => 0);
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') quoted = !quoted;
		else if (!quoted) {
			const k = SEPARATORS.indexOf(ch as string);
			if (k !== -1) counts[k] = (counts[k] ?? 0) + 1;
		}
	}
	let best = 0;
	for (let k = 1; k < counts.length; k++) {
		if ((counts[k] ?? 0) > (counts[best] ?? 0)) best = k;
	}
	return SEPARATORS[best] as string;
}

/**
 * Delimited text as rows, read the way SheetJS reads it: a `sep=` first line
 * names the separator, else `separator`, else the likeliest one. A quote
 * opens a quoted span only at the start of a cell, and a cell that starts
 * and ends with a quote loses both and has `""` unescaped.
 */
function splitDelimited(input: string, separator?: string): string[][] {
	let text = input;
	let sep: string;
	if (text.startsWith("sep=")) {
		if (text.charCodeAt(5) === 13 && text.charCodeAt(6) === 10) {
			sep = text.charAt(4);
			text = text.slice(7);
		} else if (text.charCodeAt(5) === 13 || text.charCodeAt(5) === 10) {
			sep = text.charAt(4);
			text = text.slice(6);
		} else sep = guessSeparator(text.slice(0, 1024));
	} else sep = separator ?? guessSeparator(text.slice(0, 1024));
	const sepCode = sep.charCodeAt(0);
	const rows: string[][] = [];
	let row: string[] = [];
	let start = 0;
	let startCode = text.charCodeAt(0);
	let quoted = false;
	const finish = (end: number, code: number) => {
		let cell = text.slice(start, end);
		if (cell.charCodeAt(cell.length - 1) === 13) cell = cell.slice(0, -1);
		if (cell.charCodeAt(0) === 34 && cell.charCodeAt(cell.length - 1) === 34) {
			cell = cell.slice(1, -1).replaceAll('""', '"');
		}
		row.push(cell);
		start = end + 1;
		startCode = text.charCodeAt(start);
		if (code !== sepCode) {
			rows.push(row);
			row = [];
		}
	};
	let end = 0;
	let code = 0;
	for (; end < text.length; end++) {
		code = text.charCodeAt(end);
		if (code === 34) {
			if (startCode === 34) quoted = !quoted;
			continue;
		}
		if (quoted) continue;
		if (code === 13) {
			if (text.charCodeAt(end + 1) === 10) end++;
			finish(end, code);
		} else if (code === sepCode || code === 10) finish(end, code);
	}
	if (end - start > 0) finish(end, code);
	if (row.length > 0) rows.push(row);
	return rows;
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
		sheets =
			text.trim() === ""
				? []
				: [
						{
							name: base,
							rows: splitDelimited(text, ext === "tsv" ? "\t" : undefined),
						},
					];
	} else if (WORKBOOK_READERS[ext]) {
		if (typeof input === "string") {
			throw new TabularError("invalid_file", `A .${ext} file is binary`);
		}
		if (ZIP_FORMATS.has(ext) && !(input[0] === 0x50 && input[1] === 0x4b)) {
			throw new TabularError("invalid_file", `Not a .${ext} file`);
		}
		const codec = await WORKBOOK_READERS[ext]();
		try {
			sheets = await codec.read(input, ext);
		} catch (err) {
			throw new TabularError(
				"invalid_file",
				err instanceof Error ? err.message : String(err),
			);
		}
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

async function workbookBytes(
	dataset: Dataset,
	format: TableFormat,
): Promise<Uint8Array> {
	const load = WORKBOOK_WRITERS[format];
	const codec = load && (await load());
	if (!codec?.write) throw new Error(`No workbook writer for ${format}`);
	const header = dataset.columns.map((c) => c.key);
	const body = dataset.records.map((record) =>
		dataset.columns.map((column): WorkbookCell => {
			const value = record.values[column.key];
			if (value === null || value === undefined) return null;
			if (
				column.type === "date" &&
				typeof value === "string" &&
				isIsoDate(value)
			)
				return new Date(`${value}T00:00:00Z`);
			return exportValue(dataset, column, value);
		}),
	);
	return codec.write(
		{ name: sheetName(dataset.name), rows: [header, ...body] },
		format,
	);
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
			bytes = await workbookBytes(dataset, format);
			break;
	}
	return { bytes, mediaType: MEDIA_TYPES[format], extension: format };
}
