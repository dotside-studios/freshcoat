import type { PaintCacheStats } from "@freshcoat-js/engine";
import { canvasOfBitmap, type LiveBackend, type LiveFrame } from "./live-frame";
import type { PreviewReply, PreviewRequest } from "./preview-protocol";
import { createPreviewSender } from "./preview-sync";

/** The part of `Worker` the client uses, so tests can hand it a fake. */
export type PreviewWorkerLike = {
	postMessage(message: PreviewRequest, transfer?: Transferable[]): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<PreviewReply>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
};

export const createPreviewWorker = (): PreviewWorkerLike =>
	new Worker(new URL("./preview-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as PreviewWorkerLike;

/** Whether the Edit canvas paints from a worker. Off unless
 *  `window.__freshcoatPreviewWorker` is true: on a real GPU, handing each
 *  frame across cost more than the render it moved off the main thread. */
export function previewWorkerEnabled(): boolean {
	if (typeof window === "undefined") return false;
	const flag = (window as { __freshcoatPreviewWorker?: boolean })
		.__freshcoatPreviewWorker;
	return flag === true && previewWorkerSupported();
}

/** Whether this browser can paint the Edit canvas from a worker. */
export function previewWorkerSupported(): boolean {
	return (
		typeof Worker !== "undefined" &&
		typeof OffscreenCanvas !== "undefined" &&
		typeof createImageBitmap !== "undefined" &&
		typeof HTMLCanvasElement !== "undefined" &&
		"transferControlToOffscreen" in HTMLCanvasElement.prototype
	);
}

/** A render a newer one replaced before its reply came back. */
export class StalePreviewError extends Error {
	constructor() {
		super("replaced by a newer render");
		this.name = "StalePreviewError";
	}
}

export type WorkerBackend = LiveBackend & {
	/** The canvas on screen, painted by the worker. */
	readonly canvas: HTMLCanvasElement;
	/** Resolves once the worker can paint; rejects when it cannot. */
	readonly ready: Promise<void>;
	/** For tests: has the worker drop its GPU context. */
	loseContext(): void;
};

/**
 * The Edit canvas painted by a worker. Each render sends only what changed
 * (see preview-sync), one at a time; a reply for any render but the latest is
 * dropped. `onLost` asks for the frame again after a lost GPU context, and
 * `onFail` hands the canvas back to the main-thread path.
 */
export function createWorkerBackend(handlers: {
	onLost(): void;
	onFail(error: Error): void;
	factory?: () => PreviewWorkerLike;
	createCanvas?: () => HTMLCanvasElement;
}): WorkerBackend {
	const canvas = handlers.createCanvas?.() ?? document.createElement("canvas");
	const sender = createPreviewSender();
	const worker = (handlers.factory ?? createPreviewWorker)();
	let stats: PaintCacheStats | undefined;
	let nextId = 1;
	let pending: {
		id: number;
		resolve(frame: LiveFrame): void;
		reject(error: Error): void;
	} | null = null;
	let failed = false;
	let disposed = false;

	let settleReady: (error?: Error) => void = () => {};
	const ready = new Promise<void>((resolve, reject) => {
		settleReady = (error) => (error ? reject(error) : resolve());
	});
	ready.catch(() => {});

	const fail = (error: Error) => {
		if (failed || disposed) return;
		failed = true;
		settleReady(error);
		pending?.reject(error);
		pending = null;
		worker.terminate();
		handlers.onFail(error);
	};

	worker.onmessage = (event) => {
		const msg = event.data;
		switch (msg.type) {
			case "ready":
				if (msg.ok) settleReady();
				else fail(new Error(msg.error));
				return;
			case "lost":
				if (!disposed) handlers.onLost();
				return;
			case "render": {
				if (!pending || pending.id !== msg.id) {
					if (msg.ok) msg.snapshot?.close();
					return;
				}
				const { resolve, reject } = pending;
				pending = null;
				if (!msg.ok) {
					reject(new Error(msg.error));
					return;
				}
				const { type: _t, id: _i, ok: _o, stats: s, snapshot, ...result } = msg;
				stats = s;
				resolve({
					...result,
					canvas,
					...(snapshot ? { snapshot: canvasOfBitmap(snapshot) } : {}),
				});
				return;
			}
		}
	};
	worker.onerror = (event) => {
		event.preventDefault?.();
		fail(new Error(event.message || "the preview worker failed"));
	};

	try {
		const offscreen = canvas.transferControlToOffscreen();
		worker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);
	} catch (e) {
		queueMicrotask(() => fail(e instanceof Error ? e : new Error(String(e))));
	}

	return {
		canvas,
		ready,
		async render(request, { snapshot }) {
			await ready;
			if (disposed) throw new Error("the preview worker is disposed");
			const id = nextId++;
			const update = sender.encode(request);
			pending?.reject(new StalePreviewError());
			return new Promise<LiveFrame>((resolve, reject) => {
				pending = { id, resolve, reject };
				worker.postMessage({ type: "render", id, update, snapshot });
			});
		},
		cacheStats: () => stats,
		loseContext() {
			worker.postMessage({ type: "loseContext" });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			pending?.reject(new Error("the preview worker is disposed"));
			pending = null;
			settleReady(new Error("the preview worker is disposed"));
			if (!failed) worker.postMessage({ type: "dispose" });
			worker.terminate();
		},
	};
}
