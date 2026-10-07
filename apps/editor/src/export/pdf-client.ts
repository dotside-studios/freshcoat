import type { PdfPage } from "@freshcoat-js/workspace";
import type {
	AssembleExtras,
	AssemblePdf,
} from "@freshcoat-js/workspace/export";
import type {
	PdfAssembleOptions,
	PdfWorkerReply,
	PdfWorkerRequest,
} from "./protocol";
import { RenderCancelledError } from "./worker-pool";

/** The part of `Worker` the client uses, so tests can hand it fakes. */
export type PdfWorker = {
	postMessage(message: PdfWorkerRequest, transfer: Transferable[]): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<PdfWorkerReply>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
};

export type PdfWorkerFactory = () => PdfWorker;

export const createPdfWorker: PdfWorkerFactory = () =>
	new Worker(new URL("./pdf-worker.ts", import.meta.url), {
		type: "module",
	}) as unknown as PdfWorker;

/**
 * Assembles a PDF in a worker of its own, made for this one document. The
 * pages' buffers are transferred, so they are unusable here afterwards.
 * Aborting `signal` terminates the worker and rejects.
 */
export function assemblePdfInWorker(
	pages: PdfPage[],
	options: PdfAssembleOptions,
	extras: AssembleExtras = {},
	factory: PdfWorkerFactory = createPdfWorker,
): Promise<Uint8Array> {
	const { signal, onProgress } = extras;
	if (signal?.aborted) return Promise.reject(new RenderCancelledError());
	return new Promise((resolve, reject) => {
		const worker = factory();
		const done = () => {
			signal?.removeEventListener("abort", abort);
			worker.onmessage = null;
			worker.onerror = null;
			worker.terminate();
		};
		function abort() {
			done();
			reject(new RenderCancelledError());
		}
		worker.onmessage = ({ data }) => {
			if (data.type === "progress") {
				onProgress?.(data.done, data.total);
				return;
			}
			done();
			if (data.type === "done") resolve(data.bytes);
			else reject(new Error(data.error));
		};
		worker.onerror = (event) => {
			done();
			reject(new Error(event.message || "pdf worker failed"));
		};
		signal?.addEventListener("abort", abort, { once: true });
		const buffers = new Set<ArrayBuffer>();
		for (const page of pages)
			if (page.bytes.buffer instanceof ArrayBuffer)
				buffers.add(page.bytes.buffer);
		worker.postMessage({ type: "assemble", pages, options }, [...buffers]);
	});
}

/** Assembles in a worker where there are workers, else on this thread. */
export const assemblePdf: AssemblePdf = async (pages, options, extras) =>
	typeof Worker !== "undefined"
		? assemblePdfInWorker(pages, options, extras)
		: (await import("@freshcoat-js/workspace/pdf")).assemblePdf(pages, {
				...options,
				...(extras?.onProgress ? { onProgress: extras.onProgress } : {}),
			});
