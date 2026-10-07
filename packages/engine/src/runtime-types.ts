// The paint runtime's types. Internal: the renderer builds runtimes, and the
// conformance runner grades a Painter through them.
import type { ByteLoader } from "./loader";
import type { PaintCache } from "./paint-cache";
import type { EncodeFormat, EncodeOptions } from "./png";
import type { DecodedPixels } from "./decode";
import type {
	Command,
	FontRequest,
	FontResolution,
	PaintWarning,
} from "./types";

// A canvas a surface is made on: a DOM canvas or an OffscreenCanvas.
export type CanvasLike = { width: number; height: number };

// Raw paint output. Carries lifecycle closures the runtime decides whether to
// call — the "env owns disposal" seam. Internal to the paint step.
export type PaintOutput = {
	// The raster surface, when the backend has one. A backend that emits a
	// document rather than pixels has no canvas and leaves this unset; its bytes
	// come back from encode() like any other format.
	canvas?: CanvasLike;
	warnings: PaintWarning[];
	// The painted frame as raw RGBA, at the device size the scene was rendered at.
	// Separate from encode() because a comparison between two backends is about
	// pixels, not about which encoder wrote them. null when the surface cannot be
	// read back (a lost context); absent when the backend cannot rasterize at all.
	readPixels?(): DecodedPixels | null;
	// PNG bytes of the painted frame. Async because encoding goes through the
	// platform's deflate (see ./png), which is a stream.
	encode(
		opts?: EncodeOptions,
	): Promise<{ bytes: Uint8Array; format: EncodeFormat }>;
	dispose(): void;
};

// The canvas host — a live surface to back a displayable (WebGL/SW) CanvasKit
// surface with, when present. Its presence IS the capability: a host-less
// runtime (createHeadlessEnv) renders offscreen instead.
export type CanvasHost = {
	createCanvas(width: number, height: number): CanvasLike;
};

// The runtime (env) — the agnostic paint TARGET: offscreen-encode (server) vs
// live-canvas keep (browser). Owns image byte I/O, font resolution + surface
// lifecycle. `paint` takes the CanvasKit instance directly (CanvasKit is the
// only backend, so there is no painter-strategy indirection).
export type PaintRuntime = {
	// Resolve a font request to what the env has (bytes / descriptor / nothing). A
	// bare string is a by-name request.
	resolveFont(req: FontRequest | string): FontResolution;
	// Every family the env holds bytes for. A paint through a cache registers
	// all of them, so a scene that uses fewer keeps the cached provider.
	fonts?: Map<string, Uint8Array[]>;
	// Encoded bytes for an image src or a local font file src.
	loadBytes: ByteLoader;
	// Decoded images the runtime owns. When present, paint asks it for each image
	// instead of decoding loadBytes itself, and never frees what it returns:
	// a caller that keeps its own bounded cache of decoded images (an export
	// worker reusing a logo across records) frees them on its own schedule. Null
	// is an image that could not be had, painted as a placeholder.
	loadImage?(src: string, ck: unknown): Promise<unknown | null>;
	canvas?: CanvasHost;
	// Keeps the font provider, decoded images and surface across paints (see
	// ./paint-cache). Absent, every paint builds and frees its own.
	cache?: PaintCache;
	// Paint ONE compiled scene (a Command[] beginning with createCanvas) to a
	// single surface. Multi-side rendering is the caller's loop — freshcoat has no
	// notion of named frames/sides. ck is the CanvasKit-WASM instance; typed
	// loosely as it has no TS types, and optional because a runtime built around a
	// non-CanvasKit Painter has no use for one. `opts.cache` paints through that
	// cache in place of the runtime's own.
	paint(
		commands: Command[],
		ck?: unknown,
		opts?: { cache?: PaintCache },
	): Promise<PaintResult>;
};

// What a paint reads from its runtime: everything but paint itself.
export type PaintTarget = Omit<PaintRuntime, "paint">;

// The backend seam: a compiled scene becomes an output. CanvasKit is the only
// implementation, and there is no plan for a second one; the parameter exists so
// that the conformance suite can grade a Painter without reaching into the
// runtime, which is also how the reference backend is graded today. A backend
// that emitted a document rather than pixels would leave PaintOutput.canvas unset
// and answer encode() with its own bytes and format.
export type Painter = (
	commands: Command[],
	rt: PaintRuntime,
) => Promise<PaintOutput>;

// paint() output after the runtime applies its disposal policy: browser keeps the
// live canvas (+ dispose for unmount), server hands back encoded bytes. Neither
// carries a frame/side name — the caller knows which scene it painted.
export type KeptPaintResult = {
	canvas: CanvasLike;
	warnings: PaintWarning[];
	dispose(): void;
};
export type EncodedPaintResult = {
	// The encoded image, in whatever `format` says. Not named `png`: a WebP
	// render answers here too, and a field read as the wrong format is how a
	// caller comes to store one under the other's content type.
	bytes: Uint8Array;
	format: EncodeFormat;
	warnings: PaintWarning[];
};
export type PaintResult = KeptPaintResult | EncodedPaintResult;
