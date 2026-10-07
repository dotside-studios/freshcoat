// Loads the classic canvaskit.js (its top-level `var CanvasKitInit` becomes a
// global) and inits it against the .wasm the vite plugin serves. Cached for the
// session. Both URLs must match the preloads vite.config.ts injects into
// index.html, or the browser downloads them twice.
let ckPromise: Promise<unknown> | undefined;
let loaded: unknown;

/** The session's CanvasKit once it has loaded, for synchronous callers. */
export function loadedCanvasKit(): unknown {
	return loaded;
}

export function getCanvasKit(): Promise<unknown> {
	if (!ckPromise) {
		ckPromise = (async () => {
			await new Promise<void>((resolve, reject) => {
				// biome-ignore lint/suspicious/noExplicitAny: global set by the script
				if ((globalThis as any).CanvasKitInit) return resolve();
				const s = document.createElement("script");
				s.src = `${__CANVASKIT_BASE__}/canvaskit.js`;
				s.onload = () => resolve();
				s.onerror = () => reject(new Error("failed to load canvaskit.js"));
				document.head.appendChild(s);
			});
			// biome-ignore lint/suspicious/noExplicitAny: WASM loader global
			const init = (globalThis as any).CanvasKitInit;
			if (typeof init !== "function")
				throw new Error("CanvasKitInit global missing after script load");
			loaded = await init({
				locateFile: () => `${__CANVASKIT_BASE__}/canvaskit.wasm`,
			});
			return loaded;
		})();
		ckPromise.catch(() => {
			ckPromise = undefined;
		});
	}
	return ckPromise;
}
