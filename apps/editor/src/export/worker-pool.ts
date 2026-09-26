import type {
	RenderOutput,
	RenderRequest,
	WorkerReply,
	WorkerRequest,
} from "./protocol";

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
	/** Replaces every worker's map of images the template carries. Blobs are
	 *  cloned by reference, so this copies no bytes. A dataset's photos go
	 *  with each render instead, only the ones it uses. */
	setImages(images: Map<string, Blob> | [string, Blob][]): void;
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

/** Past this many pixels in one image the pool is capped at two workers: each
 *  worker holds the decoded photo, the surface it renders to and the pixels
 *  it reads back to encode, so a 50 MP photo is several hundred MB a worker. */
export const LARGE_IMAGE_PIXELS = 24_000_000;

export type PoolSizeInput = {
	/** navigator.hardwareConcurrency */
	cores?: number;
	/** navigator.deviceMemory, in GB; Chromium only */
	memoryGb?: number;
	/** the largest image the job will decode, in pixels */
	largestImagePixels?: number;
};

/** One worker per core but one, at most four, and at most one per GB of
 *  memory; two at most when an image is over 24 MP. */
export function exportPoolSize(input: PoolSizeInput = {}): number {
	const cores = input.cores || 2;
	const memory = input.memoryGb ?? 4;
	let size = Math.max(1, Math.min(cores - 1, 4, Math.floor(memory / 1)));
	if ((input.largestImagePixels ?? 0) > LARGE_IMAGE_PIXELS)
		size = Math.min(size, 2);
	return size;
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
	let images: [string, Blob][] | null = null;
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
					...(msg.print ? { print: msg.print } : {}),
					...(msg.printError ? { printError: msg.printError } : {}),
					...(msg.gamut ? { gamut: msg.gamut } : {}),
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
		if (images) worker.postMessage({ type: "images", entries: images });
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
			slot.worker.postMessage({ type: "render", id: task.id, ...task.request });
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
		setImages(next) {
			images = [...(next instanceof Map ? next.entries() : next)];
			for (const slot of slots)
				slot?.worker.postMessage({ type: "images", entries: images });
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
