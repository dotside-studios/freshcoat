import { availableParallelism, totalmem } from "node:os";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Template } from "@freshcoat-js/coatfile";
import {
	exportPoolSize,
	type JobPool,
	type RenderOutput,
	type RenderRequest,
} from "@freshcoat-js/workspace/export";
import {
	RENDER_WORKER,
	type WorkerReply,
	type WorkerRequest,
	type WorkerSetup,
} from "./render-worker";

// The worker is this module's sibling, as .ts from source and .js once built.
const WORKER_URL = new URL(
	`./render-worker${extname(fileURLToPath(import.meta.url))}`,
	import.meta.url,
);

// Starting a worker loads its own CanvasKit, which only pays off over a few
// items each.
const ITEMS_PER_WORKER = 8;

export type WorkerPool = JobPool & { dispose(): Promise<void> };

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

type Task = {
	id: number;
	request: RenderRequest;
	resolve(output: RenderOutput): void;
	reject(error: Error): void;
};

type Slot = { worker: Worker; task: Task | null; template?: Template };

/** `size` worker threads, each with its own renderer and the fonts, resolved
 *  once every one has loaded CanvasKit. */
export async function createWorkerPool(
	size: number,
	setup: Omit<WorkerSetup, "role">,
): Promise<WorkerPool> {
	const workerData: WorkerSetup = { role: RENDER_WORKER, ...setup };
	const slots: Slot[] = [];
	const queue: Task[] = [];
	let nextId = 1;
	let closed = false;

	const start = () =>
		new Promise<Slot>((resolve, reject) => {
			const worker = new Worker(WORKER_URL, { workerData });
			const slot: Slot = { worker, task: null };
			const failed = (error: Error) => {
				void worker.terminate();
				reject(error);
			};
			worker.once("error", failed);
			worker.once("message", (msg: WorkerReply) => {
				worker.off("error", failed);
				if (msg.type !== "ready" || msg.error)
					return failed(new Error(`a render thread did not start: ${"error" in msg ? msg.error : msg.type}`));
				attach(slot);
				resolve(slot);
			});
		});

	function attach(slot: Slot) {
		slot.worker.on("message", (msg: WorkerReply) => {
			const task = slot.task;
			if (msg.type !== "render" || !task || task.id !== msg.id) return;
			slot.task = null;
			if ("error" in msg) task.reject(new Error(msg.error));
			else task.resolve(msg.output);
			pump();
		});
		slot.worker.on("error", (error) => lose(slot, error as Error));
		slot.worker.on("exit", (code) => {
			if (!closed) lose(slot, new Error(`a render thread stopped with code ${code}`));
		});
	}

	function lose(slot: Slot, error: Error) {
		const at = slots.indexOf(slot);
		if (at === -1) return;
		slots.splice(at, 1);
		slot.task?.reject(error);
		slot.task = null;
		if (slots.length === 0) for (const task of queue.splice(0)) task.reject(error);
		else pump();
	}

	async function send(slot: Slot, task: Task) {
		const { template, images, ...request } = task.request;
		const bytes = await Promise.all(
			images.map(async ([ref, blob]): Promise<[string, Uint8Array]> => [
				ref,
				new Uint8Array(await blob.arrayBuffer()),
			]),
		);
		const message: WorkerRequest = {
			type: "render",
			id: task.id,
			request,
			images: bytes,
			...(slot.template !== template ? { template } : {}),
		};
		slot.template = template;
		slot.worker.postMessage(message, bytes.map(([, b]) => b.buffer as ArrayBuffer));
	}

	function pump() {
		while (queue.length > 0 && !closed) {
			const slot = slots.find((s) => s.task === null);
			if (!slot) return;
			const task = queue.shift() as Task;
			slot.task = task;
			send(slot, task).catch((error: Error) => {
				if (slot.task !== task) return;
				slot.task = null;
				task.reject(error);
				pump();
			});
		}
	}

	async function stop() {
		closed = true;
		await Promise.all(slots.splice(0).map((slot) => slot.worker.terminate()));
	}

	const started = await Promise.allSettled(Array.from({ length: size }, start));
	for (const result of started) if (result.status === "fulfilled") slots.push(result.value);
	const failure = started.find((result) => result.status === "rejected");
	if (failure) {
		await stop();
		throw (failure as PromiseRejectedResult).reason;
	}

	return {
		size,
		render(request) {
			if (closed) return Promise.reject(new Error("the render threads are stopped"));
			if (slots.length === 0) return Promise.reject(new Error("no render thread is left"));
			return new Promise<RenderOutput>((resolve, reject) => {
				queue.push({ id: nextId++, request, resolve, reject });
				pump();
			});
		},
		cancel() {
			const error = new Error("cancelled");
			for (const task of queue.splice(0)) task.reject(error);
			for (const slot of slots) {
				slot.task?.reject(error);
				slot.task = null;
			}
			void stop();
		},
		dispose: stop,
	};
}
