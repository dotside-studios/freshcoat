import { assetForRef } from "./assets";
import { isIsoDate } from "./columns";
import type {
	CellValue,
	Column,
	Dataset,
	TableFormat,
	TableSheet,
	WriteTableOptions,
	WrittenTable,
} from "./types";
import {
	WORKBOOK_READERS,
	WORKBOOK_WRITERS,
	type WorkbookCell,
} from "./workbook/index";
import { readZipDirectory } from "./zip-directory";

export type TabularErrorCode =
	| "empty_file"
	| "unsupported_format"
	| "invalid_file"
	| "limit_exceeded";

export class TabularError extends Error {
	constructor(
		readonly code: TabularErrorCode,
		message: string,
	) {
		super(message);
		this.name = "TabularError";
	}
}

export type TableLimitKind =
	| "bytes"
	| "uncompressed_bytes"
	| "zip_entries"
	| "rows"
	| "columns"
	| "cells";

export type TableLimits = {
	/** Size of the file in bytes (characters, for text passed as a string). */
	maxBytes: number;
	/** Sum of the uncompressed sizes of a workbook zip's entries. */
	maxUncompressedBytes: number;
	/** Entries in a workbook zip. */
	maxZipEntries: number;
	/** Data records of one sheet: rows after the first, which is the header,
	 *  counted before empty trailing rows are trimmed. A JSON list of objects
	 *  counts its objects. */
	maxRows: number;
	/** Columns of one sheet, before empty trailing columns are trimmed. */
	maxColumns: number;
	/** Cells of one sheet, records times columns. */
	maxCells: number;
};

export const DEFAULT_TABLE_LIMITS: Readonly<TableLimits> = {
	maxBytes: 128 * 1024 * 1024,
	maxUncompressedBytes: 512 * 1024 * 1024,
	maxZipEntries: 10_000,
	maxRows: 500_000,
	maxColumns: 500,
	maxCells: 10_000_000,
};

export type ReadTableOptions = {
	limits?: Partial<TableLimits>;
	/** Drop the `'` that `writeTable` puts before a CSV or TSV cell starting
	 *  with a formula trigger. Defaults to true; set it to false for a file
	 *  written with `escapeFormulas: false`. */
	unescapeFormulas?: boolean;
};

const LIMIT_LABELS: Record<TableLimitKind, { label: string; size: boolean }> = {
	bytes: { label: "bytes", size: true },
	uncompressed_bytes: { label: "uncompressed bytes", size: true },
	zip_entries: { label: "zip entries", size: false },
	rows: { label: "records", size: false },
	columns: { label: "columns", size: false },
	cells: { label: "cells", size: false },
};

function sizeText(bytes: number): string {
	return bytes >= 1024 * 1024
		? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		: `${bytes.toLocaleString("en-US")} bytes`;
}

/**
 * A file is past one of the `TableLimits`. `limit` names which, `actual` is
 * the size found, or undefined when the reader stopped at the cap without
 * measuring it, and `max` is the cap.
 */
