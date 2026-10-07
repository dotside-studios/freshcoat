import {
	Children,
	createContext,
	isValidElement,
	type ReactNode,
	useContext,
	useMemo,
	useSyncExternalStore,
} from "react";
import {
	Button,
	Collection,
	ColumnResizer,
	type ColumnResizerProps,
	Cell as RACCell,
	type CellProps as RACCellProps,
	Column as RACColumn,
	type ColumnProps as RACColumnProps,
	Row as RACRow,
	type RowProps as RACRowProps,
	Table as RACTable,
	TableBody as RACTableBody,
	type TableBodyProps as RACTableBodyProps,
	TableHeader as RACTableHeader,
	type TableHeaderProps as RACTableHeaderProps,
	type TableProps as RACTableProps,
	ResizableTableContainer,
	type ResizableTableContainerProps,
	TableColumnResizeStateContext,
	TableLayout,
	useTableOptions,
	Virtualizer,
} from "react-aria-components";
import { Checkbox } from "./checkbox";
import { ChevronDownIcon, GripIcon } from "./icons";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";

// ------------------------------------------------------------------ context

interface DataTableContextValue {
	/** Rows and cells are absolutely positioned divs, not table elements. */
	virtualized: boolean;
	/** The table sits in a `ResizableTableContainer`. */
	resizable: boolean;
	/** Add a checkbox column when selection uses the toggle behaviour. */
	checkboxes: boolean;
	coarse: boolean;
}

const DataTableContext = createContext<DataTableContextValue>({
	virtualized: false,
	resizable: false,
	checkboxes: true,
	coarse: false,
});

const COARSE_QUERY = "(pointer: coarse)";

const coarseQuery =
	typeof window !== "undefined" && window.matchMedia
		? window.matchMedia(COARSE_QUERY)
		: null;

function subscribeCoarse(onChange: () => void) {
	if (!coarseQuery) return () => {};
	coarseQuery.addEventListener("change", onChange);
	return () => coarseQuery.removeEventListener("change", onChange);
}

function readCoarse() {
	return !!coarseQuery?.matches;
}

/** True on touch-first devices, tracking `(pointer: coarse)`. */
export function useCoarsePointer(): boolean {
	return useSyncExternalStore(subscribeCoarse, readCoarse, () => false);
}

/** Width of the checkbox and drag-handle columns. */
function utilityColumnWidth(coarse: boolean) {
	return coarse ? 36 : 28;
}

// -------------------------------------------------------------------- table

/** True inside `DataTableContainer`. */
const InResizableContainer = createContext(false);

export interface DataTableProps extends RACTableProps {
	/**
	 * Add a leading checkbox column when `selectionMode` is set and the
	 * selection behaviour is `toggle`. Defaults to true.
	 */
	checkboxSelection?: boolean;
}

export function DataTable({
	className,
	checkboxSelection = true,
	...props
}: DataTableProps) {
	const parent = useContext(DataTableContext);
	const coarse = useCoarsePointer();
	const resizable = useContext(InResizableContainer);
	const ctx = useMemo(
		() => ({
			...parent,
			resizable: parent.resizable || resizable,
			checkboxes: checkboxSelection,
			coarse,
		}),
		[parent, resizable, checkboxSelection, coarse],
	);
	return (
		<DataTableContext.Provider value={ctx}>
			<RACTable
				{...props}
				className={composeTw(
					className,
					"relative bg-fc-panel text-fc-base text-fc-text outline-none",
					!ctx.virtualized && "w-full border-separate border-spacing-0",
					"data-drop-target:shadow-[inset_0_0_0_1px_var(--color-fc-accent)] data-focus-visible:outline-1 data-focus-visible:outline-solid data-focus-visible:outline-fc-accent data-focus-visible:-outline-offset-1",
				)}
			/>
		</DataTableContext.Provider>
	);
}

export interface DataTableContainerProps extends ResizableTableContainerProps {}

