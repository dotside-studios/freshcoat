import { resolveFontRequest } from "./font-bytes";
import { type ByteLoader, mapLoader } from "./loader";
import type { PaintCache } from "./paint-cache";
import { makeRuntime } from "./runtime";
import type { CanvasLike, PaintRuntime } from "./types";

// The browser runtime: font resolution + byte I/O + a canvas host under a
// keep-alive policy (the live canvas stays mounted; nothing is auto-disposed).
export function createBrowserEnv(opts?: {
	fonts?: Map<string, Uint8Array[]>;
	images?: Map<string, Uint8Array>;
	// Where bytes not in `images` come from. Default: data: URLs and fetch.
	load?: ByteLoader;
	cache?: PaintCache;
	// The canvas each surface is made on. Default: a DOM <canvas>; a worker
	// passes an OffscreenCanvas.
	createCanvas?: (width: number, height: number) => CanvasLike;
}): PaintRuntime {
	return makeRuntime(
		{
			cache: opts?.cache,
			...(opts?.fonts ? { fonts: opts.fonts } : {}),
			resolveFont(req) {
				return resolveFontRequest(req, opts?.fonts);
			},
			loadBytes: mapLoader(opts?.images, opts?.load),
			canvas: { createCanvas: opts?.createCanvas ?? domCanvas },
		},
		"keep",
	);
}

function domCanvas(width: number, height: number): CanvasLike {
	const c = document.createElement("canvas");
	c.width = width;
	c.height = height;
	return c as unknown as CanvasLike;
}
