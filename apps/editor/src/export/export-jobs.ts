import { toast } from "@freshcoat-js/ui/toast";
import type { ExportPreset } from "@freshcoat-js/workspace";
import {
	type JobFile,
	type JobResult,
	jobStem,
	type SinkResult,
	withRecordIds,
} from "@freshcoat-js/workspace/export";
import { useSyncExternalStore } from "react";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { plural } from "~/app/copy";
import { downloadBytes } from "~/app/download";
import { formatNumber } from "~/app/format";
import { workspaceSnapshot } from "~/state/workspace";
import {
	boundDataset,
	retryPreset,
	selectedRunLabel,
	statusActions,
} from "./export-ui";
import { openSink } from "./sinks";
import {
	createExportRunner,
	type ExportRunner,
	type ExportRunnerSnapshot,
} from "./use-export-runner";

export const HISTORY_SIZE = 5;

export type JobHistoryEntry = {
	id: number;
	presetId: string;
	presetName: string;
	/** what the run covered when it was not the preset's own records */
	scope?: string;
	startedAt: number;
	state: "done" | "cancelled" | "error";
	ok: number;
	failed: number;
	total: number;
	ms: number;
	file?: JobFile;
	/** what reached the destination */
	sink?: SinkResult;
	error?: string;
};

export type RunningJob = {
	id: number;
	presetId: string;
	presetName: string;
	/** what the run covers when it is not the preset's own records */
	scope?: string;
	startedAt: number;
};

export type ExportJobsSnapshot = {
	runner: ExportRunnerSnapshot;
	/** The job in flight, or the one that last ran. */
	job: RunningJob | null;
	/** What the last finished job ran with, for "Retry failed": for a run
	 *  over chosen records, the preset with those records. */
	lastPreset: ExportPreset | null;
	lastResult: JobResult | null;
	history: JobHistoryEntry[];
};

export type ExportJobs = {
	getSnapshot(): ExportJobsSnapshot;
	subscribe(listener: () => void): () => void;
	/** Runs a preset against the workspace as it stands now, or only over
	 *  `options.recordIds`. Call it from the click: a Folder or Zip file
	 *  destination opens its picker first. */
	run(
		preset: ExportPreset,
		label?: string,
		options?: RunOptions,
	): Promise<JobResult | null>;
	cancel(): void;
	download(file: JobFile): void;
	dispose(): void;
};

export type RunOptions = {
	/** Exports exactly these records, in dataset order, in place of the
	 *  preset's record filter. The preset is not changed or saved. */
	recordIds?: readonly string[];
	/** asked before a PDF estimated past 1 GB goes on */
	confirmLargePdf?: (estimatedBytes: number) => Promise<boolean>;
	/** a download's part size; tests make it small */
	partBytes?: number;
};

export type ExportJobsDeps = {
	runner?: ExportRunner;
	download?: (file: JobFile) => void;
	now?: () => number;
};

/** The export jobs of one editor session. Lives beside the controller rather
 *  than in the section, so a job keeps running, and its history is kept,
 *  while another section is shown. */
