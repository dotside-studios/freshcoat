import {
	fitDesignSize,
	resizeTemplate,
	type Template,
} from "@freshcoat-js/coatfile";
import type {
	DataRecord,
	Dataset,
	ExportDestination,
	ExportItem,
	ExportPreset,
	RecordStatus,
	Workspace,
} from "@freshcoat-js/workspace";
import {
	exportSize,
	fileExtension,
	fileNameFor,
	orientedSize,
	parseAssetRef,
} from "@freshcoat-js/workspace";
import type { JobResult } from "@freshcoat-js/workspace/export";
import { plural, STATUS_LABEL } from "~/app/copy";
import { formatDate } from "~/app/format";
import type { Action } from "~/state/store";

export const RECORD_FILTERS: { id: ExportPreset["records"]; label: string }[] =
	[
		{ id: "all", label: "All but skipped" },
		{ id: "pending", label: "Pending" },
		{ id: "failed", label: "Failed" },
		{ id: "selected", label: "Saved selection" },
	];

export const FORMAT_LABEL: Record<ExportPreset["format"], string> = {
	"png-zip": "PNG zip",
	"jpeg-zip": "JPEG zip",
	"webp-zip": "WebP zip",
	pdf: "PDF",
};

export const DESTINATION_LABEL: Record<ExportDestination, string> = {
	download: "Download",
	"zip-file": "Zip file",
	folder: "Folder",
};

export type StatusFilter = "all" | RecordStatus;

export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "pending", label: STATUS_LABEL.pending },
	{ id: "failed", label: STATUS_LABEL.failed },
	{ id: "exported", label: STATUS_LABEL.exported },
	{ id: "skipped", label: STATUS_LABEL.skipped },
];

export const SETTABLE_STATUSES: RecordStatus[] = [
	"pending",
	"exported",
	"skipped",
];

/** What the preset's first file will be called. With nothing planned, the
 *  pattern is shown against the template's first side. */
export function fileNameExample(
	plan: readonly ExportItem[],
	preset: ExportPreset,
	template: Template | undefined,
): string {
	const first = plan[0];
	if (first) return first.fileName;
	const base = fileNameFor(preset.fileName, {
		template: template?.id ?? "template",
		side: template?.template_data[0]?.name ?? "front",
		index: 1,
		count: 1,
		record: "",
	});
	const suffix =
		preset.scale === 1 || exportSize(preset).kind === "image"
			? ""
			: `@${preset.scale}x`;
	return `${base}${suffix}.${fileExtension(preset.format)}`;
}

/** The template laid out at the aspect of the photo a size-from-image preset
 *  follows for this item, as the export will render it; the template itself
 *  otherwise. */
export function photoSizedTemplate(
	template: Template,
	preset: ExportPreset,
	item: { values: Record<string, string> } | null,
	dataset: Dataset | undefined,
): Template {
	const size = exportSize(preset);
	if (size.kind !== "image" || !item || !dataset) return template;
	const sha = parseAssetRef(item.values[size.field]);
	const asset = sha ? dataset.assets.find((a) => a.sha256 === sha) : undefined;
	if (!asset?.width || !asset.height) return template;
	const seen = orientedSize({
		width: asset.width,
		height: asset.height,
		orientation: asset.orientation,
	});
	const design = fitDesignSize(template, seen.width, seen.height);
	if (
		Math.abs(design.width - template.width) < 0.5 &&
		Math.abs(design.height - template.height) < 0.5
	)
		return template;
	// A template's size is whole design units, and most photo aspects are not.
	return resizeTemplate(
		template,
		Math.max(1, Math.round(design.width)),
		Math.max(1, Math.round(design.height)),
	);
}

/** The template's image fields, which a size can follow. */
export function imageFieldKeys(template: Template | undefined): string[] {
	return Object.entries(template?.fields.properties ?? {})
		.filter(([, field]) => field.format === "image")
		.map(([key]) => key);
}

/** A PDF page's physical size: template pixels are dots at the DPI. */
export function pageSize(
	template: { width: number; height: number },
	dpi: number,
): { inches: [number, number]; mm: [number, number] } {
	const w = template.width / dpi;
	const h = template.height / dpi;
	return { inches: [w, h], mm: [w * 25.4, h * 25.4] };
}

export function formatPageSize(
	template: { width: number; height: number },
	dpi: number,
): string {
	if (!(dpi > 0)) return "";
	const { inches, mm } = pageSize(template, dpi);
	return `${inches[0].toFixed(2)} × ${inches[1].toFixed(2)} in · ${mm[0].toFixed(1)} × ${mm[1].toFixed(1)} mm`;
}

export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	const s = ms / 1000;
	if (s < 10) return `${s.toFixed(1)} s`;
	if (s < 60) return `${Math.round(s)} s`;
	const m = Math.floor(s / 60);
	const rest = Math.round(s - m * 60);
	return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
}

export function formatEta(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "";
	return `~${formatDuration(Math.max(1000, ms))} left`;
}

