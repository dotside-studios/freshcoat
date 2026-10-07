import type { CanvasKit } from "@freshcoat-js/canvaskit";
import { loadCanvasKit } from "@freshcoat-js/canvaskit/browser";

// The base must match the preloads vite.config.ts injects into index.html, or
// the browser downloads canvaskit.js and canvaskit.wasm twice.
export function getCanvasKit(): Promise<CanvasKit> {
	return loadCanvasKit(__CANVASKIT_BASE__);
}