/**
 * `ResizableTableContainer` for a non-virtual `DataTable`: enables column
 * widths and `ColumnResizer`, and is the scroll container.
 */
export function DataTableContainer({
	className,
	...props
}: DataTableContainerProps) {
	return (
		<InResizableContainer.Provider value={true}>
			<ResizableTableContainer
				{...props}
				className={cn("relative min-h-0 overflow-auto bg-fc-panel", className)}
			/>
		</InResizableContainer.Provider>
	);
}

// ------------------------------------------------------------------- header

export interface DataTableHeaderProps<T extends object>
	extends RACTableHeaderProps<T> {}

export function DataTableHeader<T extends object>({
	columns,
	children,
	className,
	dependencies,
	...props
}: DataTableHeaderProps<T>) {
	const { selectionBehavior, selectionMode, allowsDragging } =
		useTableOptions();
	const { checkboxes } = useContext(DataTableContext);
	return (
		<RACTableHeader
			{...props}
			className={composeTw(
				className,
				"sticky top-0 z-10 bg-fc-raised text-fc-muted",
			)}
		>
			{allowsDragging && <UtilityColumn />}
			{checkboxes && selectionBehavior === "toggle" && (
				<DataCheckboxColumn>
					{selectionMode === "multiple" ? undefined : null}
				</DataCheckboxColumn>
			)}
			<Collection items={columns} dependencies={dependencies}>
				{children}
			</Collection>
		</RACTableHeader>
	);
}

/**
 * Vertical hairlines sit on each cell's left edge so the outer border is never
 * doubled. Virtualized cells are each wrapped in a positioned div, so the first
 * column is found by `aria-colindex` rather than `:first-child`.
 */
function gridLines(virtualized: boolean) {
	return virtualized
		? "size-full border-fc-border border-b border-l pointer-coarse:h-full [&[aria-colindex='1']]:border-l-0"
		: "border-fc-border border-b border-l first:border-l-0";
}

const headerCell =
	"group/col relative h-[26px] cursor-default select-none bg-fc-raised p-0 text-left align-middle font-medium text-fc-sm text-fc-muted outline-none pointer-coarse:h-8 " +
	"data-hovered:text-fc-text data-pressed:bg-fc-hover data-[sort-direction]:text-fc-text data-focus-visible:outline-1 data-focus-visible:outline-solid data-focus-visible:outline-fc-accent data-focus-visible:-outline-offset-1";

function UtilityColumn({ children }: { children?: ReactNode }) {
	const { resizable, coarse, virtualized } = useContext(DataTableContext);
	const w = utilityColumnWidth(coarse);
	return (
		<RACColumn
			{...(resizable ? { width: w, minWidth: w, maxWidth: w } : {})}
			className={cn(
				headerCell,
				gridLines(virtualized),
				"px-0",
				!resizable && "w-7 pointer-coarse:w-9",
			)}
		>
			<div className="flex h-full items-center justify-center">{children}</div>
		</RACColumn>
	);
}

export interface DataCheckboxColumnProps {
	/** Omit for the select-all checkbox; `null` leaves the header empty. */
	children?: ReactNode;
}

/** Header cell above `DataCheckboxCell`; holds the select-all checkbox. */
export function DataCheckboxColumn({ children }: DataCheckboxColumnProps) {
	return (
		<UtilityColumn>
			{children === undefined ? (
				<Checkbox slot="selection" className="min-h-0" />
			) : (
				children
			)}
		</UtilityColumn>
	);
}

export interface DataColumnProps extends Omit<RACColumnProps, "children"> {
	children?: ReactNode;
	/** Right-align the heading to sit over numeric cells. */
	numeric?: boolean;
	/** Show a resize handle when the table is resizable. Defaults to true. */
	allowsResizing?: boolean;
}