/** Items per second: one decimal below ten. */
export function formatRate(perSecond: number): string {
	if (!Number.isFinite(perSecond) || perSecond < 0) return "";
	return perSecond < 10 ? perSecond.toFixed(1) : String(Math.round(perSecond));
}

/** How a run over chosen records is named in the job bar and its history. */
export function selectedRunLabel(count: number): string {
	return plural(count, "selected record");
}

/** The column a record is known by in a list: the first text one. */
export function labelColumn(dataset: Dataset | undefined): string | undefined {
	return (
		dataset?.columns.find((c) => c.type === "text")?.key ??
		dataset?.columns[0]?.key
	);
}

export function recordLabel(
	record: DataRecord,
	column: string | undefined,
): string {
	const v = column ? record.values[column] : undefined;
	return v === null || v === undefined || v === "" ? record.id : String(v);
}

export function filterRecords(
	records: readonly DataRecord[],
	filter: StatusFilter,
): DataRecord[] {
	return filter === "all"
		? [...records]
		: records.filter((r) => r.status === filter);
}

/** The ids a list selection names. "all" is every row the list shows; a set
 *  keeps ids the current filter hides, in dataset order. */
export function selectedIds(
	selection: "all" | Iterable<string | number>,
	visible: readonly DataRecord[],
	records: readonly DataRecord[] = visible,
): string[] {
	if (selection === "all") return visible.map((r) => r.id);
	const wanted = new Set([...selection].map(String));
	return records.filter((r) => wanted.has(r.id)).map((r) => r.id);
}

/** The store action that sets a selection's status, or null for nothing. */
export function bulkStatusAction(
	datasetId: string,
	ids: readonly string[],
	status: RecordStatus,
): Action | null {
	if (ids.length === 0) return null;
	return { type: "setRecordStatus", datasetId, ids: [...ids], status };
}

/** The presets whose template reads from a dataset, which are the ones that
 *  can export its records. */
export function presetsForDataset(
	templates: readonly { id: string; binding?: { datasetId: string } }[],
	presets: readonly ExportPreset[],
	datasetId: string,
): ExportPreset[] {
	const bound = new Set(
		templates
			.filter((t) => t.binding?.datasetId === datasetId)
			.map((t) => t.id),
	);
	return presets.filter((p) => bound.has(p.templateId));
}

/** The dataset a preset's template reads from, if it is bound to one that exists. */
export function boundDataset(
	workspace: Workspace | null,
	preset: ExportPreset | undefined,
): Dataset | undefined {
	if (!workspace || !preset) return undefined;
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	const id = entry?.binding?.datasetId;
	return id ? workspace.datasets.find((d) => d.id === id) : undefined;
}

export type RecordOutcome = {
	ok: string[];
	failed: string[];
	errors: Record<string, string>;
};

/** Per record: exported when every side rendered, failed with the first
 *  error otherwise. Items with no record (an unbound template) are ignored. */
export function recordOutcome(result: JobResult): RecordOutcome {
	const errors: Record<string, string> = {};
	const seen: string[] = [];
	const bad = new Set<string>();
	for (const item of result.items) {
		if (!item.recordId) continue;
		if (!seen.includes(item.recordId)) seen.push(item.recordId);
		if (!item.ok) {
			bad.add(item.recordId);
			errors[item.recordId] ??= item.error ?? "Failed";
		}
	}
	return {
		ok: seen.filter((id) => !bad.has(id)),
		failed: seen.filter((id) => bad.has(id)),
		errors,
	};
}

/** What a finished job writes back to the dataset when the preset marks
 *  exports: `exported` with the time for records that rendered, `failed`
 *  with the error for the rest. Nothing for a cancelled job. */
export function statusActions(
	result: JobResult,
	datasetId: string | undefined,
	now: Date = new Date(),
): Action[] {
	if (!datasetId || result.cancelled) return [];
	const { ok, failed, errors } = recordOutcome(result);
	const actions: Action[] = [];
	if (ok.length > 0)
		actions.push({
			type: "setRecordStatus",
			datasetId,
			ids: ok,
			status: "exported",
			exportedAt: now.toISOString(),
		});
	if (failed.length > 0)
		actions.push({
			type: "setRecordStatus",
			datasetId,
			ids: failed,
			status: "failed",
			errors,
		});
	return actions;
}

/** The preset a "Retry failed" runs. Failed records are found by status when
 *  the preset writes statuses, and by the last result's ids when it does not
 *  or when the run was over chosen records, so a retry stays inside them. */
export function retryPreset(
	preset: ExportPreset,
	result: JobResult,
): ExportPreset {
	if (preset.markExported && preset.records !== "selected") {
		const { selected: _s, ...rest } = preset;
		return { ...rest, records: "failed" };
	}
	return {
		...preset,
		records: "selected",
		selected: recordOutcome(result).failed,
	};
}

export function formatTime(iso: string | number | undefined): string {
	if (iso === undefined || iso === "") return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const today = new Date();
	const sameDay = d.toDateString() === today.toDateString();
	return sameDay
		? formatDate(d, { hour: "2-digit", minute: "2-digit" })
		: formatDate(d, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
}
