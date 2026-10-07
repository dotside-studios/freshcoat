import type { PaintCacheStats } from "@freshcoat-js/engine";
import type { LiveResult } from "./live-frame";
import type { PreviewUpdate } from "./preview-sync";

export type PreviewRequest =
	/** the canvas on screen, transferred; the worker paints into it */
	| { type: "init"; canvas: OffscreenCanvas }
	| { type: "render"; id: number; update: PreviewUpdate; snapshot: boolean }
	/** for tests: drop the GPU context, as the browser may at any time */
	| { type: "loseContext" }
	| { type: "dispose" };

export type PreviewReply =
	| { type: "ready"; ok: true }
	| { type: "ready"; ok: false; error: string }
	| ({
			type: "render";
			id: number;
			ok: true;
			stats: PaintCacheStats;
			/** the frame, readable, when the request asked for one */
			snapshot?: ImageBitmap;
	  } & LiveResult)
	| { type: "render"; id: number; ok: false; error: string }
	/** the GPU context went away; the next render starts over */
	| { type: "lost" };
