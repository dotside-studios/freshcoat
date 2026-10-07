import { resolveFontRequest } from "./font-bytes";
import { type ByteLoader, mapLoader } from "./loader";
import type { PaintCache } from "./paint-cache";
import { makeRuntime } from "./runtime";
import type { CanvasLike, PaintRuntime } from "./types";

// The browser runtime: font resolution + byte I/O + a DOM canvas host under a
// keep-alive policy (the live <canvas> stays mounted; nothing is auto-disposed).
export function createBrowserEnv(opts?: {
	fonts?: Map<string, Uint8Array[]>;
	images?: Map<string, Uint8Array>;
	// Where bytes not in `images` come from. Default: data: URLs and fetch.
	load?: ByteLoader;
	cache?: PaintCache;
}): PaintRuntime {
	return makeRuntime(
		{
			cache: opts?.cache,
			...(opts?.fonts ? { fonts: opts.fonts } : {}),
			resolveFont(req) {
				return resolveFontRequest(req, opts?.fonts);
			},
			loadBytes: mapLoader(opts?.images, opts?.load),
			canvas: {
				createCanvas(w, h) {
					const c = document.createElement("canvas");
					c.width = w;
					c.height = h;
					return c as unknown as CanvasLike;
				},
			},
		},
		"keep",
	);
}
