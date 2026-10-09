import { dateToIso } from "../columns";
import type { TableFormat, TableSheet } from "../types";

/** A cell as a workbook library reads or writes it. */
export type WorkbookCell = string | number | boolean | Date | null;

/** One sheet to write. A `Date` is written as a date shown `yyyy-mm-dd`. */
export type WorkbookSheet = { name: string; rows: WorkbookCell[][] };

/**
 * One library's support for workbook files. `read` returns every sheet, empty
 * ones included, with cells turned to text by `cellText`, and throws on bytes
 * it cannot parse. A codec that only reads leaves out `write`.
 */
export interface WorkbookCodec {
	read(bytes: Uint8Array, extension: string): Promise<TableSheet[]>;
	write?(sheet: WorkbookSheet, format: TableFormat): Promise<Uint8Array>;
}

/** A cell's text, the same whichever library read it: dates as ISO dates,
 *  booleans as Excel shows them and numbers to the 15 digits Excel keeps. */
export function cellText(cell: WorkbookCell | undefined): string {
	if (cell === null || cell === undefined) return "";
	if (typeof cell === "string") return cell;
	if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
	if (cell instanceof Date) return dateToIso(cell) ?? "";
	return Number.isInteger(cell) || !Number.isFinite(cell)
		? String(cell)
		: String(Number(cell.toPrecision(15)));
}
