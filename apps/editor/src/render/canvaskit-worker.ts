// biome-ignore lint/suspicious/noExplicitAny: CanvasKit is untyped
type CK = any;

const loaded = new Map<string, Promise<CK>>();

/** Loads the classic canvaskit.js under `base` in a module worker and inits it
 *  against the .wasm beside it. Cached per build; a failed load is retried. */
export function loadWorkerCanvasKit(base: string): Promise<CK> {
	let ck = loaded.get(base);
	if (!ck) {
		ck = (async () => {
			const src = await (await fetch(`${base}/canvaskit.js`)).text();
			// An indirect eval runs the classic script at global scope, so its
			// top-level `var CanvasKitInit` becomes a global as it would from a
			// script tag. A module worker has no importScripts, and the script is
			// our own asset.
			// biome-ignore lint/security/noGlobalEval: loads canvaskit.js in a module worker
			const indirectEval = globalThis.eval;
			indirectEval(src);
			const init = (
				globalThis as { CanvasKitInit?: (o: unknown) => Promise<unknown> }
			).CanvasKitInit;
			if (typeof init !== "function") throw new Error("CanvasKitInit missing");
			return init({ locateFile: () => `${base}/canvaskit.wasm` });
		})();
		ck.catch(() => loaded.delete(base));
		loaded.set(base, ck);
	}
	return ck;
}
