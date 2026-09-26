// Loads the classic canvaskit.js (its top-level `var CanvasKitInit` becomes a
// global) and inits it against the .wasm the vite plugin serves. Cached for the
// session.
let ckPromise: Promise<unknown> | undefined;

export function getCanvasKit(): Promise<unknown> {
	if (!ckPromise) {
		ckPromise = (async () => {
			await new Promise<void>((resolve, reject) => {
				// biome-ignore lint/suspicious/noExplicitAny: global set by the script
				if ((globalThis as any).CanvasKitInit) return resolve();
				const s = document.createElement("script");
				s.src = "/canvaskit/canvaskit.js";
				s.onload = () => resolve();
				s.onerror = () => reject(new Error("failed to load canvaskit.js"));
				document.head.appendChild(s);
			});
			// biome-ignore lint/suspicious/noExplicitAny: WASM loader global
			const init = (globalThis as any).CanvasKitInit;
			if (typeof init !== "function")
				throw new Error("CanvasKitInit global missing after script load");
			return init({ locateFile: () => "/canvaskit/canvaskit.wasm" });
		})();
		ckPromise.catch(() => {
			ckPromise = undefined;
		});
	}
	return ckPromise;
}
