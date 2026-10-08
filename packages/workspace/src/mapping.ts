import {
	coerce,
	EMAIL_PATTERN,
	HEX_COLOR,
	isEmptyValue,
	isUrl,
	parseDateText,
	validateRecord,
} from "./columns";
import { freshId, slug, uniqueKey } from "./ids";
import type {
	ApplyMappingResult,
	CellIssue,
	CellValue,
	Column,
	ColumnMapping,
	ColumnType,
	DataRecord,
	Dataset,
	ImportIssue,
	ImportPlan,
} from "./types";

export const INFER_SAMPLE = 200;
const LONG_TEXT = 120;

const INTEGER_TEXT = /^[-+]?(0|[1-9]\d{0,2}(,\d{3})+|[1-9]\d*)$/;
const NUMBER_TEXT =
	/^[-+]?((0|[1-9]\d{0,2}(,\d{3})+|[1-9]\d*)(\.\d+)?|\.\d+)(e[-+]?\d+)?$/i;
const BOOLEAN_WORDS = new Set(["true", "false", "yes", "no", "✓"]);
const IMAGE_FILE =
	/^[^:?#\r\n]+\.(jpe?g|jfif|png|webp|gif|avif|heic|heif|tiff?|bmp|svg)$/i;

/** `A`, `B`, … `Z`, `AA`: what a column is called when the file has no
 *  header row. */
export function columnLetter(index: number): string {
	let n = index + 1;
	let out = "";
	while (n > 0) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

export function sourceWidth(rows: readonly (readonly string[])[]): number {
	return rows.reduce((w, row) => Math.max(w, row.length), 0);
}

/** The header of each source column: the header row's cells, or letters. */
export function headersOf(
	rows: readonly (readonly string[])[],
	headerRow: number,
): string[] {
	const width = sourceWidth(rows);
	if (headerRow < 0) {
		return Array.from({ length: width }, (_, i) => columnLetter(i));
	}
	const row = rows[headerRow] ?? [];
	return Array.from({ length: width }, (_, i) => (row[i] ?? "").trim());
}

/** The first row whose first `n` cells are all filled, or -1. */
export function detectHeaderRow(
	rows: readonly (readonly string[])[],
	n = 3,
	scan = 20,
): number {
	const width = Math.min(n, sourceWidth(rows));
	if (width === 0) return -1;
	for (let r = 0; r < Math.min(rows.length, scan); r++) {
		const row = rows[r] ?? [];
		let full = true;
		for (let c = 0; c < width; c++) {
			if ((row[c] ?? "").trim() === "") full = false;
		}
		if (full) return r;
	}
	return -1;
}

function normalize(text: string): string {
	return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The type the sample values all fit, trying the narrowest first. */
export function inferType(values: readonly string[]): ColumnType {
	const sample = values
		.map((v) => v.trim())
		.filter((v) => v !== "")
		.slice(0, INFER_SAMPLE);
	if (sample.length === 0) return "text";
	const all = (test: (v: string) => boolean) => sample.every(test);
	if (all((v) => INTEGER_TEXT.test(v))) return "integer";
	if (all((v) => NUMBER_TEXT.test(v))) return "number";
	if (all((v) => BOOLEAN_WORDS.has(v.toLowerCase()))) return "boolean";
	if (
		all((v) => parseDateText(v, "dmy") !== null || parseDateText(v) !== null)
	) {
		return "date";
	}
	if (all((v) => /^https?:\/\//i.test(v) && isUrl(v))) return "url";
	if (all((v) => EMAIL_PATTERN.test(v))) return "email";
	if (all((v) => IMAGE_FILE.test(v))) return "image";
	if (all((v) => HEX_COLOR.test(v))) return "color";
	const long = values.some((v) => v.length > LONG_TEXT || /[\r\n]/.test(v));
	return long ? "longText" : "text";
}

/**
 * Where each source column goes: an existing column matched by key, then by
 * key or title ignoring case and punctuation; otherwise a new column with an
 * inferred type. `samples` are the data rows the types are inferred from.
 */
export function guessMapping(
	headers: readonly string[],
	columns: readonly Column[],
	samples: readonly (readonly string[])[] = [],
): ColumnMapping[] {
	const out: (ColumnMapping | undefined)[] = headers.map(() => undefined);
	const claimed = new Set<string>();

	headers.forEach((header, i) => {
		const exact = columns.find((c) => c.key === header.trim());
		if (header.trim() !== "" && exact && !claimed.has(exact.key)) {
			claimed.add(exact.key);
			out[i] = { kind: "column", column: exact.key };
		}
	});
	headers.forEach((header, i) => {
		if (out[i] !== undefined) return;
		const wanted = normalize(header);
		if (wanted === "") return;
		const loose = columns.find(
			(c) =>
				!claimed.has(c.key) &&
				(normalize(c.key) === wanted ||
					(c.title !== undefined && normalize(c.title) === wanted)),
		);
		if (loose) {
			claimed.add(loose.key);
			out[i] = { kind: "column", column: loose.key };
		}
	});

	const taken = columns.map((c) => c.key);
	return headers.map((header, i) => {
		const done = out[i];
		if (done !== undefined) return done;
		if (header.trim() === "") return { kind: "skip" };
		const key = uniqueKey(slug(header), taken);
		taken.push(key);
		const type = inferType(samples.map((row) => row[i] ?? ""));
		return { kind: "new", key, type };
	});
}

type Target = { source: number; column: Column };

function targetsFor(
	plan: ImportPlan,
	columns: readonly Column[],
	headers: readonly string[],
): { columns: Column[]; targets: Target[] } {
	const all = [...columns];
	const targets: Target[] = [];
	plan.mapping.forEach((mapping, source) => {
		if (mapping.kind === "column") {
			const column = all.find((c) => c.key === mapping.column);
			if (column) targets.push({ source, column });
		} else if (mapping.kind === "new") {
			const existing = all.find((c) => c.key === mapping.key);
			if (existing) {
				targets.push({ source, column: existing });
				return;
			}
			const header = headers[source] ?? "";
			const column: Column = {
				key: mapping.key,
				type: mapping.type,
				...(header !== "" && header !== mapping.key ? { title: header } : {}),
			};
			all.push(column);
			targets.push({ source, column });
		}
	});
	return { columns: all, targets };
}

function dataRows(
	rows: readonly (readonly string[])[],
	plan: ImportPlan,
): { index: number; cells: readonly string[] }[] {
	const out: { index: number; cells: readonly string[] }[] = [];
	for (let r = Math.max(plan.headerRow + 1, 0); r < rows.length; r++) {
		const cells = rows[r] ?? [];
		if (cells.some((cell) => cell.trim() !== "")) out.push({ index: r, cells });
	}
	return out;
}

export type PreviewCell = {
	column: string;
	raw: string;
	value: CellValue;
	ok: boolean;
	message?: string;
};

export type PreviewRow = { row: number; cells: PreviewCell[] };

/** The first rows as the import would store them, each cell marked with
 *  whether it fits its column. */
export function previewMapping(
	rows: readonly (readonly string[])[],
	plan: ImportPlan,
	columns: readonly Column[],
	limit = 20,
): PreviewRow[] {
	const headers = headersOf(rows, plan.headerRow);
	const { targets } = targetsFor(plan, columns, headers);
	return dataRows(rows, plan)
		.slice(0, limit)
		.map(({ index, cells }) => ({
			row: index,
			cells: targets.map(({ source, column }) => {
				const raw = cells[source] ?? "";
				const result = coerce(column, raw, { dateOrder: plan.dateOrder });
				let message = result.message;
				if (result.ok) {
					message = validateRecord([column], {
						[column.key]: result.value,
					})[0]?.message;
				}
				return {
					column: column.key,
					raw,
					value: result.value,
					ok: message === undefined,
					...(message !== undefined ? { message } : {}),
				};
			}),
		}));
}

function matchKey(value: CellValue | undefined): string | null {
	if (isEmptyValue(value ?? null)) return null;
	return typeof value === "string" ? value.trim() : String(value);
}

/**
 * The dataset with the rows imported: new columns added, every cell coerced,
 * new records `pending`. `replace` drops the existing records and keeps the
 * columns. With `match`, a row whose cell equals an existing record's value in
 * that column updates it in place; its empty cells leave the record's values
 * alone. An empty cell in a new record takes the column's default. Issue rows are indexes into `rows`.
 */
export function applyMapping(
	dataset: Dataset,
	rows: readonly (readonly string[])[],
	plan: ImportPlan,
): ApplyMappingResult {
	const headers = headersOf(rows, plan.headerRow);
	const { columns, targets } = targetsFor(plan, dataset.columns, headers);
	const records: DataRecord[] =
		plan.mode === "replace" ? [] : [...dataset.records];
	const issues: ImportIssue[] = [];
	const options = { dateOrder: plan.dateOrder, assets: dataset.assets };

	const match =
		plan.match !== undefined && plan.mode === "append"
			? {
					source: plan.match.source,
					column: columns.find((c) => c.key === plan.match?.column),
				}
			: undefined;
	const index = new Map<string, number>();
	if (match?.column) {
		records.forEach((record, i) => {
			const key = matchKey(record.values[match.column?.key ?? ""]);
			if (key !== null && !index.has(key)) index.set(key, i);
		});
	}

	const ids = new Set(records.map((r) => r.id));
	const addedIds = new Set<string>();
	const updatedIds = new Set<string>();
	for (const { index: rowIndex, cells } of dataRows(rows, plan)) {
		const values: Record<string, CellValue> = {};
		const failed: CellIssue[] = [];
		for (const { source, column } of targets) {
			const result = coerce(column, cells[source] ?? "", options);
			if (!result.ok) {
				failed.push({
					column: column.key,
					message: result.message ?? "Invalid",
				});
			}
			values[column.key] = result.value;
		}

		let target: number | undefined;
		if (match?.column) {
			const key = matchKey(
				coerce(match.column, cells[match.source] ?? "", options).value,
			);
			if (key !== null) target = index.get(key);
		}

		let record: DataRecord;
		if (target !== undefined) {
			const existing = records[target] as DataRecord;
			const merged = { ...existing.values };
			for (const [key, value] of Object.entries(values)) {
				if (!isEmptyValue(value)) merged[key] = value;
			}
			record = { ...existing, values: merged };
			records[target] = record;
			if (!addedIds.has(record.id)) updatedIds.add(record.id);
		} else {
			const stored: Record<string, CellValue> = {};
			for (const column of columns) {
				if (column.default !== undefined) stored[column.key] = column.default;
			}
			for (const [key, value] of Object.entries(values)) {
				if (!isEmptyValue(value)) stored[key] = value;
			}
			record = { id: freshId("r", ids), values: stored, status: "pending" };
			ids.add(record.id);
			records.push(record);
			addedIds.add(record.id);
			if (match?.column) {
				const key = matchKey(stored[match.column.key]);
				if (key !== null && !index.has(key)) {
					index.set(key, records.length - 1);
				}
			}
		}

		for (const issue of failed) {
			issues.push({ row: rowIndex, record: record.id, ...issue });
		}
		for (const issue of validateRecord(
			columns,
			record.values,
			dataset.assets,
		)) {
			if (!failed.some((f) => f.column === issue.column)) {
				issues.push({ row: rowIndex, record: record.id, ...issue });
			}
		}
	}

	return {
		dataset: { ...dataset, columns, records },
		added: addedIds.size,
		updated: updatedIds.size,
		issues,
	};
}
