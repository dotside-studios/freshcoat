import { formatValue, isDateFormat } from "hucre";
import { readOds } from "hucre/ods";
import { readXls, readXlsx, writeXlsx } from "hucre/xlsx";
import { serialToIso } from "../columns";
import type { TableSheet } from "../types";
import { cellText, type WorkbookCell, type WorkbookCodec } from "./codec";

type Book = Awaited<ReturnType<typeof readXlsx>>;

const READERS: Record<
	string,
	(bytes: Uint8Array, options: { readStyles: true }) => Promise<Book>
> = {
	xlsx: readXlsx,
	xlsm: readXlsx,
	xls: readXls,
	ods: readOds,
};

function formatted(cell: WorkbookCell, numFmt: string | undefined): string {
	if (typeof cell !== "number" || !numFmt || numFmt === "General")
		return cellText(cell);
	if (isDateFormat(numFmt)) return serialToIso(cell) ?? cellText(cell);
	return formatValue(cell, numFmt);
}

export const hucreCodec: WorkbookCodec = {
	async read(bytes, extension) {
		const reader = READERS[extension];
		if (!reader) throw new Error(`hucre does not read .${extension}`);
		const book = await reader(bytes, { readStyles: true });
		return book.sheets.map(
			(sheet): TableSheet => ({
				name: sheet.name,
				rows: sheet.rows.map((row, r) =>
					row.map((value, c) =>
						formatted(
							value as WorkbookCell,
							sheet.cells?.get(`${r},${c}`)?.style?.numFmt,
						),
					),
				),
			}),
		);
	},
	async write(sheet, format) {
		if (format !== "xlsx")
			throw new Error(`hucre codec does not write ${format}`);
		return writeXlsx({
			sheets: [
				{
					name: sheet.name,
					rows: sheet.rows.map((row) =>
						row.map((cell) =>
							cell instanceof Date
								? { value: cell, style: { numFmt: "yyyy-mm-dd" } }
								: cell,
						),
					),
				},
			],
		});
	},
};
