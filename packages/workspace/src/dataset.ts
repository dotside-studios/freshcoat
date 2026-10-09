import type { Template } from "@freshcoat-js/coatfile";
import { parseAssetRef } from "./assets";
import { coerce, isEmptyValue, newRecord, validateRecord } from "./columns";
import { isValidKey, newId, uniqueKey } from "./ids";
import { jsonSchemaToColumns } from "./json-schema";
import type {
	Binding,
	CellIssue,
	CellValue,
	Column,
	ColumnType,
	DataRecord,
	Dataset,
	DatasetAsset,
} from "./types";

export type SortDirection = "ascending" | "descending";

export type SortSpec = {
	column: string;
	direction: SortDirection;
};

export const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set([
	"number",
	"integer",
]);
export const TEXTUAL_TYPES: ReadonlySet<ColumnType> = new Set([
	"text",
	"longText",
	"color",
	"url",
	"email",
]);

// ------------------------------------------------------------------ lookups

const indexMaps = new WeakMap<
	readonly DataRecord[],
	ReadonlyMap<string, number>
>();
const byIdMaps = new WeakMap<
	readonly DataRecord[],
	ReadonlyMap<string, DataRecord>
>();

/** Each record's position by id, made once per records array. */
export function recordIndexMap(
	records: readonly DataRecord[],
): ReadonlyMap<string, number> {
	let map = indexMaps.get(records);
	if (!map) {
		map = new Map(records.map((r, i) => [r.id, i]));
		indexMaps.set(records, map);
	}
	return map;
}

/** Each record by id, made once per records array. */
export function recordByIdMap(
	records: readonly DataRecord[],
): ReadonlyMap<string, DataRecord> {
	let map = byIdMaps.get(records);
	if (!map) {
		map = new Map(records.map((r) => [r.id, r]));
		byIdMaps.set(records, map);
	}
	return map;
}

// ------------------------------------------------------------------ display

export function assetMap(
	assets: readonly DatasetAsset[],
): Map<string, DatasetAsset> {
	return new Map(assets.map((a) => [a.sha256, a]));
}

/** The text a cell shows and is searched by. */
export function displayText(
	column: Column,
	value: CellValue | undefined,
	assets?: ReadonlyMap<string, DatasetAsset>,
): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") return String(value);
	if (column.type === "image") {
		const sha = parseAssetRef(value);
		if (sha !== null) return assets?.get(sha)?.name ?? value;
	}
	return value;
}

/** What an editor starts with for a cell. */
export function editText(column: Column, value: CellValue | undefined): string {
	if (value === null || value === undefined) return "";
	if (column.type === "boolean" && typeof value === "boolean")
		return value ? "true" : "false";
	return String(value);
}

// ---------------------------------------------------------- search and sort

const searchCache = new WeakMap<
	readonly Column[],
	WeakMap<readonly DatasetAsset[], WeakMap<DataRecord, string>>
>();

function searchIndex(
	dataset: Pick<Dataset, "columns" | "assets">,
): WeakMap<DataRecord, string> {
	let byAssets = searchCache.get(dataset.columns);
	if (!byAssets) {
		byAssets = new WeakMap();
		searchCache.set(dataset.columns, byAssets);
	}
	let byRecord = byAssets.get(dataset.assets);
	if (!byRecord) {
		byRecord = new WeakMap();
		byAssets.set(dataset.assets, byRecord);
	}
	return byRecord;
}

/** Records with any cell containing `query`, ignoring case. */
export function filterRecords(
	records: readonly DataRecord[],
	dataset: Pick<Dataset, "columns" | "assets">,
	query: string,
): readonly DataRecord[] {
	const q = query.trim().toLowerCase();
	if (q === "") return records;
	const index = searchIndex(dataset);
	let assets: Map<string, DatasetAsset> | undefined;
	return records.filter((r) => {
		let text = index.get(r);
		if (text === undefined) {
			assets ??= assetMap(dataset.assets);
			const map = assets;
			text = dataset.columns
				.map((c) => displayText(c, r.values[c.key], map))
				.join("\u0001")
				.toLowerCase();
			index.set(r, text);
		}
		return text.includes(q);
	});
}

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

