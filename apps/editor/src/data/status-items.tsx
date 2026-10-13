import { cellIssue, issueCount } from "@freshcoat-js/workspace/dataset";
import { useMemo } from "react";
import { plural } from "~/app/copy";
import { formatBytes, formatNumber } from "~/app/format";
import { STATUS_PRIORITY } from "~/app/status/priority";
import type { StatusItem } from "~/app/status/types";
import { useEditor } from "~/state/hooks";
import type { EditorState } from "~/state/store";
import { photoBytes } from "./gallery-model";
import { useGridUi } from "./grid-state";
import { selectActiveDataset, useDataView } from "./status-state";

function DatasetName() {
	const name = useEditor((s) => selectActiveDataset(s)?.name);
	return name === undefined ? null : (
		<span className="min-w-0 truncate font-medium text-fc-text">{name}</span>
	);
}

function RecordCount() {
	const total = useEditor((s) => selectActiveDataset(s)?.records.length ?? 0);
	const view = useDataView();
	const shown = view?.shown ?? total;
	return (
		<span data-testid="data-status-records">
			{shown !== total ? `${formatNumber(shown)} of ` : ""}
			{plural(total, "record")}
		</span>
	);
}

function SelectedCount() {
	const selected = useDataView()?.selected ?? 0;
	return selected ? (
		<span className="text-fc-text" data-testid="data-status-selected">
			{formatNumber(selected)} selected
		</span>
	) : null;
}

function IssueCount() {
	const dataset = useEditor(selectActiveDataset);
	const issues = useMemo(() => (dataset ? issueCount(dataset) : 0), [dataset]);
	return (
		<span className={issues ? "text-fc-danger-text" : undefined}>
			{plural(issues, "issue")}
		</span>
	);
}

function ColumnCount() {
	const columns = useEditor((s) => selectActiveDataset(s)?.columns.length ?? 0);
	return (
		<span className="@max-[40rem]:hidden">{plural(columns, "column")}</span>
	);
}

function PhotoSummary() {
	const dataset = useEditor(selectActiveDataset);
	const bytes = useMemo(() => (dataset ? photoBytes(dataset) : 0), [dataset]);
	const photos = dataset?.assets.length ?? 0;
	return photos ? (
		<span data-testid="data-status-photos" className="@max-[32rem]:hidden">
			{plural(photos, "photo")}, {formatBytes(bytes)}
		</span>
	) : null;
}

function CellIssue() {
	const view = useDataView();
	if (!view) return null;
	return <ActiveCellIssue ui={view.ui} />;
}

function ActiveCellIssue({
	ui,
}: {
	ui: NonNullable<ReturnType<typeof useDataView>>["ui"];
}) {
	const dataset = useEditor(selectActiveDataset);
	const active = useGridUi(ui, (s) => s.active);
	const record = active
		? dataset?.records.find((r) => r.id === active.row)
		: undefined;
	const issue =
		dataset && record && active
			? cellIssue(dataset, record, active.col)
			: undefined;
	return issue && active ? (
		<span className="min-w-0 truncate text-fc-danger-text @max-[48rem]:hidden">
			{active.col}: {issue}
		</span>
	) : null;
}

const hasDataset = (s: EditorState) => !!selectActiveDataset(s);

const item = (
	id: string,
	name: string,
	priority: number,
	component: StatusItem["component"],
): StatusItem => ({
	id,
	name,
	sections: ["data"],
	align: "start",
	priority,
	when: hasDataset,
	component,
});

export const DATA_STATUS_ITEMS: readonly StatusItem[] = [
	item("dataset", "Dataset name", STATUS_PRIORITY.dataset, DatasetName),
	item("records", "Record count", STATUS_PRIORITY.records, RecordCount),
	item("selected", "Selected records", STATUS_PRIORITY.selected, SelectedCount),
	item("data-issues", "Dataset issues", STATUS_PRIORITY.dataIssues, IssueCount),
	item("columns", "Column count", STATUS_PRIORITY.columns, ColumnCount),
	item("photos", "Photos", STATUS_PRIORITY.photos, PhotoSummary),
	item(
		"cell-issue",
		"Focused cell issue",
		STATUS_PRIORITY.cellIssue,
		CellIssue,
	),
];
