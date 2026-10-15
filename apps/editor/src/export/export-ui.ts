import { cardSizeMm, type Template } from "@freshcoat-js/coatfile";
import type {
	CutKind,
	DataRecord,
	Dataset,
	ExportDestination,
	ExportItem,
	ExportPreset,
	RecordStatus,
} from "@freshcoat-js/workspace";
import {
	CUT_KINDS,
	DEFAULT_QUALITY,
	exportSize,
	exportSplit,
	fileExtension,
	fileNameFor,
	fileNameTokens,
	pdfLayout,
} from "@freshcoat-js/workspace";
import { type JobResult, recordOutcome } from "@freshcoat-js/workspace/export";
import { plural, STATUS_LABEL } from "~/app/copy";
import { formatDate } from "~/app/format";
import type { Action } from "~/state/store";
import { PAPER_LABEL, paperChoice } from "./sheets";

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

const FORMAT_NAME: Record<ExportPreset["format"], string> = {
	"png-zip": "PNG",
	"jpeg-zip": "JPEG",
	"webp-zip": "WebP",
	pdf: "PDF",
};

export function settingsSummary(preset: ExportPreset): string {
	const pdf = preset.format === "pdf";
	const size = exportSize(preset);
	const parts = [
		FORMAT_NAME[preset.format],
		size.kind === "image" ? "Match image" : `${preset.scale}×`,
	];
	if (pdf) parts.push(`${preset.dpi} DPI`);
	if (pdf && pdfLayout(preset).kind === "sheet") parts.push("Sheets");
	if (exportSplit(preset) === "pieces") parts.push("Pieces");
	if (preset.print?.enabled) parts.push("Card printer");
	parts.push(
		pdf ? "Download" : DESTINATION_LABEL[preset.destination ?? "download"],
	);
	return parts.join(" · ");
}

export function formatSummary(preset: ExportPreset): string {
	if (preset.format === "pdf")
		return [
			"PDF",
			preset.pdfPageImage === "vector" ? "vector" : null,
			`${preset.dpi} dpi`,
		]
			.filter(Boolean)
			.join(" · ");
	const lossy = preset.format !== "png-zip";
	return [
		FORMAT_NAME[preset.format],
		lossy ? `${preset.quality ?? DEFAULT_QUALITY}%` : null,
	]
		.filter(Boolean)
		.join(" · ");
}

export function sizeSummary(
	preset: ExportPreset,
	outputSize?: { width: number; height: number } | null,
): string {
	const image = exportSize(preset).kind === "image";
	const parts = [
		image
			? "Match image"
			: outputSize
				? `${outputSize.width} × ${outputSize.height} px`
				: `${preset.scale}×`,
	];
	if (preset.bleed && !image) parts.push("bleed");
	return parts.join(" · ");
}

export function printSummary(preset: ExportPreset): string {
	const parts: string[] = [];
	if (preset.format === "pdf") {
		const layout = pdfLayout(preset);
		if (layout.kind === "sheet") {
			parts.push(`Sheets · ${PAPER_LABEL[paperChoice(layout)]}`);
			if (layout.cropMarks) parts.push("crop marks");
			if (layout.duplex !== "none") parts.push("double-sided");
		} else parts.push("One per page");
	}
	if (preset.print?.enabled) parts.push("card printer");
	return parts.length > 0 ? parts.join(" · ") : "Off";
}

export function filesSummary(preset: ExportPreset): string {
	const where =
		preset.format === "pdf"
			? "Download"
			: DESTINATION_LABEL[preset.destination ?? "download"];
	return `${where} · ${preset.fileName}`;
}

/** What an export will produce, from the plan alone: "120 records · PDF ·
 *  1 file", "240 files · PNG zip". Sizes are left out, as nothing before
 *  the render says them. */
export function exportEstimate(
	preset: ExportPreset,
	plan: readonly ExportItem[],
	sheets?: number,
): string {
	if (preset.format === "pdf") {
		const records = new Set(plan.map((item) => item.recordId)).size;
		return [
			plural(records, "record"),
			"PDF",
			sheets ? plural(sheets, "sheet") : "1 file",
		].join(" · ");
	}
	const where = preset.destination === "folder" ? "in a folder" : "";
	const label =
		preset.destination === "folder"
			? FORMAT_NAME[preset.format]
			: FORMAT_LABEL[preset.format];
	return [plural(plan.length, "file"), `${label} ${where}`.trim()].join(" · ");
}

/** How many records a preset exports from its template's dataset, or null
 *  when the template is not bound. */
export function presetRecordCount(
	preset: ExportPreset,
	templates: readonly { id: string; binding?: { datasetId: string } }[],
	datasets: readonly Dataset[],
): number | null {
	const bound = templates.find((t) => t.id === preset.templateId)?.binding;
	const dataset = datasets.find((d) => d.id === bound?.datasetId);
	if (!dataset) return null;
	const wanted = new Set(preset.selected ?? []);
	return dataset.records.filter((r) => {
		switch (preset.records) {
			case "all":
				return r.status !== "skipped";
			case "selected":
				return wanted.has(r.id);
			default:
				return r.status === preset.records;
		}
	}).length;
}

export function presetLine(
	preset: ExportPreset,
	records: number | null,
): string {
	const pdf = preset.format === "pdf";
	return [
		FORMAT_NAME[preset.format],
		pdf ? `${preset.dpi} dpi` : `${preset.scale}×`,
		records === null ? "not bound" : plural(records, "record"),
	].join(" · ");
}

/** The tokens a file name pattern may name, in the groups the insert menu
 *  shows. */
export function fileNameTokenGroups(
	template: Pick<Template, "fields">,
	dataset?: Pick<Dataset, "columns">,
): { title: string; tokens: string[] }[] {
	const fields = Object.keys(template.fields.properties);
	const columns = (dataset?.columns.map((c) => c.key) ?? []).filter(
		(key) => !fields.includes(key),
	);
	const known = new Set([...fields, ...columns]);
	return [
		{
			title: "Built in",
			tokens: fileNameTokens(template, dataset).filter((t) => !known.has(t)),
		},
		{ title: "Fields", tokens: fields },
		{ title: "Columns", tokens: columns },
	].filter((group) => group.tokens.length > 0);
}

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

/** What a template's slices offer an export: pieces to split into, and, when
 *  one has an edge, cut files and cut lines. Slices sit on top-level layers. */
export function sliceUse(template: Template | undefined): {
	slices: boolean;
	cuts: boolean;
	edges: CutKind[];
} {
	let slices = false;
	const used = new Set<string>();
	for (const side of template?.template_data ?? [])
		for (const el of side.elements) {
			const slice = (el.properties as { slice?: { edge?: string } } | undefined)
				?.slice;
			if (!slice) continue;
			slices = true;
			if (slice.edge !== undefined) used.add(slice.edge);
		}
	const edges = CUT_KINDS.filter((kind) => used.has(kind));
	return { slices, cuts: edges.length > 0, edges };
}

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

/** A PDF page's physical size: template pixels are dots at the DPI. */
export function formatPageSize(
	template: { width: number; height: number },
	dpi: number,
): string {
	if (!(dpi > 0)) return "";
	const { widthMm, heightMm } = cardSizeMm(
		template.width,
		template.height,
		dpi,
	);
	return `${(template.width / dpi).toFixed(2)} × ${(template.height / dpi).toFixed(2)} in · ${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm`;
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
			fromJob: true,
		});
	if (failed.length > 0)
		actions.push({
			type: "setRecordStatus",
			datasetId,
			ids: failed,
			status: "failed",
			errors,
			fromJob: true,
		});
	return actions;
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
