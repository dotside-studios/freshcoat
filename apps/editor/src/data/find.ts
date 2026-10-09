import type { Column, DataRecord, Dataset } from "@freshcoat-js/workspace";
import {
	assetMap,
	type CellWrite,
	displayText,
	valueFromText,
	writeCells,
} from "@freshcoat-js/workspace/dataset";

export type FindSpec = {
	text: string;
	/** One column's key, or every column when absent. */
	column?: string;
	matchCase?: boolean;
};

function occurrences(haystack: string, needle: string): number {
	let n = 0;
	for (let at = haystack.indexOf(needle); at >= 0; ) {
		n++;
		at = haystack.indexOf(needle, at + needle.length);
	}
	return n;
}

function searched(dataset: Dataset, spec: FindSpec): Column[] {
	return spec.column === undefined
		? dataset.columns
		: dataset.columns.filter((c) => c.key === spec.column);
}

/** Each matching cell's text, with the number of times `spec` occurs in it. */
function* matchingCells(
	dataset: Dataset,
	records: readonly DataRecord[],
	spec: FindSpec,
) {
	if (spec.text === "") return;
	const columns = searched(dataset, spec);
	const assets = assetMap(dataset.assets);
	const needle = spec.matchCase ? spec.text : spec.text.toLowerCase();
	for (const record of records)
		for (const column of columns) {
			const text = displayText(column, record.values[column.key], assets);
			if (text === "") continue;
			const n = occurrences(spec.matchCase ? text : text.toLowerCase(), needle);
			if (n > 0) yield { record, column, text, n };
		}
}

/** How often `spec` occurs in the records, and in how many of them. */
export function countMatches(
	dataset: Dataset,
	records: readonly DataRecord[],
	spec: FindSpec,
): { matches: number; records: number } {
	let matches = 0;
	let last: DataRecord | undefined;
	let hit = 0;
	for (const m of matchingCells(dataset, records, spec)) {
		matches += m.n;
		if (m.record !== last) {
			hit++;
			last = m.record;
		}
	}
	return { matches, records: hit };
}

function replaceText(
	text: string,
	find: string,
	by: string,
	matchCase: boolean,
): string {
	if (matchCase) return text.split(find).join(by);
	const lower = text.toLowerCase();
	const needle = find.toLowerCase();
	let out = "";
	let from = 0;
	for (let at = lower.indexOf(needle); at >= 0; ) {
		out += text.slice(from, at) + by;
		from = at + find.length;
		at = lower.indexOf(needle, from);
	}
	return out + text.slice(from);
}

/**
 * Every occurrence of `spec` in the records replaced by `by`, each changed
 * cell's text parsed again by its column's type.
 */
export function replaceAll(
	dataset: Dataset,
	records: readonly DataRecord[],
	spec: FindSpec,
	by: string,
): { dataset: Dataset; matches: number; writes: CellWrite[] } {
	const writes: CellWrite[] = [];
	let matches = 0;
	for (const m of matchingCells(dataset, records, spec)) {
		matches += m.n;
		const text = replaceText(m.text, spec.text, by, !!spec.matchCase);
		writes.push({
			id: m.record.id,
			key: m.column.key,
			value:
				text.trim() === ""
					? null
					: valueFromText(m.column, text, dataset.assets),
		});
	}
	return { dataset: writeCells(dataset, writes), matches, writes };
}
