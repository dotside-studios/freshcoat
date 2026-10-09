import type {
	CellValue,
	Column,
	DataRecord,
	Dataset,
	DatasetAsset,
	RecordStatus,
} from "@freshcoat-js/workspace";
import { createContext, useContext } from "react";
import type { ColumnChoices } from "./column-options";
import type { CellRef, GridUiStore } from "./grid-state";

export type GridContextValue = {
	dataset: Dataset;
	assets: ReadonlyMap<string, DatasetAsset>;
	/** 0-based position in the dataset, not in the sorted view. */
	indexOf: (recordId: string) => number;
	/** Cells read their record here, so a value edit re-renders the visible
	 *  cells without rebuilding the table's collection. */
	recordById: ReadonlyMap<string, DataRecord>;
	ui: GridUiStore;
	/** The text an inline editor holds, read when it commits. */
	draft: { current: string };
	setValue: (recordId: string, key: string, value: CellValue) => void;
	setStatus: (recordId: string, status: RecordStatus) => void;
	startEdit: (cell: CellRef, seed?: string, select?: boolean) => void;
	/** Ends the edit, committing the draft unless `cancel`. */
	finishEdit: (how: "commit" | "cancel") => void;
	importPhotos: () => void;
	openStatusMenu: (recordId: string, anchor: HTMLElement) => void;
	columnByKey: (key: string) => Column | undefined;
	/** What the cells of a column with options pick from, by key. */
	columnChoices: ReadonlyMap<string, ColumnChoices>;
};

export const GridContext = createContext<GridContextValue | null>(null);

export function useGrid(): GridContextValue {
	const ctx = useContext(GridContext);
	if (!ctx) throw new Error("useGrid outside <RecordsGrid>");
	return ctx;
}
