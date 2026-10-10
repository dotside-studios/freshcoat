import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit as loadCanvasKitAt } from "@freshcoat-js/engine/browser";
import {
	IMAGE_CACHE_PIXELS,
	serveRenders,
	type WorkerScope,
} from "@freshcoat-js/workspace/export";

// The `full` build: the default one the editor's canvas uses has neither the
// JPEG nor the WebP encoder, and would answer every photo export in PNG.
const CANVASKIT_BASE = `${__CANVASKIT_BASE__}/full`;

serveRenders(self as unknown as WorkerScope, async () =>
	createRenderer({
		ck: await loadCanvasKitAt(CANVASKIT_BASE),
		cache: { maxImagePixels: IMAGE_CACHE_PIXELS },
	}),
);
