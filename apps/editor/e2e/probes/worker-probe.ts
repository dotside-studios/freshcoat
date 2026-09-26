export function runWorkerProbe(): Promise<unknown> {
	const w = new Worker(new URL("./render-worker.probe.ts", import.meta.url), {
		type: "module",
	});
	return new Promise((resolve, reject) => {
		w.onmessage = (e) => {
			resolve(e.data);
			w.terminate();
		};
		w.onerror = (e) => reject(new Error(e.message));
		w.postMessage(null);
	});
}
