import { availableParallelism, totalmem } from "node:os";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
	createWorkerPool,
	exportPoolSize,
	type PoolWorker,
	type WorkerPool,
} from "@freshcoat-js/workspace/export";
import { RENDER_WORKER, type WorkerSetup } from "./render-worker";

// The worker is this module's sibling, as .ts from source and .js once built.
const WORKER_URL = new URL(
	`./render-worker${extname(fileURLToPath(import.meta.url))}`,
	import.meta.url,
);

// Starting a worker loads its own CanvasKit, which only pays off over a few
// items each.
const ITEMS_PER_WORKER = 8;

/** How many threads render `items`: `jobs` when given, otherwise what the
 *  cores and memory allow, one per ITEMS_PER_WORKER items. One means none. */
export function poolSize(items: number, largestImagePixels: number, jobs?: number): number {
	if (jobs !== undefined) return Math.max(1, Math.min(jobs, items));
	const fits = exportPoolSize({
		cores: availableParallelism(),
		memoryGb: totalmem() / 2 ** 30,
		largestImagePixels,
	});
	return Math.max(1, Math.min(fits, Math.floor(items / ITEMS_PER_WORKER)));
}

/** A `worker_threads` worker as the pool's `PoolWorker`. */
function renderThread(root: string): PoolWorker {
	const workerData: WorkerSetup = { role: RENDER_WORKER, root };
	const worker = new Worker(WORKER_URL, { workerData });
	let stopped = false;
	const thread: PoolWorker = {
		onmessage: null,
		onerror: null,
		postMessage: (message, transfer) =>
			worker.postMessage(message, transfer as unknown as ArrayBuffer[]),
		terminate() {
			stopped = true;
			void worker.terminate();
		},
	};
	worker.on("message", (data) => thread.onmessage?.({ data }));
	worker.on("error", (error: Error) => thread.onerror?.({ message: error.message }));
	worker.on("exit", (code) => {
		if (!stopped && code !== 0)
			thread.onerror?.({ message: `a render thread stopped with code ${code}` });
	});
	return thread;
}

/** `size` render threads over `root`, resolved once each holds the fonts. */
export async function startWorkerPool(
	size: number,
	root: string,
	fonts: Map<string, Uint8Array[]>,
): Promise<WorkerPool> {
	const pool = createWorkerPool(size, () => renderThread(root));
	try {
		await pool.init(fonts);
	} catch (error) {
		pool.dispose();
		throw error;
	}
	return pool;
}
