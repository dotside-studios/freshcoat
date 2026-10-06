import {
	type ApplyMappingResult,
	applyMapping,
	type Dataset,
	type ImportPlan,
	type TableSheet,
} from "@freshcoat-js/workspace";

/** How many leading rows of each sheet the wizard sees. Header detection,
 *  mapping guesses, samples and the preview all read from these. */
export const HEAD_ROWS = 1000;

export type SheetHead = {
	name: string;
	/** the first `HEAD_ROWS` rows */
	rows: string[][];
	rowCount: number;
	/** indexes of the rows with no filled cell */
	blankRows: number[];
};

export type OpenedTable = { id: number; sheets: SheetHead[] };

/** The data records below `headerRow`, counted without the rows themselves. */
export function dataRowCount(sheet: SheetHead, headerRow: number): number {
	const first = Math.max(headerRow + 1, 0);
	let blank = 0;
	for (const r of sheet.blankRows) if (r >= first) blank += 1;
	return Math.max(sheet.rowCount - first - blank, 0);
}

function headOf(sheet: TableSheet): SheetHead {
	const blankRows: number[] = [];
	sheet.rows.forEach((row, r) => {
		if (!row.some((cell) => cell.trim() !== "")) blankRows.push(r);
	});
	return {
		name: sheet.name,
		rows: sheet.rows.slice(0, HEAD_ROWS),
		rowCount: sheet.rows.length,
		blankRows,
	};
}

/** Parsed tables, kept whole where they were read, so only their heads and
 *  the imported dataset cross to the page. */
export function createTableStore() {
	const tables = new Map<number, TableSheet[]>();
	let nextId = 1;
	return {
		async open(file: Blob, name: string): Promise<OpenedTable> {
			const { readTable } = await import("@freshcoat-js/workspace/tabular");
			const bytes = new Uint8Array(await file.arrayBuffer());
			const { sheets } = await readTable(bytes, name);
			const id = nextId++;
			tables.set(id, sheets);
			return { id, sheets: sheets.map(headOf) };
		},
		apply(
			table: number,
			sheet: number,
			dataset: Dataset,
			plan: ImportPlan,
		): ApplyMappingResult {
			const rows = tables.get(table)?.[sheet]?.rows;
			if (rows === undefined) throw new Error("The file is no longer open");
			return applyMapping(dataset, rows, plan);
		},
		close(table: number): void {
			tables.delete(table);
		},
	};
}

export type TableStore = ReturnType<typeof createTableStore>;
