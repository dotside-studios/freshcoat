import type { CanvasKit, CanvasKitInit } from "./index";

export type { CanvasKit, CanvasKitBuild } from "./index";

type InitGlobal = { CanvasKitInit?: CanvasKitInit };

const loaded = new Map<string, Promise<CanvasKit>>();

/**
 * Loads canvaskit.js and canvaskit.wasm from `base`, a URL directory such as
 * `/canvaskit/0.41.1` or `/canvaskit/0.41.1/full`. Works on a page and in a
 * classic or module worker. One instance is shared per base; a failed load is
 * retried.
 */
export function loadCanvasKit(base: string): Promise<CanvasKit> {
	const root = base.replace(/\/+$/, "");
	let ck = loaded.get(root);
	if (!ck) {
		ck = (async () => {
			const init = await (typeof document === "undefined"
				? evalScript(`${root}/canvaskit.js`)
				: injectScript(`${root}/canvaskit.js`));
			return init({ locateFile: () => `${root}/canvaskit.wasm` });
		})();
		ck.catch(() => loaded.delete(root));
		loaded.set(root, ck);
	}
	return ck;
}

function initFromGlobal(): CanvasKitInit {
	const init = (globalThis as InitGlobal).CanvasKitInit;
	if (typeof init !== "function")
		throw new Error("canvaskit.js did not define CanvasKitInit");
	return init;
}

function injectScript(src: string): Promise<CanvasKitInit> {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.onload = () => {
			try {
				resolve(initFromGlobal());
			} catch (e) {
				reject(e);
			}
		};
		script.onerror = () => reject(new Error(`failed to load ${src}`));
		document.head.appendChild(script);
	});
}

// A module worker has no importScripts, so the classic script runs through an
// indirect eval, which defines CanvasKitInit at global scope.
async function evalScript(src: string): Promise<CanvasKitInit> {
	const res = await fetch(src);
	if (!res.ok) throw new Error(`fetch ${src} -> ${res.status}`);
	const code = await res.text();
	const indirectEval = globalThis.eval;
	indirectEval(code);
	return initFromGlobal();
}
