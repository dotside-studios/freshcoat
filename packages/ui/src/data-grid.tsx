// biome-ignore-all lint/a11y/useSemanticElements: an ARIA grid of divs; table elements cannot be positioned row by row
// biome-ignore-all lint/a11y/useFocusableInteractive: focus moves between cells, not rows
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type HTMLAttributes,
	type KeyboardEvent,
	type MouseEvent,
	memo,
	type PointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { Checkbox } from "./checkbox";
import { useCoarsePointer } from "./data-table";
import { ChevronDownIcon } from "./icons";
import { cn } from "./lib/cn";

export interface DataGridColumn {
	id: string;
	header?: ReactNode;
	width: number;
	minWidth?: number;
	allowsSorting?: boolean;
	/** Right-aligned heading and cells. */
	numeric?: boolean;
	/** Its cells name their row for assistive tech. */
	isRowHeader?: boolean;
	/** Share of the free width this column takes past `width`. */
	grow?: number;
}

export type DataGridCellProps = HTMLAttributes<HTMLDivElement> & {
	[data: `data-${string}`]: string | undefined;
};

export interface VirtualDataGridProps<C extends DataGridColumn> {
	"aria-label": string;
	/** Classes for the outer box. Give it a height (or flex-1 in a column). */
	className?: string;
	columns: readonly C[];
	/** One key per row, in the order shown. */
	rowKeys: readonly string[];
	renderCell: (rowKey: string, column: C) => ReactNode;
	/** Extra attributes for a body cell. */
	cellProps?: (rowKey: string, column: C) => DataGridCellProps | undefined;
	selectedKeys: Selection;
	onSelectionChange: (selection: Selection) => void;
	sortDescriptor?: SortDescriptor;
	onSortChange?: (sort: SortDescriptor) => void;
	renderEmptyState?: () => ReactNode;
	/** A plain click or Enter on a row; without it they toggle its selection. */
	onRowAction?: (rowKey: string) => void;
	rowClassName?: (rowKey: string) => string | undefined;
	/** Row height in px. Defaults to 24, or 32 on coarse pointers. */
	rowHeight?: number;
	/** Header height in px. Defaults to 26, or 32 on coarse pointers. */
	headingHeight?: number;
}

const SELECT = "__select";
const HEADER = "";

type CellKey = { row: string; col: string };

const cellBase =
	"flex h-full shrink-0 items-center overflow-hidden border-fc-border border-b border-l outline-none first:border-l-0 " +
	"focus-visible:outline-1 focus-visible:outline-solid focus-visible:outline-fc-accent focus-visible:-outline-offset-1";

const headerCell =
	"group/col relative cursor-default select-none bg-fc-raised font-medium text-fc-muted text-fc-sm hover:text-fc-text data-[sort-direction]:text-fc-text";

const rowBase =
	"absolute top-0 left-0 flex w-full min-w-max cursor-default text-fc-text " +
	"hover:not-data-selected:bg-fc-raised data-selected:bg-fc-accent-soft";

/**
 * A grid of rows that mounts only the rows in view, so its cost does not
 * grow with the row count. Rows select through their checkboxes, a click,
 * Shift-click and Mod-click; arrow keys, Page Up/Down and Home/End move a
 * roving focus between cells, and with Shift extend the selected range.
 */
