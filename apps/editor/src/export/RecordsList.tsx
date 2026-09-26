import { Button } from "@freshcoat/ui/button";
import {
	DataBody,
	DataCell,
	DataColumn,
	DataRow,
	DataTableHeader,
	VirtualDataTable,
} from "@freshcoat/ui/data-table";
import { cn } from "@freshcoat/ui/lib/cn";
import { Menu, MenuItem } from "@freshcoat/ui/menu";
import { Popover } from "@freshcoat/ui/popover";
import { SegmentedControl, SegmentedItem } from "@freshcoat/ui/segmented";
import type { DataRecord, Dataset, RecordStatus } from "@freshcoat/workspace";
import { useMemo } from "react";
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

const COLUMNS = [
	{ id: "index", name: "#", width: 44 },
	{ id: "label", name: "Record", width: "2fr" },
	{ id: "status", name: "Status", width: 88 },
	{ id: "exportedAt", name: "Exported", width: 104 },
	{ id: "error", name: "Error", width: "2fr" },
] as const;

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
			<VirtualDataTable
				aria-label={`Records of ${dataset.name}`}
				containerClassName="flex-1 min-h-0"
				selectionMode="multiple"
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
				onRowAction={(key) => onPreview(String(key))}
			>
				<DataTableHeader columns={COLUMNS}>
					{(c) => (
						<DataColumn
							id={c.id}
							isRowHeader={c.id === "label"}
							numeric={c.id === "index"}
							defaultWidth={c.width}
							minWidth={40}
						>
							{c.id === "label" && label ? label : c.name}
						</DataColumn>
					)}
				</DataTableHeader>
				<DataBody
					items={rows}
					dependencies={[rows, label, previewId]}
					renderEmptyState={() => (
						<div className="px-3 py-6 text-center text-fc-faint text-fc-sm">
							{dataset.records.length === 0
								? EMPTY.records
								: `No ${filter} records`}
						</div>
					)}
				>
					{(row) => (
						<DataRow
							id={row.record.id}
							columns={COLUMNS}
							dependencies={[row, label, previewId]}
							className={cn(
								row.record.id === previewId &&
									"shadow-[inset_2px_0_0_var(--color-fc-accent)]",
							)}
						>
							{(c) => (
								<DataCell numeric={c.id === "index"}>
									{cellContent(c.id, row, label)}
								</DataCell>
							)}
						</DataRow>
					)}
				</DataBody>
			</VirtualDataTable>
		</div>
	);
}

function cellContent(
	column: (typeof COLUMNS)[number]["id"],
	{ record, index }: Row,
	label: string | undefined,
) {
	switch (column) {
		case "index":
			return String(index + 1);
		case "label":
			return recordLabel(record, label);
		case "status":
			return <StatusBadge status={record.status} />;
		case "exportedAt":
			return formatTime(record.exportedAt);
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
