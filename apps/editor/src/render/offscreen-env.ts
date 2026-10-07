import type {
	CanvasLike,
	ImageLike,
	PaintCache,
	PaintRuntime,
} from "@freshcoat-js/engine";
import { resolveFontRequest } from "@freshcoat-js/engine";
import { makeRuntime } from "@freshcoat-js/engine/runtime";

export type OffscreenEnvOptions = {
	fonts: Map<string, Uint8Array[]>;
	images: Map<string, Uint8Array>;
	cache: PaintCache;
	/** Called with every canvas a surface is made on. */
	onCanvas?(canvas: OffscreenCanvas): void;
};

/**
 * The browser runtime for a worker: surfaces on an OffscreenCanvas, images
 * from the bytes it was given. CanvasKit shapes text from the font bytes, so
 * nothing is registered with the platform.
 */
export function createOffscreenEnv(opts: OffscreenEnvOptions): PaintRuntime {
	return makeRuntime(
		{
			cache: opts.cache,
			fonts: opts.fonts,
			resolveFont: (req) => resolveFontRequest(req, opts.fonts),
			async loadImageBytes(src) {
				const bytes = opts.images.get(src);
				if (bytes) return bytes;
				const res = await fetch(src);
				if (!res.ok) throw new Error(`fetch ${src} -> ${res.status}`);
				return new Uint8Array(await res.arrayBuffer());
			},
			canvas: {
				createCanvas(w, h) {
					const canvas = new OffscreenCanvas(w, h);
					opts.onCanvas?.(canvas);
					return canvas as unknown as CanvasLike;
				},
				async decodeImage(bytes) {
					const bmp = await createImageBitmap(
						new Blob([bytes as unknown as BlobPart]),
					);
					return bmp as unknown as ImageLike;
				},
				encode() {
					throw new Error("the live preview never encodes");
				},
			},
		},
		"keep",
	);
}
