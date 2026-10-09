import type { ColumnFilter, StatusFilter } from "./gallery-model";
import type { SortSpec } from "./model";

/** How Data shows one dataset: kept in the store per dataset, so it
 *  survives leaving the section. */
export type DataViewState = {
	query: string;
	statusFilter: StatusFilter;
	columnFilters: readonly ColumnFilter[];
	sort?: SortSpec;
	selection: "all" | ReadonlySet<string>;
	/** the records the last import left with issues */
	imported?: ReadonlySet<string>;
};

export const DEFAULT_DATA_VIEW: DataViewState = {
	query: "",
	statusFilter: "all",
	columnFilters: [],
	selection: new Set(),
};
