import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { createRenderer } from "@freshcoat-js/engine";
import { fileLoader, loadCanvasKit } from "@freshcoat-js/engine/node";
import {
	IMAGE_CACHE_PIXELS,
	serveRenders,
	type WorkerScope,
} from "@freshcoat-js/workspace/export";

export const RENDER_WORKER = "freshcoat-render";

export type WorkerSetup = { role: typeof RENDER_WORKER; root: string };

const setup = workerData as WorkerSetup | undefined;
if (!isMainThread && parentPort && setup?.role === RENDER_WORKER) {
	const port = parentPort;
	const scope: WorkerScope = {
		postMessage: (message, transfer) =>
			port.postMessage(message, transfer as unknown as ArrayBuffer[]),
		onmessage: null,
		close: () => port.close(),
	};
	port.on("message", (data) => scope.onmessage?.({ data }));
	serveRenders(scope, async () =>
		createRenderer({
			ck: await loadCanvasKit("full"),
			load: fileLoader({ root: setup.root }),
			cache: { maxImagePixels: IMAGE_CACHE_PIXELS },
		}),
	);
}