export function DataColumn({
	children,
	numeric,
	allowsResizing = true,
	className,
	...props
}: DataColumnProps) {
	const { virtualized } = useContext(DataTableContext);
	return (
		<RACColumn
			{...props}
			className={composeTw(className, headerCell, gridLines(virtualized))}
		>
			{({ allowsSorting, sortDirection }) => (
				<>
					<div
						className={cn(
							"flex h-full min-w-0 items-center gap-1 px-2",
							numeric && "flex-row-reverse",
						)}
					>
						<span className="min-w-0 truncate">{children}</span>
						{allowsSorting && (
							<ChevronDownIcon
								aria-hidden
								className={cn(
									"size-3 shrink-0 transition-transform duration-100",
									sortDirection === "ascending" && "rotate-180",
									!sortDirection &&
										"opacity-0 group-data-hovered/col:opacity-50",
								)}
							/>
						)}
					</div>
					{allowsResizing && <DataColumnResizer />}
				</>
			)}
		</RACColumn>
	);
}

/** A column's resize handle. Renders nothing outside a resizable table. */
export function DataColumnResizer({ className, ...props }: ColumnResizerProps) {
	const layout = useContext(TableColumnResizeStateContext);
	if (!layout) return null;
	return (
		<ColumnResizer
			{...props}
			className={composeTw(
				className,
				"absolute inset-y-0 -right-[3px] z-10 w-[5px] cursor-col-resize touch-none outline-none pointer-coarse:-right-2 pointer-coarse:w-4",
				"after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent",
				"data-hovered:after:bg-fc-accent data-resizing:after:inset-y-0 data-resizing:after:bg-fc-accent data-focus-visible:after:bg-fc-accent data-focus-visible:outline-none",
				"data-[resizable-direction=left]:cursor-e-resize data-[resizable-direction=right]:cursor-w-resize",
			)}
		/>
	);
}

// --------------------------------------------------------------------- body

export interface DataBodyProps<T extends object> extends RACTableBodyProps<T> {}

export function DataBody<T extends object>({
	className,
	renderEmptyState,
	...props
}: DataBodyProps<T>) {
	return (
		<RACTableBody
			{...props}
			renderEmptyState={
				renderEmptyState ??
				(() => (
					<div className="px-3 py-6 text-center text-fc-faint text-fc-sm">
						Nothing to show
					</div>
				))
			}
			className={composeTw(
				className,
				"outline-none data-drop-target:bg-fc-accent-soft/40",
			)}
		/>
	);
}

export interface DataRowProps<T extends object> extends RACRowProps<T> {}

export const dataRow =
	"group/row relative h-fc-control cursor-default text-fc-text outline-none " +
	"data-hovered:not-data-selected:bg-fc-raised data-selected:bg-fc-accent-soft data-disabled:text-fc-faint " +
	"data-dragging:opacity-40 data-drop-target:bg-fc-accent-soft data-drop-target:shadow-[inset_0_0_0_1px_var(--color-fc-accent)] " +
	"data-focus-visible:outline-1 data-focus-visible:outline-solid data-focus-visible:outline-fc-accent data-focus-visible:-outline-offset-1";

export function DataRow<T extends object>({
	columns,
	children,
	className,
	dependencies,
	...props
}: DataRowProps<T>) {
	const { selectionBehavior, allowsDragging } = useTableOptions();
	const { checkboxes, virtualized } = useContext(DataTableContext);
	return (
		<RACRow
			{...props}
			className={composeTw(className, dataRow, virtualized && "h-full")}
		>
			{allowsDragging && (
				<DataCell className="px-0">
					<Button
						slot="drag"
						aria-label="Drag"
						className="mx-auto flex size-5 cursor-grab items-center justify-center rounded-[2px] text-fc-faint outline-none data-hovered:text-fc-text data-focus-visible:outline-1 data-focus-visible:outline-solid data-focus-visible:outline-fc-accent pointer-coarse:size-7"
					>
						<GripIcon className="size-3.5" />
					</Button>
				</DataCell>
			)}
			{checkboxes && selectionBehavior === "toggle" && <DataCheckboxCell />}
			<Collection items={columns} dependencies={dependencies}>
				{children}
			</Collection>
		</RACRow>
	);
}

