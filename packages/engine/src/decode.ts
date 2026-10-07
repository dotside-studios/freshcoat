// decodePixels — decode encoded image bytes to a raw RGBA buffer via CanvasKit.
// freshcoat owns image decoding (it already does it to paint), so this is the
// primitive a consumer that only needs PIXELS (e.g. image analysis) calls, instead
// of standing up its own rasterizer. Takes the caller's CanvasKit instance; imports
// no WASM itself, so it stays in the light barrel.

import type { Canvas, CanvasKit, Image } from "canvaskit-wasm";
import type { ImageNode } from "./node";
import { fitRect } from "./paint-helpers";

export type DecodedPixels = {
	// Row-major RGBA, unpremultiplied, length = width * height * 4.
	data: Uint8Array;
	width: number;
	height: number;
};

export type DecodeOptions = {
	// Downscale so the longest side is at most this many pixels, using Mitchell
	// cubic resampling. For analysis a small buffer (e.g. 256) captures the same
	// statistics at a fraction of the pixels — the full-res buffer for a phone
	// photo is millions of samples the histogram doesn't need. Omit = full size.
	maxDim?: number;
};

export type ImageSampleOptions = {
	// The longest side of the fitted image buffer. Omit for the node's full box.
	maxDim?: number;
};

export type ImageBytesLoader = (src: string) => Promise<Uint8Array>;

// A rectangle in pixels; `w`/`h` are extents, not right/bottom.
export type PixelRect = { x: number; y: number; w: number; h: number };

// Read RGBA out of an Image or Canvas. Returns null when CanvasKit can't read back
// (an unsupported ImageInfo, a lost context) — readPixels can return null, so the
// caller must not assume a buffer.
function readRGBA(
	c: CanvasKit,
	source: Image | Canvas,
	width: number,
	height: number,
): Uint8Array | null {
	const info = {
		width,
		height,
		colorType: c.ColorType.RGBA_8888,
		alphaType: c.AlphaType.Unpremul,
		colorSpace: c.ColorSpace.SRGB,
	};
	const px = source.readPixels(
		0,
		0,
		info,
		undefined,
		width * 4,
	) as Uint8Array | null;
	// Copy out of the WASM heap so the result owns its buffer.
	return px ? px.slice() : null;
}

// Draw an image's `src` rect into an `outW`×`outH` surface at `dest` (Mitchell
// cubic) and read the result back as RGBA. Owns the surface + paint lifecycle
// (freed even on throw) and returns null if the surface or readback fails. Shared
// by the downscale path here and by consumers that render a cropped/fitted image
// for analysis.
export function drawImageToPixels(
	ck: unknown,
	img: unknown,
	outW: number,
	outH: number,
	src: PixelRect,
	dest: PixelRect,
): DecodedPixels | null {
	const c = ck as CanvasKit;
	const surface = c.MakeSurface(outW, outH);
	if (!surface) return null;
	const paint = new c.Paint();
	try {
		const canvas = surface.getCanvas();
		canvas.clear(c.TRANSPARENT);
		canvas.drawImageRectCubic(
			img as Image,
			c.XYWHRect(src.x, src.y, src.w, src.h),
			c.XYWHRect(dest.x, dest.y, dest.w, dest.h),
			1 / 3,
			1 / 3,
			paint,
		);
		surface.flush();
		const data = readRGBA(c, canvas, outW, outH);
		return data ? { data, width: outW, height: outH } : null;
	} finally {
		paint.delete();
		surface.delete();
	}
}

// Decode and rasterize an ImageNode exactly as the painter draws it: its resolved
// box and object-fit crop determine the pixels returned, rather than the source
// file alone. This is the reusable bridge for consumers such as print analysis;
// it keeps CanvasKit decoding and fit math in freshcoat instead of duplicating
// them in every caller.
export async function sampleImageNode(
	ck: unknown,
	node: ImageNode,
	loadImageBytes: ImageBytesLoader,
	opts?: ImageSampleOptions,
): Promise<DecodedPixels | null> {
	const c = ck as CanvasKit;
	const img = c.MakeImageFromEncoded(await loadImageBytes(node.src));
	if (!img) return null;
	try {
		const boxW = node.size?.width ?? img.width();
		const boxH = node.size?.height ?? img.height();
		const maxDim = opts?.maxDim;
		const scale = maxDim ? Math.min(1, maxDim / Math.max(boxW, boxH)) : 1;
		const width = Math.max(1, Math.round(boxW * scale));
		const height = Math.max(1, Math.round(boxH * scale));
		// Tile repeats the full source; its distribution is therefore the source's,
		// and rendering it as fill gives analysis the same pixels without allocating
		// a potentially enormous repeated surface.
		const fit = node.fit === "tile" ? "fill" : node.fit;
		const r = fitRect(
			img.width(),
			img.height(),
			0,
			0,
			width,
			height,
			fit,
			node.fit === "tile" ? undefined : node,
		);
		return drawImageToPixels(
			c,
			img,
			width,
			height,
			{ x: r.sx, y: r.sy, w: r.sw, h: r.sh },
			{ x: r.dx, y: r.dy, w: r.dw, h: r.dh },
		);
	} finally {
		img.delete();
	}
}

// Decode `bytes` (PNG/JPEG/WebP/GIF — whatever CanvasKit's codecs handle) to RGBA.
// Returns null if the bytes can't be decoded (or read back). With `maxDim`, the
// image is downscaled (Mitchell cubic) so the longest side is at most that many.
export function decodePixels(
	ck: unknown,
	bytes: Uint8Array,
	opts?: DecodeOptions,
): DecodedPixels | null {
	const c = ck as CanvasKit;
	const img = c.MakeImageFromEncoded(bytes);
	if (!img) return null;
	try {
		const iw = img.width();
		const ih = img.height();
		const maxDim = opts?.maxDim;
		const scale = maxDim ? Math.min(1, maxDim / Math.max(iw, ih)) : 1;

		if (scale >= 1) {
			const data = readRGBA(c, img, iw, ih);
			return data ? { data, width: iw, height: ih } : null;
		}

		const w = Math.max(1, Math.round(iw * scale));
		const h = Math.max(1, Math.round(ih * scale));
		const out = drawImageToPixels(
			c,
			img,
			w,
			h,
			{ x: 0, y: 0, w: iw, h: ih },
			{ x: 0, y: 0, w, h },
		);
		if (out) return out;
		// No surface / failed readback — fall back to a full-res read.
		const data = readRGBA(c, img, iw, ih);
		return data ? { data, width: iw, height: ih } : null;
	} finally {
		img.delete();
	}
}
