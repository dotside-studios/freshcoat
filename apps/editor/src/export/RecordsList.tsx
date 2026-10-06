import { Button } from "@freshcoat-js/ui/button";
import {
	type DataGridColumn,
	VirtualDataGrid,
} from "@freshcoat-js/ui/data-grid";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { SegmentedControl, SegmentedItem } from "@freshcoat-js/ui/segmented";
import type {
	DataRecord,
	Dataset,
	RecordStatus,
} from "@freshcoat-js/workspace";
import { useCallback, useMemo } from "react";
import { MenuTrigger, type Selection } from "react-aria-components";
import { useController } from "~/app/context";
import { EMPTY } from "~/app/copy";
import ChevronIcon from "~icons/mingcute/down-line";
import {
	bulkStatusAction,
	filterRecords,
	formatTime,
	labelColumn,
	recordLabel,
	SETTABLE_STATUSES,
	STATUS_FILTERS,
	type StatusFilter,
	selectedIds,
} from "./export-ui";

export const STATUS_TONE: Record<RecordStatus, string> = {
	pending: "bg-fc-faint",
	exported: "bg-fc-success",
	failed: "bg-fc-danger",
	skipped: "bg-fc-border-strong",
};

export function StatusBadge({ status }: { status: RecordStatus }) {
	return (
		<span
			className="inline-flex items-center gap-1.5 text-fc-sm"
			data-status={status}
		>
			<span
				aria-hidden
				className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE[status])}
			/>
			<span
				className={status === "failed" ? "text-fc-danger" : "text-fc-muted"}
			>
				{status}
			</span>
		</span>
	);
}

type Row = { record: DataRecord; index: number };

type ColumnId = "index" | "label" | "status" | "exportedAt" | "error";
type ListColumn = DataGridColumn & { id: ColumnId };

const COLUMNS: readonly ListColumn[] = [
	{ id: "index", header: "#", width: 44, numeric: true },
	{ id: "label", header: "Record", width: 120, grow: 2, isRowHeader: true },
	{ id: "status", header: "Status", width: 88 },
	{ id: "exportedAt", header: "Exported", width: 104 },
	{ id: "error", header: "Error", width: 120, grow: 2 },
];

export function RecordsList({
	dataset,
	filter,
	onFilterChange,
	selection,
	onSelectionChange,
	previewId,
	onPreview,
	selectionIsPreset,
}: {
	dataset: Dataset;
	filter: StatusFilter;
	onFilterChange: (filter: StatusFilter) => void;
	selection: string[];
	onSelectionChange: (ids: string[]) => void;
	previewId: string | null;
	onPreview: (id: string) => void;
	/** the selection is the preset's "selected" records */
	selectionIsPreset: boolean;
}) {
	const controller = useController();
	const label = labelColumn(dataset);
	const rows = useMemo(() => {
		const index = new Map(dataset.records.map((r, i) => [r.id, i]));
		return filterRecords(dataset.records, filter).map(
			(record): Row => ({ record, index: index.get(record.id) ?? 0 }),
		);
	}, [dataset.records, filter]);
	const rowById = useMemo(
		() => new Map(rows.map((r) => [r.record.id, r])),
		[rows],
	);
	const rowKeys = useMemo(() => rows.map((r) => r.record.id), [rows]);
	const columns = useMemo(
		() =>
			COLUMNS.map((c) =>
				c.id === "label" && label ? { ...c, header: label } : c,
			),
		[label],
	);
	const renderCell = useCallback(
		(id: string, c: ListColumn) => {
			const row = rowById.get(id);
			return row ? cellContent(c.id, row, label) : null;
		},
		[rowById, label],
	);
	const rowClassName = useCallback(
		(id: string) =>
			id === previewId
				? "shadow-[inset_2px_0_0_var(--color-fc-accent)]"
				: undefined,
		[previewId],
	);
	const counts = useMemo(() => {
		const c: Record<StatusFilter, number> = {
			all: dataset.records.length,
			pending: 0,
			exported: 0,
			failed: 0,
			skipped: 0,
		};
		for (const r of dataset.records) c[r.status]++;
		return c;
	}, [dataset.records]);
	const selectedKeys = useMemo(() => new Set(selection), [selection]);

	const setStatus = (status: RecordStatus) => {
		const action = bulkStatusAction(dataset.id, selection, status);
		if (action) controller.dispatch(action);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="export-records">
			<div className="@container flex min-h-9 shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 border-fc-border border-b px-2 py-1">
				<SegmentedControl
					aria-label="Show records"
					selectedKey={filter}
					onSelectionChange={(key) => onFilterChange(key as StatusFilter)}
				>
					{STATUS_FILTERS.map((f) => (
						<SegmentedItem
							key={f.id}
							id={f.id}
							className="min-w-0 px-2 pointer-coarse:min-w-0 pointer-coarse:px-2"
						>
							{f.label}
							<span className="ml-1 text-fc-faint tabular-nums">
								{counts[f.id]}
							</span>
						</SegmentedItem>
					))}
				</SegmentedControl>
				<span
					className="ml-auto text-fc-muted text-fc-sm tabular-nums @max-[36rem]:hidden"
					data-testid="export-records-selection"
				>
					{selection.length > 0
						? `${selection.length}${selectionIsPreset ? " to export" : " selected"}`
						: selectionIsPreset
							? "Select records to export"
							: ""}
				</span>
				<MenuTrigger>
					<Button
						size="sm"
						isDisabled={selection.length === 0}
						className="@max-[36rem]:ml-auto"
					>
						Set status
						<span className="hidden tabular-nums @max-[36rem]:inline">
							{selection.length > 0 ? `(${selection.length})` : ""}
						</span>
						<ChevronIcon />
					</Button>
					<Popover placement="bottom end">
						<Menu onAction={(key) => setStatus(key as RecordStatus)}>
							{SETTABLE_STATUSES.map((s) => (
								<MenuItem key={s} id={s}>
									{s[0]?.toUpperCase() + s.slice(1)}
								</MenuItem>
							))}
						</Menu>
					</Popover>
				</MenuTrigger>
			</div>
			<VirtualDataGrid
				aria-label={`Records of ${dataset.name}`}
				className="flex-1 min-h-0"
				columns={columns}
				rowKeys={rowKeys}
				renderCell={renderCell}
				rowClassName={rowClassName}
				selectedKeys={selectedKeys}
				onSelectionChange={(keys: Selection) =>
					onSelectionChange(
						selectedIds(
							keys,
							rows.map((r) => r.record),
							dataset.records,
						),
					)
				}
				onRowAction={onPreview}
				renderEmptyState={() => (
					<div className="px-3 py-6 text-center text-fc-faint text-fc-sm">
						{dataset.records.length === 0
							? EMPTY.records
							: `No ${filter} records`}
					</div>
				)}
			/>
		</div>
	);
}

function cellContent(
	column: ColumnId,
	{ record, index }: Row,
	label: string | undefined,
) {
	switch (column) {
		case "index":
			return <span className="truncate">{index + 1}</span>;
		case "label":
			return <span className="truncate">{recordLabel(record, label)}</span>;
		case "status":
			return <StatusBadge status={record.status} />;
		case "exportedAt":
			return <span className="truncate">{formatTime(record.exportedAt)}</span>;
		case "error":
			return record.error ? (
				<span
					className="block min-w-0 truncate text-fc-danger"
					title={record.error}
				>
					{record.error}
				</span>
			) : (
				""
			);
	}
}
