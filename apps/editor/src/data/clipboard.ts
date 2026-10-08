import {
	type CellValue,
	type DataRecord,
	type Dataset,
	newRecord,
} from "@freshcoat-js/workspace";
import {
	assetMap,
	cellIssue,
	displayText,
	recordByIdMap,
	valueFromText,
} from "./model";

/**
 * Tab-separated text as spreadsheets put it on the clipboard: a cell with a
 * tab, a line break or a quote is quoted, and quotes inside it are doubled.
 * A trailing line break does not make an empty last row.
 */
export function parseTsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let i = 0;
	let quoted = false;
	const s = text.replace(/\r\n?/g, "\n");
	while (i < s.length) {
		const ch = s[i] as string;
		if (quoted) {
			if (ch === '"' && s[i + 1] === '"') {
				cell += '"';
				i += 2;
				continue;
			}
			if (ch === '"') quoted = false;
			else cell += ch;
			i++;
			continue;
		}
		if (ch === '"' && cell === "") quoted = true;
		else if (ch === "\t") {
			row.push(cell);
			cell = "";
		} else if (ch === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += ch;
		i++;
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

export function toTsv(rows: readonly (readonly string[])[]): string {
	return rows
		.map((r) =>
			r.map((c) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)),
		)
		.map((r) => r.join("\t"))
		.join("\n");
}

/** The cells of some records in some columns, as text for the clipboard. */
export function copyCells(
	dataset: Dataset,
	ids: readonly string[],
	keys: readonly string[],
): string {
	const byId = recordByIdMap(dataset.records);
	const assets = assetMap(dataset.assets);
	const columns = keys.flatMap((k) => {
		const c = dataset.columns.find((col) => col.key === k);
		return c ? [c] : [];
	});
	return toTsv(
		ids.map((id) => {
			const r = byId.get(id);
			return columns.map((c) => displayText(c, r?.values[c.key], assets));
		}),
	);
}

/** A cell's value for pasted text, parsed by its column; empty text clears
 *  it. */
export function pastedValue(
	dataset: Dataset,
	key: string,
	text: string,
): CellValue | undefined {
	const column = dataset.columns.find((c) => c.key === key);
	if (!column) return undefined;
	if (text.trim() === "") return null;
	return valueFromText(column, text, dataset.assets);
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

/** How many of the written cells fail their column's validation. */
export function misfitCount(
	dataset: Dataset,
	writes: readonly CellWrite[],
): number {
	const byId = recordByIdMap(dataset.records);
	let n = 0;
	for (const w of writes) {
		const r = byId.get(w.id);
		if (r && cellIssue(dataset, r, w.key) !== undefined) n++;
	}
	return n;
}

/** One pasted text into a column of several records. */
export function pasteInto(
	dataset: Dataset,
	ids: readonly string[],
	key: string,
	text: string,
): PasteResult {
	const value = pastedValue(dataset, key, text);
	const writes =
		value === undefined ? [] : ids.map((id) => ({ id, key, value }));
	const next = writeCells(dataset, writes);
	return {
		dataset: next,
		cells: writes.length,
		misfits: misfitCount(next, writes),
		added: 0,
		clipped: 0,
	};
}

export type PasteResult = {
	dataset: Dataset;
	cells: number;
	/** Pasted cells that do not pass their column's validation. */
	misfits: number;
	added: number;
	/** Columns of the block past the dataset's last column. */
	clipped: number;
};

/**
 * Pastes a block of text cells with its top left at `start`, going down the
 * records in `order` (the order they are shown) and right along the columns.
 * Rows past the last shown record become new records at the end.
 */
export function pasteBlock(
	dataset: Dataset,
	order: readonly string[],
	start: { row: string; col: string },
	block: readonly (readonly string[])[],
): PasteResult {
	const none = { dataset, cells: 0, misfits: 0, added: 0, clipped: 0 };
	const top = order.indexOf(start.row);
	const left = dataset.columns.findIndex((c) => c.key === start.col);
	if (top < 0 || left < 0 || block.length === 0) return none;
	const width = Math.max(...block.map((r) => r.length));
	const keys = dataset.columns.slice(left, left + width).map((c) => c.key);
	const fresh: DataRecord[] = [];
	const ids = block.map((_, i) => {
		const id = order[top + i];
		if (id !== undefined) return id;
		const r = newRecord(dataset.columns);
		fresh.push(r);
		return r.id;
	});
	let base = fresh.length
		? { ...dataset, records: [...dataset.records, ...fresh] }
		: dataset;
	const writes: CellWrite[] = [];
	block.forEach((row, i) => {
		const id = ids[i] as string;
		keys.forEach((key, j) => {
			const text = row[j];
			if (text === undefined) return;
			const value = pastedValue(base, key, text);
			if (value !== undefined) writes.push({ id, key, value });
		});
	});
	base = writeCells(base, writes);
	return {
		dataset: base,
		cells: writes.length,
		misfits: misfitCount(base, writes),
		added: fresh.length,
		clipped: Math.max(0, width - keys.length),
	};
}
