import type { Column, ColumnType, DataRecord } from "@freshcoat-js/workspace";
import {
	type SortSpec,
	sortByStatus,
	sortRecords,
} from "@freshcoat-js/workspace/dataset";

/** Grid column ids that are not dataset columns. Neither is a valid key. */
export const INDEX_COLUMN = "#";
export const STATUS_COLUMN = "@status";

export const TYPE_LABELS: Record<ColumnType, string> = {
	text: "Text",
	longText: "Long text",
	number: "Number",
	integer: "Integer",
	boolean: "Yes / no",
	date: "Date",
	color: "Color",
	url: "URL",
	email: "Email",
	image: "Image",
};

/** `sortRecords`, plus the grid's index and status columns. */
export function sortGridRecords(
	records: readonly DataRecord[],
	columns: readonly Column[],
	sort: SortSpec | undefined,
	indexOf: (id: string) => number,
): readonly DataRecord[] {
	if (!sort) return records;
	if (sort.column === INDEX_COLUMN) {
		return sort.direction === "ascending"
			? records
			: [...records].sort((a, b) => indexOf(b.id) - indexOf(a.id));
	}
	if (sort.column === STATUS_COLUMN)
		return sortByStatus(records, sort.direction);
	return sortRecords(records, columns, sort);
}