export function createExportJobs(
	controller: Pick<EditorController, "state" | "dispatch">,
	deps: ExportJobsDeps = {},
): ExportJobs {
	const runner = deps.runner ?? createExportRunner();
	const download =
		deps.download ??
		((file: JobFile) =>
			void downloadBytes(file.blob, file.name, file.mediaType));
	const now = deps.now ?? (() => Date.now());
	const listeners = new Set<() => void>();
	let nextId = 1;
	let snapshot: ExportJobsSnapshot = {
		runner: runner.getSnapshot(),
		job: null,
		lastPreset: null,
		lastResult: null,
		history: [],
	};
	const set = (patch: Partial<ExportJobsSnapshot>) => {
		snapshot = { ...snapshot, ...patch };
		for (const l of listeners) l();
	};
	const unsubscribe = runner.subscribe(() =>
		set({ runner: runner.getSnapshot() }),
	);

	const jobs: ExportJobs = {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async run(own, label, options = {}) {
			const workspace = workspaceSnapshot(controller.state);
			if (!workspace) return null;
			const preset = options.recordIds
				? withRecordIds(own, options.recordIds)
				: own;
			let scope: string | undefined;
			if (options.recordIds) {
				const wanted = new Set(preset.selected);
				const records = boundDataset(workspace, preset)?.records ?? [];
				scope = selectedRunLabel(
					records.filter((r) => wanted.has(r.id)).length,
				);
			}
			let sink: Awaited<ReturnType<typeof openSink>> | undefined;
			if (preset.format !== "pdf") {
				try {
					sink = await openSink(
						preset.destination ?? "download",
						jobStem(workspace, preset),
						{
							onPart: download,
							...(options.partBytes ? { partBytes: options.partBytes } : {}),
						},
					);
				} catch (e) {
					toast(`Couldn't open the destination: ${String(e)}`, {
						tone: "danger",
					});
					return null;
				}
				if (!sink) return null;
			}
			const job: RunningJob = {
				id: nextId++,
				presetId: preset.id,
				presetName: label ?? preset.name,
				...(scope ? { scope } : {}),
				startedAt: now(),
			};
			set({ job });
			const result = await runner.start(workspace, preset, {
				...(sink ? { sink } : {}),
				...(options.confirmLargePdf
					? { confirmLargePdf: options.confirmLargePdf }
					: {}),
			});
			// A job that never ran leaves its destination open.
			if (!result) await sink?.abort();
			const error = runner.getSnapshot().error;
			if (result && preset.markExported) {
				const dataset = boundDataset(workspace, preset);
				for (const action of statusActions(result, dataset?.id))
					controller.dispatch(action);
			}
			const entry: JobHistoryEntry = {
				id: job.id,
				presetId: preset.id,
				presetName: job.presetName,
				...(scope ? { scope } : {}),
				startedAt: job.startedAt,
				state: result ? (result.cancelled ? "cancelled" : "done") : "error",
				ok: result ? result.items.filter((i) => i.ok).length : 0,
				failed: result ? result.items.filter((i) => !i.ok).length : 0,
				total:
					runner.getSnapshot().progress?.total ?? result?.items.length ?? 0,
				ms: result?.ms ?? now() - job.startedAt,
				...(result?.file ? { file: result.file } : {}),
				...(result?.sink ? { sink: result.sink } : {}),
				...(error && !result ? { error } : {}),
			};
			set({
				lastPreset: preset,
				lastResult: result,
				history: [entry, ...snapshot.history].slice(0, HISTORY_SIZE),
			});
			if (result?.file && !result.cancelled) download(result.file);
			if (controller.state.section !== "export") {
				if (!result) {
					if (runner.getSnapshot().state === "error")
						toast(`Couldn't export ${job.presetName}: ${error}`, {
							tone: "danger",
						});
				} else if (!result.cancelled)
					toast(
						[
							`${job.presetName}: ${plural(entry.ok, "file")} exported`,
							entry.failed > 0 ? `${formatNumber(entry.failed)} failed` : "",
						]
							.filter(Boolean)
							.join(", "),
						{
							tone: entry.failed > 0 ? "warning" : "success",
							...(entry.failed > 0
								? {
										timeout: 12000,
										action: {
											label: "Retry failed",
											onAction: () =>
												void jobs.run(
													retryPreset(preset, result),
													`${preset.name} (retry)`,
												),
										},
									}
								: {}),
						},
					);
			}
			return result;
		},
		cancel: () => runner.cancel(),
		download,
		dispose() {
			unsubscribe();
			runner.dispose();
		},
	};
	return jobs;
}

const sessions = new WeakMap<object, ExportJobs>();

export function exportJobsFor(
	controller: EditorController,
	deps?: ExportJobsDeps,
): ExportJobs {
	let jobs = sessions.get(controller);
	if (!jobs) {
		jobs = createExportJobs(controller, deps);
		sessions.set(controller, jobs);
	}
	return jobs;
}

export function useExportJobs(): ExportJobs & { snapshot: ExportJobsSnapshot } {
	const controller = useController();
	const jobs = exportJobsFor(controller);
	const snapshot = useSyncExternalStore(
		jobs.subscribe,
		jobs.getSnapshot,
		jobs.getSnapshot,
	);
	return { ...jobs, snapshot };
}
