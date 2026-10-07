import { loadCanvasKit } from "@freshcoat-js/engine/browser";
import type { CanvasKit } from "canvaskit-wasm";

let loaded: CanvasKit | undefined;

/** The session's CanvasKit once it has loaded, for synchronous callers. */
export function loadedCanvasKit(): CanvasKit | undefined {
	return loaded;
}

// The base must match the preloads vite.config.ts injects into index.html, or
// the browser downloads canvaskit.js and canvaskit.wasm twice.
export async function getCanvasKit(): Promise<CanvasKit> {
	loaded = await loadCanvasKit(__CANVASKIT_BASE__);
	return loaded;
}
