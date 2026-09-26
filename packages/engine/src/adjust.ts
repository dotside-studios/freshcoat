// Generic, domain-neutral per-layer color/tone adjustment — freshcoat's
// vocabulary for "transform this layer's pixels as it composites", the same way
// `opacity`, `blendMode`, and `blur` already are. It knows the MATH (color
// matrix, per-channel curve, sharpen), never the INTENT: color correction,
// theming, accessibility contrast, and preview effects all drive the same
// primitive. A consumer maps its own domain policy down to an `Adjust`; freshcoat
// applies it without knowing why.
//
// The primitive is the closure of per-pixel color transforms: a 4×5 color matrix
// (cross-channel — saturation/brightness/contrast) applied FIRST, then a
// per-channel LUT (nonlinear curves — gamma), matching SVG's
// feColorMatrix-then-feComponentTransfer ordering. `sharpen` is a spatial
// post-filter, a sibling of `blur`. Every field is optional; absent = identity.
//
// The matrix follows Skia's SkColorMatrix convention: 20 floats, row-major RGBA
// rows, and the 5th (translation) column expressed as a fraction of full scale
// ([0,1]), NOT 0–255.

import type { Adjust, AdjustLut, AdjustLut3d } from "./types";

// Rec.709 luma coefficients — the standard luminance weights used to keep a
// saturation change perceptually neutral.
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// Contrast pivots on the 8-bit midpoint 128 (in 0–255 space); normalized for the
// color matrix that is 128/255, not 0.5.
const PIVOT = 128 / 255;

export type ColorMatrix = number[]; // length 20, row-major RGBA + bias column

export function identityColorMatrix(): ColorMatrix {
	// biome-ignore format: matrix rows read clearer aligned
	return [
		1, 0, 0, 0, 0,
		0, 1, 0, 0, 0,
		0, 0, 1, 0, 0,
		0, 0, 0, 1, 0,
	];
}

// concat(outer, inner): the matrix that applies `inner` first, then `outer` — so
// concat(contrast, saturation) saturates then contrasts. Both are 4×5 affine
// color matrices; we extend each to 5×5 with an implicit [0,0,0,0,1] last row and
// multiply outer · innerExt.
export function concatColorMatrix(
	outer: ColorMatrix,
	inner: ColorMatrix,
): ColorMatrix {
	const out = new Array<number>(20).fill(0);
	for (let row = 0; row < 4; row++) {
		for (let col = 0; col < 5; col++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) {
				sum += outer[row * 5 + k] * inner[k * 5 + col];
			}
			// The extended 5th row of `inner` is [0,0,0,0,1], so it contributes only
			// to the bias (col 4) via outer's own bias term.
			if (col === 4) sum += outer[row * 5 + 4];
			out[row * 5 + col] = sum;
		}
	}
	return out;
}

// Saturation as a color matrix: gray + s·(channel − gray), gray = luma. s=1 is
// identity, s=0 fully desaturates, s>1 boosts.
export function saturationMatrix(s: number): ColorMatrix {
	const ir = (1 - s) * LUMA_R;
	const ig = (1 - s) * LUMA_G;
	const ib = (1 - s) * LUMA_B;
	// biome-ignore format: matrix rows read clearer aligned
	return [
		ir + s, ig,     ib,     0, 0,
		ir,     ig + s, ib,     0, 0,
		ir,     ig,     ib + s, 0, 0,
		0,      0,      0,      1, 0,
	];
}

// Contrast about the 128/255 pivot: v' = c·(v − pivot) + pivot.
export function contrastMatrix(c: number): ColorMatrix {
	const b = PIVOT * (1 - c);
	// biome-ignore format: matrix rows read clearer aligned
	return [
		c, 0, 0, 0, b,
		0, c, 0, 0, b,
		0, 0, c, 0, b,
		0, 0, 0, 1, 0,
	];
}

// Brightness as a straight multiplier (v' = v·k); identity at k=1.
export function brightnessMatrix(k: number): ColorMatrix {
	// biome-ignore format: matrix rows read clearer aligned
	return [
		k, 0, 0, 0, 0,
		0, k, 0, 0, 0,
		0, 0, k, 0, 0,
		0, 0, 0, 1, 0,
	];
}

// Per-channel gamma curve as a 256-entry LUT: out = round(255·(i/255)^gamma),
// clamped. r/g/b share one table.
export function gammaLut(gamma: number): AdjustLut {
	const table = new Uint8Array(256);
	for (let i = 0; i < 256; i++) {
		const v = Math.round(255 * (i / 255) ** gamma);
		table[i] = v < 0 ? 0 : v > 255 ? 255 : v;
	}
	return { r: table, g: table, b: table };
}

// An identity RGB cube, useful as a starting point for an authored or measured
// device transform. The table format is shared with Adjust.lut3d (r-fast RGB
// triplets), deliberately independent of any print/profile vocabulary.
export function identityLut3d(size: number): AdjustLut3d {
	if (!Number.isInteger(size) || size < 2) {
		throw new Error("identityLut3d: size must be an integer of at least 2");
	}
	const data = new Uint8Array(size * size * size * 3);
	const level = (i: number) => Math.round((i / (size - 1)) * 255);
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const at = ((b * size + g) * size + r) * 3;
				data[at] = level(r);
				data[at + 1] = level(g);
				data[at + 2] = level(b);
			}
		}
	}
	return { size, data };
}

export type AdjustOptions = {
	saturation?: number; // 1 = none
	contrast?: number; // 1 = none
	brightness?: number; // 1 = none
	gamma?: number; // 1 = none
	sharpen?: number; // 0 = none
	// Map colors the matrix drove out of range back by chroma instead of clipping
	// each channel (see Adjust.gamut). Worth setting whenever saturation or contrast
	// is boosted on saturated source colors.
	preserveHue?: boolean;
};

const isMatrixIdentity = (m: ColorMatrix): boolean => {
	const id = identityColorMatrix();
	for (let i = 0; i < 20; i++) if (Math.abs(m[i] - id[i]) > 1e-9) return false;
	return true;
};

// Build an `Adjust` from semantic knobs. Cross-channel/linear ops fold into one
// color matrix, applied in order (saturation → contrast → brightness); gamma
// becomes the LUT applied after; sharpen passes through. Fields that are at their
// identity value are omitted, so `buildAdjust({})` is `{}` (a no-op).
export function buildAdjust(o: AdjustOptions): Adjust {
	let m = identityColorMatrix();
	if (o.saturation !== undefined && o.saturation !== 1)
		m = concatColorMatrix(saturationMatrix(o.saturation), m);
	if (o.contrast !== undefined && o.contrast !== 1)
		m = concatColorMatrix(contrastMatrix(o.contrast), m);
	if (o.brightness !== undefined && o.brightness !== 1)
		m = concatColorMatrix(brightnessMatrix(o.brightness), m);

	const adjust: Adjust = {};
	if (!isMatrixIdentity(m)) {
		adjust.colorMatrix = m;
		// Only a matrix leaves the range, so the mode is meaningless without one.
		if (o.preserveHue) adjust.gamut = "preserve-hue";
	}
	if (o.gamma !== undefined && o.gamma !== 1) adjust.lut = gammaLut(o.gamma);
	if (o.sharpen !== undefined && o.sharpen > 0) adjust.sharpen = o.sharpen;
	return adjust;
}