export class TableLimitError extends TabularError {
	constructor(
		readonly limit: TableLimitKind,
		readonly actual: number | undefined,
		readonly max: number,
		fileName: string,
	) {
		const { label, size } = LIMIT_LABELS[limit];
		const exact =
			size && actual !== undefined && sizeText(actual) === sizeText(max);
		const show = (n: number) =>
			size && !exact ? sizeText(n) : `${n.toLocaleString("en-US")} ${label}`;
		super(
			"limit_exceeded",
			`${fileName} is too large to import: ${actual === undefined ? "it" : show(actual)} is over the limit of ${show(max)}`,
		);
		this.name = "TableLimitError";
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

/** The longest string V8 makes, the limit on text in Node and Chromium. */
export const MAX_TEXT_LENGTH = 0x1fffffe8;

function isTooLong(err: unknown): boolean {
	return (
		err instanceof RangeError ||
		(err as { code?: string } | null)?.code === "ERR_STRING_TOO_LONG"
	);
}

// A file saved by Excel on Windows is often not UTF-8; reading it as UTF-8
// would turn every accented letter into a replacement character. Text longer
// than a string can be makes Node throw and Chromium return "", so both call
// `tooLong`; only a lone byte order mark decodes to "" otherwise.
function decodeText(input: Uint8Array | string, tooLong: () => never): string {
	let text: string;
	if (typeof input === "string") text = input;
	else {
		const decode = (label: string, fatal: boolean) => {
			try {
				return new TextDecoder(label, { fatal }).decode(input);
			} catch (err) {
				if (isTooLong(err)) tooLong();
				throw err;
			}
		};
		try {
			text = decode("utf-8", true);
		} catch (err) {
			if (err instanceof TableLimitError) throw err;
			text = decode("windows-1252", false);
		}
		if (text === "" && input.length > 3) tooLong();
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

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const ESCAPED_FORMULA = /^'+[=+\-@\t\r]/;

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
function splitDelimited(
	input: string,
	separator: string | undefined,
	unescapeFormulas: boolean,
	limits: TableLimits,
	fail: (limit: "rows" | "columns", actual: number) => never,
): string[][] {
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
		if (
			unescapeFormulas &&
			cell.charCodeAt(0) === 39 &&
			ESCAPED_FORMULA.test(cell)
		) {
			cell = cell.slice(1);
		}
		row.push(cell);
		if (row.length > limits.maxColumns) fail("columns", row.length);
		start = end + 1;
		startCode = text.charCodeAt(start);
		if (code !== sepCode) {
			rows.push(row);
			if (rows.length - 1 > limits.maxRows) fail("rows", rows.length - 1);
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

function readJson(
	text: string,
	limits: TableLimits,
	fail: (limit: "rows", actual: number) => never,
): string[][] {
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
	const records = items.every(Array.isArray) ? items.length - 1 : items.length;
	if (records > limits.maxRows) fail("rows", records);
	return objectsToRows(items);
}

function readNdjson(
	text: string,
	limits: TableLimits,
	fail: (limit: "rows", actual: number) => never,
): string[][] {
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
	const records = lines.every((line) => line.trimStart().startsWith("["))
		? lines.length - 1
		: lines.length;
	if (records > limits.maxRows) fail("rows", records);
	const items = lines.map(parseJson);
	return items.length === 0 ? [] : objectsToRows(items);
}

/**
 * The sheets of a table file, each as a matrix of strings. The extension picks
 * the reader. Rejects with a `TabularError`: `empty_file` when there are no
 * cells, `unsupported_format` for an extension it does not read,
 * `invalid_file` when the contents do not parse, and a `TableLimitError`
 * (`limit_exceeded`) when the file is past `DEFAULT_TABLE_LIMITS` or the
 * `options.limits` that override them. Size limits are checked before any
 * untrusted bytes are decoded or inflated. A CSV or TSV cell that starts with
 * `'` and then `=`, `+`, `-`, `@`, tab or CR loses that `'`, undoing
 * `writeTable`'s formula escaping, unless `options.unescapeFormulas` is false.
 */
export async function readTable(
	input: Uint8Array | string,
	fileName: string,
	options: ReadTableOptions = {},
): Promise<Sheets> {
	const limits: TableLimits = { ...DEFAULT_TABLE_LIMITS, ...options.limits };
	const fail = (
		limit: TableLimitKind,
		actual: number | undefined,
		max: number,
	): never => {
		throw new TableLimitError(limit, actual, max, fileName);
	};
	const failShape = (limit: "rows" | "columns", actual: number): never =>
		fail(limit, actual, limit === "rows" ? limits.maxRows : limits.maxColumns);
	if (input.length > limits.maxBytes) {
		fail("bytes", input.length, limits.maxBytes);
	}
	const ext = extensionOf(fileName);
	const base = fileName.replace(/\.[^.]*$/, "") || "Sheet1";
	const tooLong = () => fail("bytes", input.length, MAX_TEXT_LENGTH);
	let sheets: TableSheet[];
	if (ext === "json") {
		sheets = [
			{
				name: base,
				rows: readJson(decodeText(input, tooLong), limits, failShape),
			},
		];
	} else if (ext === "ndjson" || ext === "jsonl") {
		sheets = [
			{
				name: base,
				rows: readNdjson(decodeText(input, tooLong), limits, failShape),
			},
		];
	} else if (TEXT_FORMATS.has(ext)) {
		const text = decodeText(input, tooLong);
		sheets =
			text.trim() === ""
				? []
				: [
						{
							name: base,
							rows: splitDelimited(
								text,
								ext === "tsv" ? "\t" : undefined,
								options.unescapeFormulas ?? true,
								limits,
								failShape,
							),
						},
					];
	} else if (WORKBOOK_READERS[ext]) {
		if (typeof input === "string") {
			throw new TabularError("invalid_file", `A .${ext} file is binary`);
		}
		if (ZIP_FORMATS.has(ext)) {
			if (!(input[0] === 0x50 && input[1] === 0x4b)) {
				throw new TabularError("invalid_file", `Not a .${ext} file`);
			}
			const directory = readZipDirectory(input);
			if (!directory) {
				throw new TabularError(
					"invalid_file",
					`${fileName} is damaged: its zip directory cannot be read`,
				);
			}
			if (directory.entries > limits.maxZipEntries) {
				fail("zip_entries", directory.entries, limits.maxZipEntries);
			}
			if (directory.uncompressedBytes > limits.maxUncompressedBytes) {
				fail(
					"uncompressed_bytes",
					directory.uncompressedBytes,
					limits.maxUncompressedBytes,
				);
			}
		}
		const codec = await WORKBOOK_READERS[ext]();
		try {
			sheets = await codec.read(input, ext, {
				maxDecompressedBytes: limits.maxUncompressedBytes,
				maxTotalCells: limits.maxCells + limits.maxColumns,
			});
		} catch (err) {
			const name = (err as { name?: string }).name;
			const message = err instanceof Error ? err.message : String(err);
			if (name === "ZipError" && /zip bomb/.test(message)) {
				fail("uncompressed_bytes", undefined, limits.maxUncompressedBytes);
			}
			const spans = /^Sheet .* spans (\d+) rows x (\d+) columns/.exec(message);
			if (name === "ParseError" && spans) {
				const [height, width] = [Number(spans[1]), Number(spans[2])];
				fail("cells", Math.max(height - 1, 0) * width, limits.maxCells);
			}
			if (
				name === "ParseError" &&
				/^Sheet spans \d+ cells, over the/.test(message)
			) {
				fail("cells", undefined, limits.maxCells);
			}
			throw new TabularError("invalid_file", message);
		}
	} else {
		throw new TabularError(
			"unsupported_format",
			ext === "" ? `${fileName} has no extension` : `.${ext} is not a table`,
		);
	}
	for (const sheet of sheets) {
		const records = Math.max(sheet.rows.length - 1, 0);
		if (records > limits.maxRows) failShape("rows", records);
		let width = 0;
		for (const row of sheet.rows) width = Math.max(width, row.length);
		if (width > limits.maxColumns) failShape("columns", width);
		if (records * width > limits.maxCells) {
			fail("cells", records * width, limits.maxCells);
		}
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

function delimited(
	dataset: Dataset,
	separator: string,
	escapeFormulas: boolean,
): string {
	const quote = (text: string) =>
		text.includes(separator) || /["\r\n]/.test(text)
			? `"${text.replace(/"/g, '""')}"`
			: text;
	const guard = (text: string, column: Column, value: CellValue | undefined) =>
		escapeFormulas &&
		typeof value !== "number" &&
		(ESCAPED_FORMULA.test(text) ||
			(column.type !== "image" && FORMULA_TRIGGER.test(text)))
			? `'${text}`
			: text;
	const lines = [
		dataset.columns.map((c) => quote(c.key)).join(separator),
		...dataset.records.map((record) =>
			dataset.columns
				.map((c) => {
					const value = record.values[c.key];
					return quote(guard(exportText(dataset, c, value), c, value));
				})
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

/**
 * The dataset as a file. The header row is the column keys.
 *
 * In CSV and TSV, text cells starting with `=`, `+`, `-`, `@`, tab or CR get a
 * leading `'` so spreadsheets do not run them as formulas, and so do text
 * cells starting with `'` and then one of those, so the escape can be undone.
 * Numbers and image cells, which hold file names, are left alone, apart from
 * that second rule. `readTable` drops one leading `'` from a cell that starts
 * with `'` and a trigger, so the file reads back as written. Set
 * `escapeFormulas: false` for machine consumers.
 */
export async function writeTable(
	dataset: Dataset,
	format: TableFormat,
	options: WriteTableOptions = {},
): Promise<WrittenTable> {
	const escapeFormulas = options.escapeFormulas ?? true;
	const encode = (text: string) => new TextEncoder().encode(text);
	let bytes: Uint8Array;
	switch (format) {
		case "csv":
			bytes = encode(delimited(dataset, ",", escapeFormulas));
			break;
		case "tsv":
			bytes = encode(delimited(dataset, "\t", escapeFormulas));
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