export interface DataCellProps extends Omit<RACCellProps, "children"> {
	children?: RACCellProps["children"];
	/** Right-aligned tabular figures. */
	numeric?: boolean;
}

export const dataCell =
	"overflow-hidden p-0 px-2 text-fc-base outline-none " +
	"data-focus-visible:outline-1 data-focus-visible:outline-solid data-focus-visible:outline-fc-accent data-focus-visible:-outline-offset-1";

function wrapText(node: ReactNode): ReactNode {
	const parts = Children.toArray(node);
	if (parts.length > 0 && parts.every((p) => !isValidElement(p))) {
		return <span className="block min-w-0 truncate">{node}</span>;
	}
	return node;
}

export function DataCell({
	numeric,
	className,
	children,
	...props
}: DataCellProps) {
	const { virtualized } = useContext(DataTableContext);
	return (
		<RACCell
			{...props}
			className={composeTw(
				className,
				dataCell,
				gridLines(virtualized),
				virtualized
					? "flex items-center"
					: "whitespace-nowrap text-ellipsis align-middle",
				numeric && "justify-end text-right tabular-nums",
			)}
		>
			{typeof children === "function"
				? (state) => wrapText(children(state))
				: wrapText(children)}
		</RACCell>
	);
}

/** Row selection checkbox; `DataRow` adds one automatically. */
export function DataCheckboxCell({ className }: { className?: string }) {
	return (
		<DataCell className={cn("justify-center px-0 text-center", className)}>
			<Checkbox slot="selection" className="inline-flex min-h-0 align-middle" />
		</DataCell>
	);
}

// ------------------------------------------------------------------ virtual

export interface VirtualDataTableProps extends DataTableProps {
	/** Classes for the outer box. Give it a height (or flex-1 in a column). */
	containerClassName?: string;
	/** Row height in px. Defaults to 24, or 32 on coarse pointers. */
	rowHeight?: number;
	/** Header height in px. Defaults to 26, or 32 on coarse pointers. */
	headingHeight?: number;
	onResizeStart?: ResizableTableContainerProps["onResizeStart"];
	onResize?: ResizableTableContainerProps["onResize"];
	onResizeEnd?: ResizableTableContainerProps["onResizeEnd"];
}

/**
 * A `DataTable` in a `ResizableTableContainer` and a `Virtualizer` with a
 * `TableLayout`: only the visible rows are mounted, columns are resizable, and
 * the table element is the scroll container.
 */
export function VirtualDataTable({
	containerClassName,
	rowHeight,
	headingHeight,
	onResizeStart,
	onResize,
	onResizeEnd,
	className,
	...props
}: VirtualDataTableProps) {
	const coarse = useCoarsePointer();
	const layoutOptions = useMemo(
		() => ({
			rowHeight: rowHeight ?? (coarse ? 32 : 24),
			headingHeight: headingHeight ?? (coarse ? 32 : 26),
		}),
		[rowHeight, headingHeight, coarse],
	);
	const ctx = useMemo(
		() => ({ virtualized: true, resizable: true, checkboxes: true, coarse }),
		[coarse],
	);
	return (
		<DataTableContext.Provider value={ctx}>
			<ResizableTableContainer
				onResizeStart={onResizeStart}
				onResize={onResize}
				onResizeEnd={onResizeEnd}
				className={cn(
					"relative flex min-h-0 flex-col overflow-hidden bg-fc-panel",
					containerClassName,
				)}
			>
				<Virtualizer layout={TableLayout} layoutOptions={layoutOptions}>
					<DataTable
						{...props}
						className={composeTw(
							className,
							"min-h-0 w-full flex-1 overflow-auto overscroll-contain",
						)}
					/>
				</Virtualizer>
			</ResizableTableContainer>
		</DataTableContext.Provider>
	);
}
