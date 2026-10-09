import { planExport } from "../plan";
import { withRecordStatus } from "../status";
import type { Dataset, ExportPreset, Workspace } from "../types";
import type { JobResult } from "./job";

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

/** What a finished job writes back to its dataset: `exported` with the time
 *  for records that rendered, `failed` with the error for the rest. Nothing
 *  for a cancelled job. */
export function applyJobResult(
	datasets: Dataset[],
	datasetId: string,
	result: JobResult,
	now: Date = new Date(),
): Dataset[] {
	if (result.cancelled) return datasets;
	const { ok, failed, errors } = recordOutcome(result);
	let next = datasets;
	if (ok.length > 0)
		next = withRecordStatus(next, datasetId, ok, "exported", {
			exportedAt: now.toISOString(),
		});
	if (failed.length > 0)
		next = withRecordStatus(next, datasetId, failed, "failed", { errors });
	return next;
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

/** The records a job left unwritten, in plan order: all of them for a PDF,
 *  which is written only once whole. */
export function unwrittenRecordIds(
	workspace: Workspace,
	preset: ExportPreset,
	result: JobResult,
): string[] {
	const written = new Set(
		preset.format === "pdf"
			? []
			: result.items.filter((i) => i.ok).map((i) => i.key),
	);
	const out = new Set<string>();
	for (const item of planExport(workspace, preset))
		if (item.recordId && !written.has(item.key)) out.add(item.recordId);
	return [...out];
}
