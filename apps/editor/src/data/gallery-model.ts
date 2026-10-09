import {
	type Column,
	type DataRecord,
	type Dataset,
	isEmptyValue,
	type RecordStatus,
} from "@freshcoat-js/workspace";
import {
	assetMap,
	displayText,
	filterRecords,
	recordIndexMap,
	recordIssues,
} from "@freshcoat-js/workspace/dataset";
import { STATUS_LABEL } from "~/app/copy";
import type { DataViewState } from "./data-view";
import { sortGridRecords } from "./model";
import type { ThumbWidth } from "./thumbnails";

// ── Views ─────────────────────────────────────────────────────────────────

export type RecordsView = "table" | "gallery";

/** A dataset opens as a gallery when it leads with a photo: its first image
 *  column is among its first three columns. */
export function defaultView(columns: readonly Column[]): RecordsView {
	const at = columns.findIndex((c) => c.type === "image");
	return at >= 0 && at < 3 ? "gallery" : "table";
}

const chosenViews = new Map<string, RecordsView>();

/** The view a dataset shows: the one chosen for it this session, or its
 *  default. */
export function viewFor(dataset: Pick<Dataset, "id" | "columns">): RecordsView {
	return chosenViews.get(dataset.id) ?? defaultView(dataset.columns);
}

export function rememberView(datasetId: string, view: RecordsView): void {
	chosenViews.set(datasetId, view);
}

/** Forgets every choice, for tests. */
export function forgetViews(): void {
	chosenViews.clear();
}

// ── Cards ─────────────────────────────────────────────────────────────────

export type CardSize = "s" | "m" | "l";

export const CARD_SIZES: Record<
	CardSize,
	{ label: string; min: number; caption: number; narrowColumns: number }
> = {
	s: { label: "Small", min: 112, caption: 24, narrowColumns: 3 },
	m: { label: "Medium", min: 168, caption: 40, narrowColumns: 2 },
	l: { label: "Large", min: 264, caption: 40, narrowColumns: 1 },
};

/** Cards may grow to this much past their minimum to fill a row. */
const GROWTH = 1.5;
export const CARD_GAP = 12;

export type CardLayout = {
	minItemSize: { width: number; height: number };
	maxItemSize: { width: number; height: number };
	maxColumns: number;
	gap: number;
};

/**
 * The gallery grid for a card size. A card is a square photo well over a
 * caption of fixed height, so its height is always its width plus the
 * caption. On a narrow window the column count is fixed instead, and the
 * cards share the `width` the grid has.
 */
export function cardLayout(
	size: CardSize,
	narrow: boolean,
	width = 0,
): CardLayout {
	const { min, caption, narrowColumns } = CARD_SIZES[size];
	if (narrow && width > 0) {
		const n = narrowColumns;
		const w = Math.max(64, Math.floor((width - CARD_GAP * (n + 1)) / n));
		return {
			minItemSize: { width: w, height: w + caption },
			maxItemSize: { width: w, height: w + caption },
			maxColumns: n,
			gap: CARD_GAP,
		};
	}
	const max = Math.round(min * GROWTH);
	return {
		minItemSize: { width: min, height: min + caption },
		maxItemSize: { width: max, height: max + caption },
		maxColumns: Number.POSITIVE_INFINITY,
		gap: CARD_GAP,
	};
}

/** The smallest thumbnail that stays sharp at `cssWidth` on this screen. */
export function thumbWidthFor(cssWidth: number, dpr = 1): ThumbWidth {
	const px = cssWidth * dpr;
	return px <= 160 ? 160 : px <= 320 ? 320 : 640;
}

/** The column a card shows as its photo. */
export function imageColumn(columns: readonly Column[]): Column | undefined {
	return columns.find((c) => c.type === "image");
}

/** The column a card is titled by: the first plain text column, or failing
 *  that the first textual one. */
export function titleColumn(columns: readonly Column[]): Column | undefined {
	return (
		columns.find((c) => c.type === "text") ??
		columns.find((c) => ["longText", "email", "url"].includes(c.type))
	);
}

