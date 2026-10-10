import {
	createWorkerPool as createPool,
	exportPoolSize,
	type PoolWorker,
	type WorkerFactory,
	type WorkerPool,
} from "@freshcoat-js/workspace/export";

export {
	type PoolWorker,
	RenderCancelledError,
	type WorkerFactory,
	type WorkerPool,
} from "@freshcoat-js/workspace/export";

/** The pool size for this browser, for a job whose largest image is this many
 *  pixels. */
export function defaultPoolSize(largestImagePixels = 0): number {
	const nav =
		typeof navigator !== "undefined"
			? (navigator as Navigator & { deviceMemory?: number })
			: undefined;
	return exportPoolSize({
		cores: nav?.hardwareConcurrency,
		memoryGb: nav?.deviceMemory,
		largestImagePixels,
	});
}

export const createRenderWorker: WorkerFactory = () =>
	new Worker(new URL("./render-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as PoolWorker;

/** A pool of the editor's render workers. */
export function createWorkerPool(
	size = defaultPoolSize(),
	factory: WorkerFactory = createRenderWorker,
): WorkerPool {
	return createPool(size, factory);
}
