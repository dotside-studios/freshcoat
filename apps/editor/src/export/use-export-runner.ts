import type { Template } from "@freshcoat-js/coatfile";
import type { ExportPreset, Workspace } from "@freshcoat-js/workspace";
import {
	boundDatasetOf,
	type ExportJobOptions,
	type JobProgress,
	type JobResult,
	largestImagePixels,
	runExportJob,
} from "@freshcoat-js/workspace/export";
import { useEffect, useState, useSyncExternalStore } from "react";
import { settleAssets } from "~/app/source-assets";
import { resolveTemplateFonts } from "~/render/fonts";
import { assemblePdf } from "./pdf-client";
import {
	createWorkerPool,
	defaultPoolSize,
	type WorkerPool,
} from "./worker-pool";

export type ExportRunnerState =
	| "idle"
	| "running"
	| "done"
	| "cancelled"
	| "error";

export type ExportRunnerSnapshot = {
	state: ExportRunnerState;
	progress: JobProgress | null;
	result: JobResult | null;
	error: string | null;
};

export type ExportRunner = {
	getSnapshot(): ExportRunnerSnapshot;
	subscribe(listener: () => void): () => void;
	/** Resolves with the job's result, or null when it failed to run. */
	start(
		workspace: Workspace,
		preset: ExportPreset,
		job?: JobExtras,
	): Promise<JobResult | null>;
	cancel(): void;
	dispose(): void;
};

/** What one job adds to the runner's own options. */
export type JobExtras = Pick<ExportJobOptions, "sink" | "confirmLargePdf">;

export type ExportRunnerDeps = {
	createPool?: (
		size: number,
	) => Pick<WorkerPool, "init" | "endJob" | "dispose"> &
		ExportJobOptions["pool"];
	/** the pool size for a job whose largest photo has this many pixels */
	poolSize?: (largestImagePixels: number) => number;
	resolveFonts?: (template: Template) => Promise<Map<string, Uint8Array[]>>;
	assemblePdf?: ExportJobOptions["assemblePdf"];
};

const IDLE: ExportRunnerSnapshot = {
	state: "idle",
	progress: null,
	result: null,
	error: null,
};

function sameFonts(
	a: Map<string, Uint8Array[]> | null,
	b: Map<string, Uint8Array[]>,
): boolean {
	if (!a || a.size !== b.size) return false;
	for (const [family, bytes] of b) {
		const other = a.get(family);
		if (!other || other.length !== bytes.length) return false;
		if (bytes.some((face, i) => face !== other[i])) return false;
	}
	return true;
}

/** One export job at a time over a lazily created worker pool. A disposed
 *  runner stays usable: its next job creates a new pool. */
export function createExportRunner(deps: ExportRunnerDeps = {}): ExportRunner {
	const createPool =
		deps.createPool ?? ((size: number) => createWorkerPool(size));
	const poolSize = deps.poolSize ?? defaultPoolSize;
	const resolveFonts =
		deps.resolveFonts ??
		(async (template: Template) =>
			(await resolveTemplateFonts(template)).fonts);
	let pool: ReturnType<typeof createPool> | null = null;
	let poolFonts: Map<string, Uint8Array[]> | null = null;
	let controller: AbortController | null = null;
	let snapshot = IDLE;
	const listeners = new Set<() => void>();

	const set = (next: Partial<ExportRunnerSnapshot>) => {
		snapshot = { ...snapshot, ...next };
		for (const listener of listeners) listener();
	};

	return {
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async start(workspace, preset, job = {}) {
			controller?.abort();
			const own = new AbortController();
			controller = own;
			set({ state: "running", progress: null, result: null, error: null });
			try {
				const entry = workspace.templates.find(
					(t) => t.id === preset.templateId,
				);
				if (!entry) throw new Error("template not found");
				await settleAssets(boundDatasetOf(workspace, preset)?.assets ?? []);
				const fonts = await resolveFonts(entry.template);
				if (own.signal.aborted) {
					if (controller === own) set({ state: "cancelled" });
					return null;
				}
				// A job of large photos gets fewer workers, so the pool is rebuilt
				// when the size it wants changes.
				const size = poolSize(largestImagePixels(workspace, preset));
				if (pool && pool.size !== size) {
					pool.dispose();
					pool = null;
					poolFonts = null;
				}
				pool ??= createPool(size);
				if (!sameFonts(poolFonts, fonts)) {
					await pool.init(fonts);
					poolFonts = fonts;
				}
				const result = await runExportJob(workspace, preset, {
					pool,
					signal: own.signal,
					assemblePdf: deps.assemblePdf ?? assemblePdf,
					...job,
					onProgress: (progress) => {
						if (controller === own) set({ progress });
					},
				});
				if (controller === own)
					set({ state: result.cancelled ? "cancelled" : "done", result });
				return result;
			} catch (e) {
				if (controller === own)
					set({
						state: own.signal.aborted ? "cancelled" : "error",
						error: e instanceof Error ? e.message : String(e),
					});
				return null;
			} finally {
				// However this job ended, the workers drop what an earlier one left
				// them. A job that replaced this one keeps what they hold.
				if (controller === own) {
					controller = null;
					pool?.endJob();
				}
			}
		},
		cancel() {
			controller?.abort();
		},
		dispose() {
			controller?.abort();
			controller = null;
			pool?.dispose();
			pool = null;
			poolFonts = null;
		},
	};
}

/** Export job state for the UI. The pool starts with the first job and is
 *  disposed with the component. */
export function useExportRunner(deps?: ExportRunnerDeps) {
	const [runner] = useState(() => createExportRunner(deps));
	useEffect(() => () => runner.dispose(), [runner]);
	const snapshot = useSyncExternalStore(
		runner.subscribe,
		runner.getSnapshot,
		runner.getSnapshot,
	);
	return { ...snapshot, start: runner.start, cancel: runner.cancel };
}
