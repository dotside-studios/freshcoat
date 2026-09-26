import { compileScene } from "./compile-scene";
import { dataUrlToBytes, resolveFontRequest } from "./font-bytes";
import { deriveFontMetrics } from "./font-metrics";
import type { Node } from "./node";
import type { PaintCache } from "./paint-cache";
import { createParagraphEngine } from "./paragraph-layout";
import type { EncodeOptions } from "./png";
import { makeRuntime } from "./runtime";
import type {
	EncodedPaintResult,
	FontVMetrics,
	FrameFinish,
	PaintRuntime,
} from "./types";

async function fetchBytes(url: string): Promise<Uint8Array> {
	if (url.startsWith("data:")) return dataUrlToBytes(url);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

// A headless runtime: font resolution + image byte I/O, NO canvas host, encode
// policy. With no host, the paint step renders offscreen via ck.MakeSurface and
// PaintOutput.encode() reads those pixels back as a PNG (see ./png).
export function createHeadlessEnv(opts?: {
	fonts?: Map<string, Uint8Array[]>;
	images?: Map<string, Uint8Array>;
	// How to encode: format, quality, and how hard to work at making a PNG small
	// (see ./png). Default: PNG at "fast".
	encode?: EncodeOptions;
	cache?: PaintCache;
	// Decoded images the caller owns (see PaintRuntime.loadImage).
	loadImage?: PaintRuntime["loadImage"];
}): PaintRuntime {
	return makeRuntime(
		{
			cache: opts?.cache,
			...(opts?.loadImage ? { loadImage: opts.loadImage } : {}),
			resolveFont(req) {
				return resolveFontRequest(req, opts?.fonts);
			},
			async loadImageBytes(src) {
				return opts?.images?.get(src) ?? fetchBytes(src);
			},
		},
		"encode",
		opts?.encode,
	);
}

// Compile a Node scene and rasterize it to PNG bytes offscreen — the whole
// headless path in one call. Derives font metrics from `fonts` (override with
// `fontMetrics`), builds the CanvasKit Paragraph text engine, compiles + paints,
// and disposes the engine. `ck` is the caller's CanvasKit-WASM instance.
export async function renderSceneToPng(
	node: Node,
	opts: {
		width: number;
		height: number;
		ck: unknown;
		fonts?: Map<string, Uint8Array[]>;
		images?: Map<string, Uint8Array>;
		fontMetrics?: Record<string, FontVMetrics>;
		leadingTrim?: boolean;
		finish?: FrameFinish;
		// How to encode (see ./png). Default: PNG at "fast".
		encode?: EncodeOptions;
		// Export density: the scene keeps its `width`×`height` design units and the
		// PNG comes back that many times bigger (see ./export-scale). Omit = 1×.
		scale?: number;
		// Render this many times denser than the PNG comes out, and reduce (see
		// ./export-scale). The knob for a fixed output size: same pixel count,
		// edges resolved from several samples instead of one. Omit = 1×.
		supersample?: number;
	},
): Promise<EncodedPaintResult> {
	const fonts = opts.fonts ?? new Map<string, Uint8Array[]>();
	const fontMetrics = opts.fontMetrics ?? deriveFontMetrics(fonts);
	const textEngine = createParagraphEngine(opts.ck, fonts);
	try {
		const commands = compileScene(node, {
			width: opts.width,
			height: opts.height,
			textEngine,
			fontMetrics,
			leadingTrim: opts.leadingTrim,
			finish: opts.finish,
			scale: opts.scale,
			supersample: opts.supersample,
		});
		const env = createHeadlessEnv({
			fonts,
			images: opts.images,
			encode: opts.encode,
		});
		return (await env.paint(commands, opts.ck)) as EncodedPaintResult;
	} finally {
		textEngine.dispose();
	}
}