export function VirtualDataGrid<C extends DataGridColumn>({
	"aria-label": label,
	className,
	columns,
	rowKeys,
	renderCell,
	cellProps,
	onRowAction,
	rowClassName,
	selectedKeys,
	onSelectionChange,
	sortDescriptor,
	onSortChange,
	renderEmptyState,
	rowHeight: rowHeightProp,
	headingHeight: headingHeightProp,
}: VirtualDataGridProps<C>) {
	const coarse = useCoarsePointer();
	const rowHeight = rowHeightProp ?? (coarse ? 32 : 24);
	const headingHeight = headingHeightProp ?? (coarse ? 32 : 26);
	const selectWidth = coarse ? 36 : 28;
	const scroller = useRef<HTMLDivElement>(null);
	const anchor = useRef<string | null>(null);
	/** Where the last range from the anchor ended, so the next one replaces it. */
	const extent = useRef<string | null>(null);
	const latest = useRef({ rowKeys, selectedKeys, onSelectionChange });
	latest.current = { rowKeys, selectedKeys, onSelectionChange };

	const [resized, setResized] = useState<Record<string, number>>({});
	const widths = useMemo(
		() => columns.map((c) => resized[c.id] ?? c.width),
		[columns, resized],
	);
	const totalWidth = useMemo(
		() => widths.reduce((sum, w) => sum + w, selectWidth),
		[widths, selectWidth],
	);

	const [focused, setFocused] = useState<CellKey | null>(null);
	const focusedRow = focused?.row;
	const focusedIndex = useMemo(
		() =>
			focusedRow === undefined || focusedRow === HEADER
				? -1
				: rowKeys.indexOf(focusedRow),
		[rowKeys, focusedRow],
	);

	const virtualizer = useVirtualizer({
		count: rowKeys.length,
		getScrollElement: () => scroller.current,
		estimateSize: useCallback(() => rowHeight, [rowHeight]),
		overscan: 8,
		scrollMargin: headingHeight,
		scrollPaddingStart: headingHeight,
		initialRect: { width: 800, height: 600 },
		// The focused row stays mounted, so focus is not lost on scroll.
		rangeExtractor: useCallback(
			(range: {
				startIndex: number;
				endIndex: number;
				overscan: number;
				count: number;
			}) => {
				const out: number[] = [];
				const start = Math.max(0, range.startIndex - range.overscan);
				const end = Math.min(range.count - 1, range.endIndex + range.overscan);
				for (let i = start; i <= end; i++) out.push(i);
				if (focusedIndex >= 0 && focusedIndex < range.count) {
					if (focusedIndex < start) out.unshift(focusedIndex);
					else if (focusedIndex > end) out.push(focusedIndex);
				}
				return out;
			},
			[focusedIndex],
		),
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new row height re-lays the rows
	useEffect(() => {
		virtualizer.measure();
	}, [virtualizer, rowHeight]);

	const isSelected = useCallback(
		(key: string) => selectedKeys === "all" || selectedKeys.has(key),
		[selectedKeys],
	);
	const allState = useMemo(() => {
		if (selectedKeys === "all") return rowKeys.length > 0 ? "all" : "none";
		if (selectedKeys.size === 0) return "none";
		if (selectedKeys.size >= rowKeys.length)
			return rowKeys.every((k) => selectedKeys.has(k)) ? "all" : "some";
		return "some";
	}, [selectedKeys, rowKeys]);

	const toggle = useCallback((key: string) => {
		const { rowKeys, selectedKeys, onSelectionChange } = latest.current;
		const next = new Set<string | number>(
			selectedKeys === "all" ? rowKeys : selectedKeys,
		);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		anchor.current = key;
		extent.current = null;
		onSelectionChange(next);
	}, []);

	const extendTo = useCallback((key: string, origin?: string) => {
		const { rowKeys, selectedKeys, onSelectionChange } = latest.current;
		const to = rowKeys.indexOf(key);
		if (to < 0) return;
		let from = anchor.current ? rowKeys.indexOf(anchor.current) : -1;
		if (from < 0) {
			extent.current = null;
			if (origin === undefined) {
				anchor.current = key;
				onSelectionChange(new Set([key]));
				return;
			}
			anchor.current = origin;
			from = rowKeys.indexOf(origin);
			if (from < 0) return;
		}
		const next = new Set<string | number>(
			selectedKeys === "all" ? rowKeys : selectedKeys,
		);
		const prev = extent.current ? rowKeys.indexOf(extent.current) : -1;
		if (prev >= 0)
			for (let i = Math.min(from, prev); i <= Math.max(from, prev); i++)
				next.delete(rowKeys[i] as string);
		for (let i = Math.min(from, to); i <= Math.max(from, to); i++)
			next.add(rowKeys[i] as string);
		extent.current = key;
		onSelectionChange(next);
	}, []);

	const sortBy = (column: C) => {
		if (!column.allowsSorting || !onSortChange) return;
		onSortChange({
			column: column.id,
			direction:
				sortDescriptor?.column === column.id &&
				sortDescriptor.direction === "ascending"
					? "descending"
					: "ascending",
		});
	};

	const focusAt = (rowIndex: number, col: string) => {
		const el = scroller.current;
		if (!el) return;
		const row = rowIndex < 0 ? HEADER : latest.current.rowKeys[rowIndex];
		if (row === undefined) return;
		setFocused({ row, col });
		if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "auto" });
		const selector =
			row === HEADER
				? `[data-header][data-column="${CSS.escape(col)}"]`
				: `[data-row="${CSS.escape(row)}"][data-column="${CSS.escape(col)}"]`;
		let tries = 0;
		const tick = () => {
			const target = el.querySelector<HTMLElement>(selector);
			if (target) target.focus();
			else if (tries++ < 30) requestAnimationFrame(tick);
		};
		tick();
	};

	const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
		const cell = (e.target as HTMLElement).closest?.<HTMLElement>(
			"[data-column]",
		);
		if (!cell || !scroller.current?.contains(cell)) return;
		const row = cell.dataset.row ?? HEADER;
		const col = cell.dataset.column as string;
		setFocused((prev) =>
			prev?.row === row && prev.col === col ? prev : { row, col },
		);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		const el = scroller.current;
		// Keys from popovers bubble through React but are not in the grid.
		if (!el?.contains(target)) return;
		const cell = target.closest<HTMLElement>("[data-column]");
		if (!cell) return;
		const inControl = target !== cell;
		if (
			inControl &&
			target.matches(
				"input:not([type=checkbox]),textarea,select,[contenteditable]",
			)
		)
			return;
		const mod = e.metaKey || e.ctrlKey;
		const { rowKeys, selectedKeys } = latest.current;
		if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
			e.preventDefault();
			onSelectionChange("all");
			return;
		}
		if (e.key === "Escape") {
			if (selectedKeys !== "all" && selectedKeys.size === 0) return;
			e.preventDefault();
			onSelectionChange(new Set());
			return;
		}
		const row = cell.dataset.row;
		const col = cell.dataset.column as string;
		if (e.key === " " || e.key === "Enter") {
			if (inControl) return;
			if (row === undefined) {
				const column = columns.find((c) => c.id === col);
				if (column?.allowsSorting) {
					e.preventDefault();
					sortBy(column);
				} else if (col === SELECT && e.key === " ") {
					e.preventDefault();
					onSelectionChange(allState === "all" ? new Set() : "all");
				}
			} else if (e.key === " ") {
				e.preventDefault();
				toggle(row);
			} else if (onRowAction) {
				e.preventDefault();
				onRowAction(row);
			}
			return;
		}
		const cols = [SELECT, ...columns.map((c) => c.id)];
		const ci = cols.indexOf(col);
		const ri = row === undefined ? -1 : rowKeys.indexOf(row);
		const last = rowKeys.length - 1;
		const page = Math.max(
			1,
			Math.floor((el.clientHeight - headingHeight) / rowHeight) - 1,
		);
		let nr = ri;
		let nc = ci;
		switch (e.key) {
			case "ArrowDown":
				nr = mod ? last : ri + 1;
				break;
			case "ArrowUp":
				nr = mod ? 0 : ri - 1;
				break;
			case "ArrowRight":
				nc = ci + 1;
				break;
			case "ArrowLeft":
				nc = ci - 1;
				break;
			case "PageDown":
				nr = ri < 0 ? Math.min(last, page - 1) : ri + page;
				break;
			case "PageUp":
				nr = ri < 0 ? -1 : Math.max(0, ri - page);
				break;
			case "Home":
				if (e.shiftKey) nr = 0;
				else nc = 0;
				if (mod) nr = 0;
				break;
			case "End":
				if (e.shiftKey) nr = last;
				else nc = cols.length - 1;
				if (mod) nr = last;
				break;
			default:
				return;
		}
		e.preventDefault();
		nr = Math.max(-1, Math.min(last, nr));
		nc = Math.max(0, Math.min(cols.length - 1, nc));
		if (nr === ri && nc === ci) return;
		const nextRow = nr < 0 ? undefined : rowKeys[nr];
		if (nextRow !== undefined && nr !== ri) {
			if (e.shiftKey && row !== undefined) extendTo(nextRow, row);
			else if (!e.shiftKey) {
				anchor.current = nextRow;
				extent.current = null;
			}
		}
		focusAt(nr, cols[nc] as string);
	};

	const onClick = (e: MouseEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		if (target.closest("label,button,input,a")) return;
		const rowEl = target.closest<HTMLElement>("[role=row][data-row]");
		const key = rowEl?.dataset.row;
		if (!key || !scroller.current?.contains(rowEl)) return;
		if (e.shiftKey) extendTo(key);
		else if (onRowAction && !e.metaKey && !e.ctrlKey) onRowAction(key);
		else toggle(key);
	};

	const items = virtualizer.getVirtualItems();
	const range = virtualizer.range;
	const focusMounted =
		focusedIndex >= 0 && items.some((i) => i.index === focusedIndex);
	const headerFocused = focused?.row === HEADER;
	const fallbackRow =
		focusMounted || headerFocused
			? -1
			: Math.max(range?.startIndex ?? 0, items[0]?.index ?? 0);
	const fallbackCol =
		focused && !headerFocused ? focused.col : (columns[0]?.id ?? SELECT);
	const headerTabCol = headerFocused
		? focused.col
		: rowKeys.length === 0
			? (columns[0]?.id ?? SELECT)
			: null;
	const sortColumn = sortDescriptor?.column;

	return (
		<div
			className={cn(
				"relative flex min-h-0 flex-col overflow-hidden bg-fc-panel",
				className,
			)}
		>
			<div
				ref={scroller}
				role="grid"
				aria-label={label}
				aria-multiselectable="true"
				aria-rowcount={rowKeys.length + 1}
				aria-colcount={columns.length + 1}
				tabIndex={-1}
				className="relative min-h-0 w-full flex-1 overflow-auto overscroll-contain bg-fc-panel text-fc-base text-fc-text outline-none"
				style={{ scrollPaddingTop: headingHeight }}
				onKeyDown={onKeyDown}
				onFocus={onFocus}
				onClick={onClick}
			>
				<div
					role="rowgroup"
					className="sticky top-0 z-10 w-max min-w-full bg-fc-raised"
				>
					<div
						role="row"
						aria-rowindex={1}
						className="flex w-full min-w-max"
						style={{ height: headingHeight }}
					>
						<div
							role="columnheader"
							aria-colindex={1}
							data-header=""
							data-column={SELECT}
							tabIndex={headerTabCol === SELECT ? 0 : -1}
							className={cn(cellBase, headerCell, "justify-center")}
							style={{ width: selectWidth }}
						>
							<Checkbox
								aria-label="Select all"
								excludeFromTabOrder
								isSelected={allState === "all"}
								isIndeterminate={allState === "some"}
								onChange={(on) => onSelectionChange(on ? "all" : new Set())}
								className="min-h-0"
							/>
						</div>
						{columns.map((c, i) => {
							const direction =
								sortColumn === c.id ? sortDescriptor?.direction : undefined;
							return (
								// biome-ignore lint/a11y/useKeyWithClickEvents: the grid routes Enter and Space for the same action
								<div
									key={c.id}
									role="columnheader"
									aria-colindex={i + 2}
									aria-sort={
										direction ??
										(c.allowsSorting ? ("none" as const) : undefined)
									}
									data-header=""
									data-column={c.id}
									data-sort-direction={direction}
									tabIndex={headerTabCol === c.id ? 0 : -1}
									className={`${cellBase} ${headerCell}`}
									style={cellStyle(widths[i] as number, c.grow)}
									onClick={() => sortBy(c)}
								>
									<div
										className={cn(
											"flex h-full min-w-0 flex-1 items-center gap-1 px-2",
											c.numeric && "flex-row-reverse",
										)}
									>
										<span className="min-w-0 truncate">{c.header}</span>
										{c.allowsSorting ? (
											<ChevronDownIcon
												aria-hidden
												className={cn(
													"size-3 shrink-0 transition-transform duration-100",
													direction === "ascending" && "rotate-180",
													!direction && "opacity-0 group-hover/col:opacity-50",
												)}
											/>
										) : null}
									</div>
									<ColumnResizer
										width={widths[i] as number}
										minWidth={c.minWidth ?? 40}
										onResize={(w) =>
											setResized((prev) => ({ ...prev, [c.id]: w }))
										}
									/>
								</div>
							);
						})}
					</div>
				</div>
				{rowKeys.length === 0 ? (
					renderEmptyState ? (
						renderEmptyState()
					) : (
						<div className="px-3 py-6 text-center text-fc-faint text-fc-sm">
							Nothing to show
						</div>
					)
				) : (
					<div
						role="rowgroup"
						className="relative w-max min-w-full"
						style={{
							height: virtualizer.getTotalSize(),
							width: totalWidth,
						}}
					>
						{items.map((item) => {
							const key = rowKeys[item.index] as string;
							return (
								<GridRow
									key={key}
									rowKey={key}
									index={item.index}
									top={item.start - headingHeight}
									height={rowHeight}
									selected={isSelected(key)}
									className={rowClassName?.(key)}
									tabCol={
										item.index === focusedIndex && focused
											? focused.col
											: item.index === fallbackRow
												? fallbackCol
												: null
									}
									columns={columns}
									widths={widths}
									selectWidth={selectWidth}
									renderCell={renderCell}
									cellProps={cellProps}
									onToggle={toggle}
								/>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

type GridRowProps<C extends DataGridColumn> = {
	rowKey: string;
	index: number;
	top: number;
	height: number;
	selected: boolean;
	className: string | undefined;
	/** The cell that takes Tab into the grid, if it is in this row. */
	tabCol: string | null;
	columns: readonly C[];
	widths: readonly number[];
	selectWidth: number;
	renderCell: (rowKey: string, column: C) => ReactNode;
	cellProps?: (rowKey: string, column: C) => DataGridCellProps | undefined;
	onToggle: (rowKey: string) => void;
};

const GridRow = memo(function GridRow<C extends DataGridColumn>({
	rowKey,
	index,
	top,
	height,
	selected,
	className,
	tabCol,
	columns,
	widths,
	selectWidth,
	renderCell,
	cellProps,
	onToggle,
}: GridRowProps<C>) {
	return (
		<div
			role="row"
			aria-rowindex={index + 2}
			aria-selected={selected}
			data-row={rowKey}
			data-selected={selected ? "" : undefined}
			className={cn(rowBase, className)}
			style={{ height, transform: `translateY(${top}px)` }}
		>
			<div
				role="gridcell"
				aria-colindex={1}
				data-row={rowKey}
				data-column={SELECT}
				tabIndex={tabCol === SELECT ? 0 : -1}
				className={cn(cellBase, "justify-center")}
				style={{ width: selectWidth }}
			>
				<Checkbox
					aria-label="Select"
					excludeFromTabOrder
					isSelected={selected}
					onChange={() => onToggle(rowKey)}
					className="inline-flex min-h-0"
				/>
			</div>
			{columns.map((c, i) => {
				const extra = cellProps?.(rowKey, c);
				return (
					// biome-ignore lint/a11y/useAriaPropsSupportedByRole: rowheader and gridcell both take aria-colindex
					<div
						key={c.id}
						role={c.isRowHeader ? "rowheader" : "gridcell"}
						aria-colindex={i + 2}
						data-row={rowKey}
						data-column={c.id}
						tabIndex={tabCol === c.id ? 0 : -1}
						{...extra}
						className={cn(
							cellBase,
							"min-w-0 px-2",
							c.numeric && "justify-end text-right tabular-nums",
							extra?.className,
						)}
						style={cellStyle(widths[i] as number, c.grow)}
					>
						{renderCell(rowKey, c)}
					</div>
				);
			})}
		</div>
	);
}) as <C extends DataGridColumn>(props: GridRowProps<C>) => ReactNode;

function ColumnResizer({
	width,
	minWidth,
	onResize,
}: {
	width: number;
	minWidth: number;
	onResize: (width: number) => void;
}) {
	const drag = useRef<{ x: number; width: number } | null>(null);
	const [resizing, setResizing] = useState(false);
	const end = (e: PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		drag.current = null;
		setResizing(false);
		e.currentTarget.releasePointerCapture?.(e.pointerId);
	};
	return (
		<div
			aria-hidden="true"
			data-resizing={resizing ? "" : undefined}
			className={cn(
				"absolute inset-y-0 -right-[3px] z-10 w-[5px] cursor-col-resize touch-none pointer-coarse:-right-2 pointer-coarse:w-4",
				"after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent",
				"hover:after:bg-fc-accent data-resizing:after:inset-y-0 data-resizing:after:bg-fc-accent",
			)}
			onClick={(e) => e.stopPropagation()}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				drag.current = { x: e.clientX, width };
				setResizing(true);
				e.currentTarget.setPointerCapture?.(e.pointerId);
			}}
			onPointerMove={(e) => {
				const start = drag.current;
				if (!start) return;
				onResize(
					Math.max(minWidth, Math.round(start.width + e.clientX - start.x)),
				);
			}}
			onPointerUp={end}
			onPointerCancel={end}
		/>
	);
}

function cellStyle(width: number, grow: number | undefined) {
	return grow ? { width, flexGrow: grow } : { width };
}
