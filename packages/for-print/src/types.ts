// ---------------------------------------------------------------------------
// for-print is an ANALYSIS module: image statistics + print intent in, freshcoat
// adjustments out. It holds no canvas, no rasterizer, and no pixel-output code —
// freshcoat owns all rendering. These types are the analysis vocabulary.
// ---------------------------------------------------------------------------

export type CardOrientation = "landscape" | "portrait";

// Crop region stored as fractions (0-1) of the original image dimensions.
// This makes it resolution-independent.
export interface CropRegion {
	x: number; // left edge, 0-1
	y: number; // top edge, 0-1
	width: number; // width, 0-1
	height: number; // height, 0-1
	orientation: CardOrientation;
}

// Per-channel gamma correcting a printer's own color cast. 1 is neutral; above 1
// lays down less of that channel, below 1 more.
//
// Gamma rather than a flat gain because a cast is rarely uniform across the tone
// range — a ribbon that runs warm usually runs warm in the midtones and much less
// so at the ends, and a single multiplier cannot follow that. The gray ramp
// measures the cast at every step, so the correction may as well use all of them.
//
// This is the one correction that is genuinely per-device: it belongs to a
// printer, a ribbon batch and a card stock, and it is measured rather than
// guessed. See ./profile.
export interface ChannelBalance {
	r: number;
	g: number;
	b: number;
}

// The correction knobs analysis recommends. Mapped to a generic freshcoat
// `Adjust` (per layer) via `printAdjust`; freshcoat applies them at paint time.
export interface PrintOptimizeOptions {
	saturation: number; // multiplier, e.g. 1.2 = +20%
	contrast: number; // multiplier, e.g. 1.15 = +15%
	sharpness: number; // 0-1, amount of unsharp mask
	gamma: number; // e.g. 0.9 = darken midtones
	darkness: number; // 0-1, Overlay blend with black at this opacity
}

// How hard a correction pushes past the end of the output's range. Measured on
// the correction's own matrix before anything clamps — the clamped pixels no
// longer carry it.
export interface GamutReport {
	// Share of pixels (0–1) driven past full scale on some channel.
	clipped: number;
	// Mean chroma given back on those pixels (0–1) to hold the hue.
	pullback: number;
}

export interface ImageAnalysis {
	avgBrightness: number;
	avgSaturation: number;
	contrast: number;
	detectedOrientation: CardOrientation;
	imageWidth: number;
	imageHeight: number;
	recommendation: PrintOptimizeOptions;
	// What `recommendation` costs this image at the top of the range.
	gamut: GamutReport;
	notes: Array<string>;
}

// A decoded RGBA pixel buffer — the input to analysis. The CALLER decodes (e.g.
// via freshcoat's `decodePixels`, which owns CanvasKit); for-print only reads the
// numbers. `data` is row-major RGBA; accepts either array flavor so a Canvas /
// CanvasKit / raw buffer all satisfy it.
export interface PixelData {
	readonly data: Uint8ClampedArray | Uint8Array;
	readonly width: number;
	readonly height: number;
}
