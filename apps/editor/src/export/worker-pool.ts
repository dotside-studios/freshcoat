import {
	exportPoolSize,
	type RenderOutput,
	type RenderRequest,
} from "@freshcoat-js/workspace/export";
import type { WorkerReply, WorkerRequest } from "./protocol";

/** The part of `Worker` the pool uses, so tests can hand it fakes. */
export type PoolWorker = {
	postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
};

export type WorkerFactory = () => PoolWorker;

export type WorkerPool = {
	readonly size: number;
	/** Sends the fonts to every worker and resolves once each has CanvasKit. */
	init(fonts: Map<string, Uint8Array[]>): Promise<void>;
	/** Tells every worker the job is over, so an idle one frees the images,
	 *  analyses and surface it kept across the job's items. */
	endJob(): void;
	render(request: RenderRequest): Promise<RenderOutput>;
	/** Rejects queued work and terminates busy workers. */
	cancel(): void;
	dispose(): void;
};

export class RenderCancelledError extends Error {
	constructor() {
		super("cancelled");
		this.name = "AbortError";
	}
}

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

type Task = {
	id: number;
	request: RenderRequest;
	resolve(out: RenderOutput): void;
	reject(error: Error): void;
};

type Slot = {
	worker: PoolWorker;
	task: Task | null;
	/** the template the worker holds from its last render */
	template?: RenderRequest["template"];
	ready: Promise<void>;
	settleReady?: (error?: Error) => void;
};

/** Arms `slot.ready` for the next `ready` reply. */
function expectReady(slot: Slot) {
	slot.ready = new Promise<void>((resolve, reject) => {
		slot.settleReady = (error) => (error ? reject(error) : resolve());
	});
	// A worker nobody waits on still reports; its failure surfaces on render.
	slot.ready.catch(() => {});
}

export function createWorkerPool(
	size = defaultPoolSize(),
	factory: WorkerFactory = createRenderWorker,
): WorkerPool {
	const slots: (Slot | null)[] = Array.from({ length: size }, () => null);
	const queue: Task[] = [];
	let fonts: [string, Uint8Array[]][] | null = null;
	let nextId = 1;
	let cursor = 0;
	let disposed = false;

	function spawn(index: number): Slot {
		const worker = factory();
		const slot: Slot = { worker, task: null, ready: Promise.resolve() };
		worker.onmessage = (event) => {
			const msg = event.data;
			if (msg.type === "ready") {
				slot.settleReady?.(msg.ok ? undefined : new Error(msg.error));
				slot.settleReady = undefined;
				return;
			}
			const task = slot.task;
			if (!task || task.id !== msg.id) return;
			slot.task = null;
			if (msg.ok)
				task.resolve({
					bytes: msg.bytes,
					format: msg.format,
					width: msg.width,
					height: msg.height,
					ms: msg.ms,
					...(msg.crc !== undefined ? { crc: msg.crc } : {}),
					...(msg.print ? { print: msg.print } : {}),
					...(msg.printError ? { printError: msg.printError } : {}),
					...(msg.gamut ? { gamut: msg.gamut } : {}),
					...(msg.warnings ? { warnings: msg.warnings } : {}),
				});
			else task.reject(new Error(msg.error));
			pump();
		};
		worker.onerror = (event) => {
			const error = new Error(event.message || "render worker failed");
			slot.settleReady?.(error);
			slot.settleReady = undefined;
			const task = slot.task;
			slot.task = null;
			worker.terminate();
			if (slots[index] === slot) slots[index] = null;
			task?.reject(error);
			pump();
		};
		if (fonts) {
			expectReady(slot);
			worker.postMessage({ type: "init", fonts });
		}
		slots[index] = slot;
		return slot;
	}

	function pump() {
		while (queue.length > 0 && !disposed) {
			let picked = -1;
			for (let n = 0; n < size; n++) {
				const i = (cursor + n) % size;
				if (!slots[i]?.task) {
					picked = i;
					break;
				}
			}
			if (picked < 0) return;
			cursor = (picked + 1) % size;
			const slot = slots[picked] ?? spawn(picked);
			const task = queue.shift() as Task;
			slot.task = task;
			const { template, ...rest } = task.request;
			slot.worker.postMessage(
				slot.template === template
					? { type: "render", id: task.id, ...rest }
					: { type: "render", id: task.id, ...task.request },
			);
			slot.template = template;
		}
	}

	function cancel() {
		for (const task of queue.splice(0)) task.reject(new RenderCancelledError());
		for (let i = 0; i < size; i++) {
			const slot = slots[i];
			if (!slot?.task) continue;
			const task = slot.task;
			slot.task = null;
			slot.settleReady?.(new RenderCancelledError());
			slot.worker.terminate();
			slots[i] = null;
			task.reject(new RenderCancelledError());
		}
	}

	return {
		size,
		async init(next) {
			fonts = [...next];
			for (let i = 0; i < size; i++) {
				const slot = slots[i];
				if (!slot) {
					spawn(i);
					continue;
				}
				expectReady(slot);
				slot.worker.postMessage({ type: "init", fonts });
			}
			await Promise.all(slots.map((slot) => slot?.ready));
		},
		endJob() {
			for (const slot of slots) slot?.worker.postMessage({ type: "jobEnd" });
		},
		render(request) {
			if (disposed) return Promise.reject(new Error("the pool is disposed"));
			return new Promise<RenderOutput>((resolve, reject) => {
				queue.push({ id: nextId++, request, resolve, reject });
				pump();
			});
		},
		cancel,
		dispose() {
			cancel();
			disposed = true;
			for (let i = 0; i < size; i++) {
				const slot = slots[i];
				if (!slot) continue;
				slot.settleReady?.(new RenderCancelledError());
				slot.worker.postMessage({ type: "dispose" });
				slot.worker.terminate();
				slots[i] = null;
			}
		},
	};
}
