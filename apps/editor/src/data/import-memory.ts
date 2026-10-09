import type { Column, ColumnMapping } from "@freshcoat-js/workspace";

const KEY = "freshcoat.importMapping.";

type Remembered = { headers: string[]; mapping: ColumnMapping[] };

export function rememberMapping(
	datasetId: string,
	headers: readonly string[],
	mapping: readonly ColumnMapping[],
): void {
	try {
		localStorage.setItem(KEY + datasetId, JSON.stringify({ headers, mapping }));
	} catch {}
}

function read(datasetId: string): Remembered | null {
	try {
		const raw = localStorage.getItem(KEY + datasetId);
		const parsed = raw ? (JSON.parse(raw) as Remembered) : null;
		return Array.isArray(parsed?.headers) && Array.isArray(parsed?.mapping)
			? parsed
			: null;
	} catch {
		return null;
	}
}

/** The last mapping used for the dataset, by header, for the headers it
 *  knows. A new column it added is now an existing column. */
export function recallMapping(
	datasetId: string,
	headers: readonly string[],
	columns: readonly Column[],
): (ColumnMapping | undefined)[] {
	const memory = read(datasetId);
	return headers.map((header) => {
		if (!memory || header === "") return undefined;
		const m = memory.mapping[memory.headers.indexOf(header)];
		if (!m) return undefined;
		if (m.kind === "skip") return m;
		const key = m.kind === "column" ? m.column : m.key;
		if (columns.some((c) => c.key === key))
			return { kind: "column", column: key };
		return m.kind === "new" ? m : undefined;
	});
}