const STATUS_ORDER = { pending: 0, exported: 1, failed: 2, skipped: 3 };

/** Sorted by one column. Empty cells go last in either direction, and ties
 *  keep their dataset order. */
export function sortRecords(
	records: readonly DataRecord[],
	columns: readonly Column[],
	sort: SortSpec | undefined,
): readonly DataRecord[] {
	if (!sort) return records;
	const dir = sort.direction === "descending" ? -1 : 1;
	const column = columns.find((c) => c.key === sort.column);
	if (!column) return records;
	return [...records].sort((a, b) => {
		const va = a.values[column.key];
		const vb = b.values[column.key];
		const ea = isEmptyValue(va ?? null);
		const eb = isEmptyValue(vb ?? null);
		if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
		return dir * compareValues(va as CellValue, vb as CellValue);
	});
}

/** Sorted by export status: pending, exported, failed, skipped. */
export function sortByStatus(
	records: readonly DataRecord[],
	direction: SortDirection,
): readonly DataRecord[] {
	const dir = direction === "descending" ? -1 : 1;
	return [...records].sort(
		(a, b) => dir * (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
	);
}

function compareValues(a: CellValue, b: CellValue): number {
	if (typeof a === "number" && typeof b === "number") return a - b;
	// A value that failed to convert sorts after the ones that did.
	if (typeof a === "number") return -1;
	if (typeof b === "number") return 1;
	if (typeof a === "boolean" && typeof b === "boolean")
		return Number(a) - Number(b);
	return collator.compare(String(a), String(b));
}

// ------------------------------------------------------------------- issues

const issueCache = new WeakMap<
	readonly Column[],
	WeakMap<readonly DatasetAsset[], WeakMap<DataRecord, CellIssue[]>>
>();

/** `validateRecord`, cached per record, so an edit revalidates one row. */
export function recordIssues(
	dataset: Pick<Dataset, "columns" | "assets">,
	record: DataRecord,
): CellIssue[] {
	let byAssets = issueCache.get(dataset.columns);
	if (!byAssets) {
		byAssets = new WeakMap();
		issueCache.set(dataset.columns, byAssets);
	}
	let byRecord = byAssets.get(dataset.assets);
	if (!byRecord) {
		byRecord = new WeakMap();
		byAssets.set(dataset.assets, byRecord);
	}
	let issues = byRecord.get(record);
	if (!issues) {
		issues = validateRecord(dataset.columns, record.values, dataset.assets);
		byRecord.set(record, issues);
	}
	return issues;
}

export function cellIssue(
	dataset: Pick<Dataset, "columns" | "assets">,
	record: DataRecord,
	key: string,
): string | undefined {
	return recordIssues(dataset, record).find((i) => i.column === key)?.message;
}

export function issueCount(dataset: Dataset): number {
	let n = 0;
	for (const r of dataset.records) n += recordIssues(dataset, r).length;
	return n;
}

// ---------------------------------------------------------------- datasets

export function replaceDataset(
	datasets: readonly Dataset[],
	next: Dataset,
): Dataset[] {
	return datasets.map((d) => (d.id === next.id ? next : d));
}

export function emptyDataset(
	name: string,
	columns: Column[] = [],
	id = newId("d"),
): Dataset {
	return { id, name, columns, records: [], assets: [] };
}

/**
 * One column per template field. The field's format picks the type (color,
 * url, image, longText, boolean), anything else is text, and `required`,
 * title, description and length rules carry over. A field's default is a
 * preview value, and binding already falls back to it for an empty cell, so
 * it does not become the column's.
 */
export function columnsFromTemplate(template: Template): Column[] {
	return jsonSchemaToColumns(template.fields).columns.map(
		({ default: _preview, ...column }) => column,
	);
}

export function duplicateDataset(dataset: Dataset, name: string): Dataset {
	return {
		...dataset,
		id: newId("d"),
		name,
		records: dataset.records.map((r) => ({ ...r, id: newId("r") })),
	};
}

/** The templates whose binding reads this dataset. */
export function templatesUsing(
	templates: readonly { id: string; fileName: string; binding?: Binding }[],
	datasetId: string,
): { id: string; fileName: string }[] {
	return templates.filter((t) => t.binding?.datasetId === datasetId);
}

// ----------------------------------------------------------------- records

export function setCell(
	dataset: Dataset,
	recordId: string,
	key: string,
	value: CellValue,
): Dataset {
	let changed = false;
	const records = dataset.records.map((r) => {
		if (r.id !== recordId) return r;
		const current = r.values[key] ?? null;
		if (current === value) return r;
		changed = true;
		const values = { ...r.values };
		if (value === null) delete values[key];
		else values[key] = value;
		return { ...r, values };
	});
	return changed ? { ...dataset, records } : dataset;
}

export type CellWrite = { id: string; key: string; value: CellValue };

/** Sets many cells in one pass over the records. */
export function writeCells(
	dataset: Dataset,
	writes: readonly CellWrite[],
): Dataset {
	if (writes.length === 0) return dataset;
	const byRecord = new Map<string, Map<string, CellValue>>();
	for (const w of writes) {
		let m = byRecord.get(w.id);
		if (!m) {
			m = new Map();
			byRecord.set(w.id, m);
		}
		m.set(w.key, w.value);
	}
	let changed = false;
	const records = dataset.records.map((r) => {
		const m = byRecord.get(r.id);
		if (!m) return r;
		let values: DataRecord["values"] | undefined;
		for (const [key, value] of m) {
			if ((r.values[key] ?? null) === value) continue;
			values ??= { ...r.values };
			if (value === null) delete values[key];
			else values[key] = value;
		}
		if (!values) return r;
		changed = true;
		return { ...r, values };
	});
	return changed ? { ...dataset, records } : dataset;
}

/** The first record's value in column `key` copied to the others. */
export function fillDown(
	dataset: Dataset,
	ids: readonly string[],
	key: string,
): { dataset: Dataset; cells: number } {
	const [first, ...rest] = ids;
	if (first === undefined || rest.length === 0) return { dataset, cells: 0 };
	const value = recordByIdMap(dataset.records).get(first)?.values[key] ?? null;
	const next = writeCells(
		dataset,
		rest.map((id) => ({ id, key, value })),
	);
	return { dataset: next, cells: rest.length };
}

/** The value each column has in every one of the records, for the columns
 *  where they agree; an empty cell is null. */
export function sharedValues(
	dataset: Dataset,
	ids: readonly string[],
): Map<string, CellValue> {
	const byId = recordByIdMap(dataset.records);
	const out = new Map<string, CellValue>();
	const open = new Set(dataset.columns.map((c) => c.key));
	let first = true;
	for (const id of ids) {
		const r = byId.get(id);
		if (!r) continue;
		for (const key of open) {
			const v = r.values[key] ?? null;
			if (first) out.set(key, v);
			else if (out.get(key) !== v) {
				out.delete(key);
				open.delete(key);
			}
		}
		first = false;
		if (open.size === 0) break;
	}
	return out;
}

/** A cell's value for typed text, coerced by its column. A value that does
 *  not fit keeps its text, which validation then flags. */
export function valueFromText(
	column: Column,
	text: string,
	assets: readonly DatasetAsset[] = [],
): CellValue {
	return coerce(column, text, { assets }).value;
}

export function addRecords(
	dataset: Dataset,
	count = 1,
): { dataset: Dataset; ids: string[] } {
	const added = Array.from({ length: count }, () => newRecord(dataset.columns));
	return {
		dataset: { ...dataset, records: [...dataset.records, ...added] },
		ids: added.map((r) => r.id),
	};
}

/** Copies each record right after it, status reset to pending. */
export function duplicateRecords(
	dataset: Dataset,
	ids: readonly string[],
): { dataset: Dataset; ids: string[] } {
	const wanted = new Set(ids);
	const created: string[] = [];
	const records: DataRecord[] = [];
	for (const r of dataset.records) {
		records.push(r);
		if (!wanted.has(r.id)) continue;
		const copy: DataRecord = {
			id: newId("r"),
			values: { ...r.values },
			status: "pending",
		};
		records.push(copy);
		created.push(copy.id);
	}
	return {
		dataset: created.length ? { ...dataset, records } : dataset,
		ids: created,
	};
}

export function deleteRecords(
	dataset: Dataset,
	ids: readonly string[],
): Dataset {
	const wanted = new Set(ids);
	const records = dataset.records.filter((r) => !wanted.has(r.id));
	return records.length === dataset.records.length
		? dataset
		: { ...dataset, records };
}

// ----------------------------------------------------------------- columns

export function newColumn(dataset: Dataset, type: ColumnType = "text"): Column {
	return {
		key: uniqueKey(
			"column",
			dataset.columns.map((c) => c.key),
		),
		type,
	};
}

export function addColumn(dataset: Dataset, column: Column, at?: number) {
	const columns = [...dataset.columns];
	columns.splice(at ?? columns.length, 0, column);
	return { ...dataset, columns };
}

export function moveColumn(dataset: Dataset, key: string, by: number): Dataset {
	const from = dataset.columns.findIndex((c) => c.key === key);
	const to = from + by;
	if (from < 0 || to < 0 || to >= dataset.columns.length) return dataset;
	const columns = [...dataset.columns];
	const [moved] = columns.splice(from, 1);
	columns.splice(to, 0, moved as Column);
	return { ...dataset, columns };
}

export function columnValueCount(dataset: Dataset, key: string): number {
	let n = 0;
	for (const r of dataset.records)
		if (!isEmptyValue(r.values[key] ?? null)) n++;
	return n;
}

/** Removes the column and every value stored under it. */
export function deleteColumn(dataset: Dataset, key: string): Dataset {
	return {
		...dataset,
		columns: dataset.columns.filter((c) => c.key !== key),
		records: dataset.records.map((r) => {
			if (!(key in r.values)) return r;
			const { [key]: _gone, ...values } = r.values;
			return { ...r, values };
		}),
	};
}

export type KeyProblem = "invalid" | "taken";

export function keyProblem(
	dataset: Dataset,
	from: string,
	to: string,
): KeyProblem | null {
	if (!isValidKey(to)) return "invalid";
	if (to !== from && dataset.columns.some((c) => c.key === to)) return "taken";
	return null;
}

/** The column renamed, with every record's value moved to the new key. */
export function renameColumn(
	dataset: Dataset,
	from: string,
	to: string,
): Dataset | null {
	if (from === to) return dataset;
	if (keyProblem(dataset, from, to)) return null;
	if (!dataset.columns.some((c) => c.key === from)) return null;
	return {
		...dataset,
		columns: dataset.columns.map((c) =>
			c.key === from ? { ...c, key: to } : c,
		),
		records: dataset.records.map((r) => {
			if (!(from in r.values)) return r;
			const values: Record<string, CellValue> = {};
			for (const [k, v] of Object.entries(r.values))
				values[k === from ? to : k] = v;
			return { ...r, values };
		}),
	};
}

/** A binding with its references to column `from` pointed at `to`, or null
 *  when it has none. */
export function rebindColumn(
	binding: Binding,
	datasetId: string,
	from: string,
	to: string,
): Binding | null {
	if (binding.datasetId !== datasetId) return null;
	let changed = false;
	const fields: Binding["fields"] = {};
	for (const [field, source] of Object.entries(binding.fields)) {
		if (source.kind === "column" && source.column === from) {
			fields[field] = { kind: "column", column: to };
			changed = true;
		} else fields[field] = source;
	}
	let variant = binding.variant;
	if (variant?.kind === "column" && variant.column === from) {
		variant = { ...variant, column: to };
		changed = true;
	}
	if (!changed) return null;
	return { ...binding, fields, ...(variant ? { variant } : {}) };
}

/** Drops the constraints a type does not use. */
export function constraintsFor(column: Column): Column {
	const next: Column = { ...column };
	if (next.type !== "text") {
		delete next.enum;
		delete next.options;
	}
	if (!NUMERIC_TYPES.has(next.type)) {
		delete next.minimum;
		delete next.maximum;
	}
	if (!TEXTUAL_TYPES.has(next.type)) {
		delete next.minLength;
		delete next.maxLength;
		delete next.pattern;
	}
	return next;
}

function convertValue(
	column: Column,
	value: CellValue | undefined,
	assets: readonly DatasetAsset[],
): { value: CellValue; ok: boolean } | null {
	if (value === undefined || isEmptyValue(value)) return null;
	const out = coerce(column, value, { assets });
	return { value: out.value, ok: out.ok };
}

/** How many stored values would not convert to `type`. */
export function conversionFailures(
	dataset: Dataset,
	key: string,
	type: ColumnType,
): number {
	const column = dataset.columns.find((c) => c.key === key);
	if (!column || column.type === type) return 0;
	const target = { ...column, type };
	let n = 0;
	for (const r of dataset.records) {
		const out = convertValue(target, r.values[key], dataset.assets);
		if (out && !out.ok) n++;
	}
	return n;
}

/**
 * The column changed to `type`, with its values re-coerced. A value that does
 * not convert keeps its text. Constraints the new type does not use are
 * dropped, and so is a default that does not convert.
 */
export function changeColumnType(
	dataset: Dataset,
	key: string,
	type: ColumnType,
): { dataset: Dataset; failed: number } {
	const column = dataset.columns.find((c) => c.key === key);
	if (!column || column.type === type) return { dataset, failed: 0 };
	const next = constraintsFor({ ...column, type });
	if (next.default !== undefined) {
		const d = convertValue(next, next.default, dataset.assets);
		if (d === null) delete next.default;
		else if (d.ok) next.default = d.value;
		else delete next.default;
	}
	let failed = 0;
	const records = dataset.records.map((r) => {
		const out = convertValue(next, r.values[key], dataset.assets);
		if (!out) return r;
		if (!out.ok) failed++;
		if (out.value === r.values[key]) return r;
		return { ...r, values: { ...r.values, [key]: out.value } };
	});
	return {
		dataset: {
			...dataset,
			columns: dataset.columns.map((c) => (c.key === key ? next : c)),
			records,
		},
		failed,
	};
}

/** Sets or clears some of a column's properties (not its key or type). */
export function updateColumn(
	dataset: Dataset,
	key: string,
	patch: Partial<Omit<Column, "key" | "type">>,
): Dataset {
	return {
		...dataset,
		columns: dataset.columns.map((c) => {
			if (c.key !== key) return c;
			const next: Column = { ...c };
			for (const [k, v] of Object.entries(patch) as [keyof Column, unknown][]) {
				if (v === undefined) delete next[k];
				else (next as Record<string, unknown>)[k] = v;
			}
			return next;
		}),
	};
}

// ------------------------------------------------------------ JSON Schema

export type SchemaMerge = {
	added: string[];
	changed: string[];
	removed: string[];
};

export function schemaChanges(
	dataset: Dataset,
	columns: readonly Column[],
	mode: "replace" | "merge",
): SchemaMerge {
	const current = new Map(dataset.columns.map((c) => [c.key, c]));
	const incoming = new Set(columns.map((c) => c.key));
	return {
		added: columns.filter((c) => !current.has(c.key)).map((c) => c.key),
		changed: columns
			.filter((c) => {
				const old = current.get(c.key);
				return old && JSON.stringify(old) !== JSON.stringify(c);
			})
			.map((c) => c.key),
		removed:
			mode === "replace"
				? dataset.columns.filter((c) => !incoming.has(c.key)).map((c) => c.key)
				: [],
	};
}

/**
 * Applies imported columns. `replace` makes them the dataset's columns and
 * drops the values of columns that are gone; `merge` updates the columns it
 * names and appends the new ones. Values of a column whose type changed are
 * re-coerced.
 */
export function applySchema(
	dataset: Dataset,
	columns: readonly Column[],
	mode: "replace" | "merge",
): Dataset {
	let next = dataset;
	for (const column of columns) {
		const old = next.columns.find((c) => c.key === column.key);
		if (old && old.type !== column.type)
			next = changeColumnType(next, column.key, column.type).dataset;
	}
	if (mode === "replace") {
		const keep = new Set(columns.map((c) => c.key));
		for (const c of next.columns)
			if (!keep.has(c.key)) next = deleteColumn(next, c.key);
		return { ...next, columns: [...columns] };
	}
	const incoming = new Map(columns.map((c) => [c.key, c]));
	const merged = next.columns.map((c) => incoming.get(c.key) ?? c);
	const fresh = columns.filter(
		(c) => !next.columns.some((o) => o.key === c.key),
	);
	return { ...next, columns: [...merged, ...fresh] };
}
