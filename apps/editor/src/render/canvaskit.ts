import { loadCanvasKit } from "@freshcoat-js/engine/browser";
import type { CanvasKit } from "canvaskit-wasm";

// The base must match the preloads vite.config.ts injects into index.html, or
// the browser downloads canvaskit.js and canvaskit.wasm twice.
export function getCanvasKit(): Promise<CanvasKit> {
	return loadCanvasKit(__CANVASKIT_BASE__);
}
