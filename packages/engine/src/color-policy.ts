import type {
	Canvas,
	CanvasKit,
	ImageInfo,
	Surface,
} from "canvaskit-wasm";

// The bit depth of the engine's intermediate surfaces (see README "Color
// policy"). "u8" composites in RGBA_8888 everywhere; "f16" composites the scene
// and its offscreen layers in RGBA_F16 and quantizes to 8 bits once, at the
// output surface.
export type Precision = "u8" | "f16";

export const DEFAULT_PRECISION: Precision = "u8";

// What a buffer holds, which decides its color type and alpha type:
// - layer: a premultiplied working surface the scene draws into
// - output: the final frame, always 8-bit whatever the working precision
// - pixels: unpremultiplied 8-bit RGBA crossing the WASM boundary (bitmaps,
//   LUT texels, readback for encoding)
// - opaque: like pixels, with alpha known to be 255 (JPEG input)
// - float: unpremultiplied float32 for values read back as numbers
export type BufferRole = "layer" | "output" | "pixels" | "opaque" | "float";

export function resolvePrecision(precision: unknown): Precision {
	return precision === "f16" ? "f16" : DEFAULT_PRECISION;
}

export function imageInfo(
	ck: CanvasKit,
	role: BufferRole,
	width: number,
	height: number,
	precision: Precision = DEFAULT_PRECISION,
): ImageInfo {
	const colorType =
		role === "float"
			? ck.ColorType.RGBA_F32
			: role === "layer" && precision === "f16"
				? ck.ColorType.RGBA_F16
				: ck.ColorType.RGBA_8888;
	const alphaType =
		role === "layer" || role === "output"
			? ck.AlphaType.Premul
			: role === "opaque"
				? ck.AlphaType.Opaque
				: ck.AlphaType.Unpremul;
	return {
		width,
		height,
		colorType,
		alphaType,
		colorSpace: ck.ColorSpace.SRGB,
	};
}

// An intermediate layer derived from `canvas`, so it stays on the same backend
// (GPU under WebGL).
export function makeLayerSurface(
	ck: CanvasKit,
	canvas: Canvas,
	width: number,
	height: number,
	precision: Precision = DEFAULT_PRECISION,
): Surface | null {
	return canvas.makeSurface(imageInfo(ck, "layer", width, height, precision));
}

export function makeImageFromPixels(
	ck: CanvasKit,
	role: "pixels" | "opaque",
	width: number,
	height: number,
	pixels: Uint8Array,
) {
	return ck.MakeImage(imageInfo(ck, role, width, height), pixels, width * 4);
}
