import {
	type DataGridColumn,
	VirtualDataGrid,
} from "@freshcoat-js/ui/data-grid";
import { useCoarsePointer } from "@freshcoat-js/ui/data-table";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import type {
	Column,
	ColumnType,
	DataRecord,
	Dataset,
	RecordStatus,
} from "@freshcoat-js/workspace";
import {
	type KeyboardEvent,
	memo,
	type ReactNode,
	type Ref,
	useCallback,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { useController } from "~/app/context";
import { currentDataset, editDataset } from "./actions";
import {
	editsInline,
	IndexCell,
	RecordCell,
	STATUSES,
	StatusCell,
} from "./cells";
import { GridContext, type GridContextValue } from "./grid-context";
import type { CellRef, GridUiStore } from "./grid-state";
import {
	assetMap,
	INDEX_COLUMN,
	NUMERIC_TYPES,
	recordByIdMap,
	recordIndexMap,
	type SortSpec,
	STATUS_COLUMN,
	setCell,
	valueFromText,
} from "./model";

export type GridHandle = {
	/** Scrolls a record into view and focuses one of its cells. */
	reveal: (recordId: string, col?: string, edit?: boolean) => void;
};

type GridColumn = DataGridColumn & { column?: Column };

const WIDTHS: Record<ColumnType, number> = {
	text: 160,
	longText: 220,
	number: 100,
	integer: 96,
	boolean: 72,
	date: 120,
	color: 120,
	url: 200,
	email: 200,
	image: 170,
};

const activeCell =
	"focus:bg-fc-accent-soft/60 focus:outline-1 focus:outline-fc-accent focus:outline-solid focus:-outline-offset-1";

export type RecordsGridProps = {
	dataset: Dataset;
	rows: readonly DataRecord[];
	sort: SortSpec | undefined;
	onSortChange: (sort: SortSpec | undefined) => void;
	selection: Selection;
	onSelectionChange: (selection: Selection) => void;
	selectedIds: readonly string[];
	ui: GridUiStore;
	onColumnFocus: (key: string) => void;
	onDeleteRows: (ids: string[]) => void;
	onImportPhotos: () => void;
	emptyState: ReactNode;
	ref?: Ref<GridHandle>;
};

type RowItem = { id: string };

/** One item per shown record, kept identical while the shown ids and their
 *  order are, so a value edit does not rebuild the table's collection. */
export function useRowItems(rows: readonly DataRecord[]): RowItem[] {
	const cache = useRef<{ items: RowItem[]; byId: Map<string, RowItem> }>({
		items: [],
		byId: new Map(),
	});
	return useMemo(() => {
		const prev = cache.current;
		if (
			prev.items.length === rows.length &&
			rows.every((r, i) => prev.items[i]?.id === r.id)
		)
			return prev.items;
		const byId = new Map<string, RowItem>();
		const items = rows.map((r) => {
			const item = prev.byId.get(r.id) ?? { id: r.id };
			byId.set(r.id, item);
			return item;
		});
		cache.current = { items, byId };
		return items;
	}, [rows]);
}

function renderCell(id: string, c: GridColumn): ReactNode {
	if (c.column) return <RecordCell id={id} column={c.column} />;
	if (c.id === INDEX_COLUMN) return <IndexCell id={id} />;
	return <StatusCell id={id} />;
}

function cellProps(id: string, c: GridColumn) {
	return c.column
		? { "data-col": c.column.key, "data-row": id, className: activeCell }
		: undefined;
}

export const RecordsGrid = memo(function RecordsGrid({
	dataset,
	rows,
	sort,
	onSortChange,
	selection,
	onSelectionChange,
	selectedIds,
	ui,
	onColumnFocus,
	onDeleteRows,
	onImportPhotos,
	emptyState,
	ref,
}: RecordsGridProps) {
	const controller = useController();
	const coarse = useCoarsePointer();
	const wrapper = useRef<HTMLDivElement>(null);
	const draft = useRef("");
	const pendingEdit = useRef<string | null>(null);
	const anchor = useRef<string | null>(null);
	const latest = useRef({ dataset, rows, selectedIds, selection });
	latest.current = { dataset, rows, selectedIds, selection };
	const datasetId = dataset.id;
	const statusAnchor = useRef<HTMLElement | null>(null);
	const [statusMenu, setStatusMenu] = useState<string | null>(null);
	const openStatusMenu = useCallback((recordId: string, el: HTMLElement) => {
		statusAnchor.current = el;
		setStatusMenu(recordId);
	}, []);

	const assets = useMemo(() => assetMap(dataset.assets), [dataset.assets]);
	const indexMap = recordIndexMap(dataset.records);
	const recordById = recordByIdMap(dataset.records);
	const items = useRowItems(rows);

	const gridColumns = useMemo<GridColumn[]>(
		() => [
			{
				id: INDEX_COLUMN,
				header: "#",
				isRowHeader: true,
				allowsSorting: true,
				numeric: true,
				width: coarse ? 56 : 48,
				minWidth: 40,
			},
			{
				id: STATUS_COLUMN,
				header: "Status",
				allowsSorting: true,
				width: 92,
				minWidth: 72,
			},
			...dataset.columns.map((c) => ({
				id: c.key,
				column: c,
				allowsSorting: true,
				numeric: NUMERIC_TYPES.has(c.type),
				width: WIDTHS[c.type],
				minWidth: 56,
				header: (
					<span title={c.title ? `${c.title} (${c.key})` : c.key}>
						{c.key}
						{c.required ? <span className="text-fc-danger"> *</span> : null}
					</span>
				),
			})),
		],
		[dataset.columns, coarse],
	);
	const rowKeys = useMemo(() => items.map((i) => i.id), [items]);

	const findCell = useCallback((cell: CellRef) => {
		const root = wrapper.current;
		if (!root) return null;
		return root.querySelector<HTMLElement>(
			`[role=gridcell][data-row="${CSS.escape(cell.row)}"][data-col="${CSS.escape(cell.col)}"]`,
		);
	}, []);

	/** Focuses a cell once it is mounted, which may take a frame or two
	 *  after a scroll or an edit. */
	const focusCell = useCallback(
		(cell: CellRef, then?: () => void) => {
			let tries = 0;
			const tick = () => {
				const el = findCell(cell);
				if (el) {
					el.focus();
					then?.();
				} else if (tries++ < 30) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		[findCell],
	);

	const startEdit = useCallback(
		(cell: CellRef, seed?: string, select?: boolean) => {
			const column = latest.current.dataset.columns.find(
				(c) => c.key === cell.col,
			);
			if (!column || column.type === "boolean") return;
			ui.set({
				active: cell,
				editing:
					seed && editsInline(column)
						? { ...cell, seed }
						: select
							? { ...cell, select }
							: cell,
			});
		},
		[ui],
	);

	const finishEdit = useCallback(
		(how: "commit" | "cancel") => {
			const editing = ui.get().editing;
			if (!editing) return;
			ui.set({ editing: null });
			if (how !== "commit") return;
			const d = currentDataset(controller, datasetId);
			const column = d?.columns.find((c) => c.key === editing.col);
			if (!d || !column) return;
			const value = valueFromText(column, draft.current, d.assets);
			editDataset(
				controller,
				datasetId,
				(ds) => setCell(ds, editing.row, editing.col, value),
				`cell:${datasetId}:${editing.row}:${editing.col}`,
			);
		},
		[controller, datasetId, ui],
	);

	const setValue = useCallback(
		(
			recordId: string,
			key: string,
			value: Dataset["records"][0]["values"][string],
		) =>
			void editDataset(
				controller,
				datasetId,
				(d) => setCell(d, recordId, key, value),
				`cell:${datasetId}:${recordId}:${key}`,
			),
		[controller, datasetId],
	);

	const setStatus = useCallback(
		(recordId: string, status: RecordStatus) => {
			const selected = latest.current.selectedIds;
			controller.dispatch({
				type: "setRecordStatus",
				datasetId,
				ids: selected.includes(recordId) ? [...selected] : [recordId],
				status,
			});
		},
		[controller, datasetId],
	);

	const ctx = useMemo<GridContextValue>(
		() => ({
			dataset,
			assets,
			indexOf: (id) => indexMap.get(id) ?? -1,
			recordById,
			ui,
			draft,
			setValue,
			setStatus,
			startEdit,
			finishEdit,
			importPhotos: onImportPhotos,
			openStatusMenu,
			columnByKey: (key) => dataset.columns.find((c) => c.key === key),
		}),
		[
			dataset,
			assets,
			indexMap,
			recordById,
			ui,
			setValue,
			setStatus,
			startEdit,
			finishEdit,
			onImportPhotos,
			openStatusMenu,
		],
	);

	/** Tab and Shift-Tab: the next data cell in the row, through the grid's
	 *  own arrow-key navigation so a column scrolled out of view comes in. */
	const move = useCallback(
		(from: CellRef, dir: 1 | -1, edit: boolean): boolean => {
			const cols = latest.current.dataset.columns;
			const next = cols[cols.findIndex((c) => c.key === from.col) + dir];
			const el = findCell(from);
			if (!next || !el) return false;
			pendingEdit.current = edit ? next.key : null;
			if (document.activeElement !== el) el.focus();
			el.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: dir > 0 ? "ArrowRight" : "ArrowLeft",
					bubbles: true,
					cancelable: true,
				}),
			);
			return true;
		},
		[findCell],
	);

	useImperativeHandle(
		ref,
		() => ({
			reveal: (recordId, col, edit) => {
				const index = latest.current.rows.findIndex((r) => r.id === recordId);
				const scroller =
					wrapper.current?.querySelector<HTMLElement>("[role=grid]");
				if (index < 0 || !scroller) return;
				const rowH = coarse ? 32 : 24;
				const headH = coarse ? 32 : 26;
				const top = index * rowH;
				const view = scroller.clientHeight - headH;
				if (top < scroller.scrollTop) scroller.scrollTop = top;
				else if (top + rowH > scroller.scrollTop + view)
					scroller.scrollTop = top + rowH - view + rowH;
				const key = col ?? latest.current.dataset.columns[0]?.key;
				if (!key) return;
				if (key === latest.current.dataset.columns[0]?.key)
					scroller.scrollLeft = 0;
				const cell = { row: recordId, col: key };
				focusCell(cell, () => {
					if (edit) startEdit(cell, undefined, true);
				});
			},
		}),
		[coarse, focusCell, startEdit],
	);

	const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		// Keys from popovers bubble through React but are not in the grid.
		if (!wrapper.current?.contains(target)) return;
		const editing = ui.get().editing;
		if (editing) {
			if (!target.closest("[data-cell-editor]")) return;
			if (e.nativeEvent.isComposing) return;
			if (e.key === "Escape" || e.key === "Enter" || e.key === "Tab") {
				e.preventDefault();
				e.stopPropagation();
				finishEdit(e.key === "Escape" ? "cancel" : "commit");
				requestAnimationFrame(() => {
					const el = findCell(editing);
					if (!el) return;
					el.focus();
					if (e.key === "Tab") {
						if (!move(editing, e.shiftKey ? -1 : 1, true))
							pendingEdit.current = null;
					}
				});
				return;
			}
			// The input keeps its keys: arrows move the caret, not the cell.
			const mod = e.metaKey || e.ctrlKey;
			if (!mod || /^[acvxyz]$/i.test(e.key)) e.stopPropagation();
			return;
		}

		const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
		const mod = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
		const cellEl = target.closest<HTMLElement>("[data-col]");
		const row = cellEl?.dataset.row;
		const col = cellEl?.dataset.col;
		if (e.key === "Delete" || e.key === "Backspace") {
			const selected = latest.current.selectedIds;
			if (row && col && plain) {
				e.preventDefault();
				e.stopPropagation();
				setValue(row, col, null);
			} else if (selected.length > 0 && (plain || mod)) {
				e.preventDefault();
				e.stopPropagation();
				onDeleteRows([...selected]);
			} else if (row && mod) {
				e.preventDefault();
				e.stopPropagation();
				onDeleteRows([row]);
			}
			return;
		}
		if (!cellEl?.dataset.row || !cellEl.dataset.col) return;
		if (target !== cellEl) return;
		const cell = { row: cellEl.dataset.row, col: cellEl.dataset.col };
		const column = ctx.columnByKey(cell.col);
		if (!column) return;
		const record = latest.current.dataset.records.find(
			(r) => r.id === cell.row,
		);
		const toggle = () =>
			setValue(cell.row, cell.col, record?.values[cell.col] !== true);

		if (e.key === "Enter" || e.key === "F2") {
			e.preventDefault();
			e.stopPropagation();
			if (column.type === "boolean") toggle();
			else startEdit(cell);
		} else if (e.key === " " && column.type === "boolean") {
			e.preventDefault();
			e.stopPropagation();
			toggle();
		} else if (e.key === "Tab" && !e.altKey) {
			if (move(cell, e.shiftKey ? -1 : 1, false)) {
				e.preventDefault();
				e.stopPropagation();
			}
		} else if (
			plain &&
			e.key.length === 1 &&
			e.key !== " " &&
			editsInline(column)
		) {
			e.preventDefault();
			e.stopPropagation();
			startEdit(cell, column.type === "date" ? undefined : e.key);
		}
	};

	const onFocusCapture = (e: React.FocusEvent<HTMLDivElement>) => {
		const cellEl = (e.target as HTMLElement).closest?.<HTMLElement>(
			"[data-col]",
		);
		const row = cellEl?.dataset.row;
		const col = cellEl?.dataset.col;
		if (!row || !col) return;
		ui.set({ active: { row, col } });
		onColumnFocus(col);
		if (pendingEdit.current === col) {
			pendingEdit.current = null;
			startEdit({ row, col });
		}
	};

	/** Shift-click on a row checkbox selects the range from the last one. */
	const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		const box = target.closest("label");
		const rowEl = target.closest<HTMLElement>("[role=row][data-row]");
		if (!box || !rowEl?.dataset.row) return;
		const id = rowEl.dataset.row;
		if (!e.shiftKey || !anchor.current) {
			anchor.current = id;
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const ids = latest.current.rows.map((r) => r.id);
		const a = ids.indexOf(anchor.current);
		const b = ids.indexOf(id);
		if (a < 0 || b < 0) return;
		const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
		const current = latest.current.selection;
		const base = current === "all" ? ids : [...current].map(String);
		onSelectionChange(new Set([...base, ...range]));
	};

	const datasetName = dataset.name;
	// A value edit reaches the cells through the grid context; keeping the
	// grid element the same skips re-rendering its rows.
	const table = useMemo(
		() => (
			<VirtualDataGrid
				aria-label={`Records of ${datasetName}`}
				className="flex-1 min-h-0"
				columns={gridColumns}
				rowKeys={rowKeys}
				renderCell={renderCell}
				cellProps={cellProps}
				selectedKeys={selection}
				onSelectionChange={onSelectionChange}
				sortDescriptor={sort as SortDescriptor | undefined}
				onSortChange={(next) => {
					const column = String(next.column);
					onSortChange(
						sort?.column === column && sort.direction === "descending"
							? undefined
							: { column, direction: next.direction },
					);
					if (column !== INDEX_COLUMN && column !== STATUS_COLUMN)
						onColumnFocus(column);
				}}
				renderEmptyState={() => (
					<div className="px-3 py-8 text-center text-fc-faint text-fc-sm">
						{emptyState}
					</div>
				)}
			/>
		),
		[
			datasetName,
			selection,
			onSelectionChange,
			sort,
			onSortChange,
			onColumnFocus,
			gridColumns,
			rowKeys,
			emptyState,
		],
	);

	return (
		<GridContext.Provider value={ctx}>
			<div
				ref={wrapper}
				data-testid="records-grid"
				className="flex min-h-0 flex-1 flex-col"
				onKeyDownCapture={onKeyDownCapture}
				onFocusCapture={onFocusCapture}
				onClickCapture={onClickCapture}
			>
				{table}
			</div>
			{statusMenu ? (
				<Popover
					triggerRef={statusAnchor}
					isOpen
					placement="bottom start"
					onOpenChange={(open) => {
						if (!open) setStatusMenu(null);
					}}
				>
					<Menu
						aria-label="Set status"
						autoFocus="first"
						selectionMode="single"
						selectedKeys={[
							dataset.records.find((r) => r.id === statusMenu)?.status ??
								"pending",
						]}
						onAction={(key) => {
							setStatus(statusMenu, key as RecordStatus);
							setStatusMenu(null);
						}}
					>
						{STATUSES.map((s) => (
							<MenuItem key={s.id} id={s.id}>
								{s.label}
							</MenuItem>
						))}
					</Menu>
				</Popover>
			) : null}
		</GridContext.Provider>
	);
});