// ── Filters and totals ───────────────────────────────────────────────────

export type StatusFilter = "all" | RecordStatus | "issues" | "imported";

export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
	{ id: "all", label: "All records" },
	{ id: "pending", label: STATUS_LABEL.pending },
	{ id: "exported", label: STATUS_LABEL.exported },
	{ id: "failed", label: STATUS_LABEL.failed },
	{ id: "skipped", label: STATUS_LABEL.skipped },
	{ id: "issues", label: "With issues" },
];

export const IMPORT_ISSUES_FILTER: { id: StatusFilter; label: string } = {
	id: "imported",
	label: "Import issues",
};

export function filterByStatus(
	records: readonly DataRecord[],
	dataset: Pick<Dataset, "columns" | "assets">,
	filter: StatusFilter,
	imported?: ReadonlySet<string>,
): readonly DataRecord[] {
	if (filter === "all") return records;
	if (filter === "imported")
		return records.filter((r) => imported?.has(r.id) ?? false);
	if (filter === "issues")
		return records.filter((r) => recordIssues(dataset, r).length > 0);
	return records.filter((r) => r.status === filter);
}

export type ColumnFilterOp = "contains" | "equals" | "empty";

export type ColumnFilter = {
	id: string;
	column: string;
	op: ColumnFilterOp;
	value: string;
};

export const FILTER_OPS: { id: ColumnFilterOp; label: string }[] = [
	{ id: "contains", label: "contains" },
	{ id: "equals", label: "equals" },
	{ id: "empty", label: "is empty" },
];

/** Whether a filter narrows anything: one that needs a value and has none
 *  does not. */
export function filterActive(
	filter: ColumnFilter,
	columns: readonly Column[],
): boolean {
	if (!columns.some((c) => c.key === filter.column)) return false;
	return filter.op === "empty" || filter.value.trim() !== "";
}

/** Records passing every column filter, comparing shown text without case. */
export function filterByColumns(
	records: readonly DataRecord[],
	dataset: Pick<Dataset, "columns" | "assets">,
	filters: readonly ColumnFilter[],
): readonly DataRecord[] {
	const tests = filters
		.filter((f) => filterActive(f, dataset.columns))
		.map((f) => {
			const column = dataset.columns.find((c) => c.key === f.column) as Column;
			const want = f.value.trim().toLowerCase();
			return { column, op: f.op, want };
		});
	if (tests.length === 0) return records;
	const assets = assetMap(dataset.assets);
	return records.filter((r) =>
		tests.every(({ column, op, want }) => {
			const value = r.values[column.key] ?? null;
			if (op === "empty") return isEmptyValue(value);
			const text = displayText(column, value, assets).toLowerCase();
			return op === "equals" ? text.trim() === want : text.includes(want);
		}),
	);
}

/** The records the view shows, in the order it shows them. */
export function shownRecords(
	dataset: Dataset,
	view: DataViewState,
	query = view.query,
) {
	const filtered = filterByColumns(
		filterByStatus(
			filterRecords(dataset.records, dataset, query),
			dataset,
			view.statusFilter,
			view.imported,
		),
		dataset,
		view.columnFilters,
	);
	const indexMap = recordIndexMap(dataset.records);
	return sortGridRecords(
		filtered,
		dataset.columns,
		view.sort,
		(id) => indexMap.get(id) ?? 0,
	);
}

/** The records selected in the view, in dataset order. */
export function selectedInView(
	dataset: Dataset,
	view: DataViewState | undefined,
): string[] {
	const selection = view?.selection;
	if (!view || !selection) return [];
	if (selection === "all") {
		const shown = new Set(shownRecords(dataset, view).map((r) => r.id));
		return dataset.records.filter((r) => shown.has(r.id)).map((r) => r.id);
	}
	if (selection.size === 0) return [];
	return dataset.records.filter((r) => selection.has(r.id)).map((r) => r.id);
}

/** The bytes of every photo the dataset holds. */
export function photoBytes(dataset: Pick<Dataset, "assets">): number {
	let n = 0;
	for (const a of dataset.assets) n += a.size;
	return n;
}
