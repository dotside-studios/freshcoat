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
// clamped. r/g/b share one table. Equal gammas return the same table, so the
// painter's LUT image cache hits by identity; treat it as read-only.
export function gammaLut(gamma: number): AdjustLut {
	return memoLru(gammaMemo, GAMMA_MEMO_MAX, gamma, () => {
		const table = new Uint8Array(256);
		for (let i = 0; i < 256; i++) {
			const v = Math.round(255 * (i / 255) ** gamma);
			table[i] = v < 0 ? 0 : v > 255 ? 255 : v;
		}
		return { r: table, g: table, b: table };
	});
}

const gammaMemo = new Map<number, AdjustLut>();
const GAMMA_MEMO_MAX = 64;
const bakeMemo = new Map<string, AdjustLut3d>();
const BAKE_MEMO_MAX = 16;

function memoLru<K, V>(
	memo: Map<K, V>,
	max: number,
	key: K,
	build: () => V,
): V {
	const hit = memo.get(key);
	if (hit) {
		memo.delete(key);
		memo.set(key, hit);
		return hit;
	}
	const value = build();
	memo.set(key, value);
	if (memo.size > max) memo.delete(memo.keys().next().value as K);
	return value;
}

const tableIds = new WeakMap<object, number>();
let nextTableId = 0;

function tableId(table: object | undefined): number | string {
	if (!table) return "-";
	let id = tableIds.get(table);
	if (id === undefined) {
		id = nextTableId++;
		tableIds.set(table, id);
	}
	return id;
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

const hasColor = (a: Adjust): boolean =>
	!!(a.colorMatrix || a.lut || a.lut3d);

// The cube size composeAdjust bakes a second adjustment into.
const COMPOSE_CUBE = 33;

// One `Adjust` that looks like `first` and then `second` applied to its result.
// A node carries a single adjustment, so a layer that already has one (an
// authored tone change, say) and gains another (a print correction) needs the
// two folded together. `first` keeps its own matrix and curve; `second`, and
// any cube `first` had, are baked into the 3D LUT that runs after them. The
// stronger of the two sharpens is kept, since it is a spatial pass that cannot
// be chained per pixel.
export function composeAdjust(
	first: Adjust | undefined,
	second: Adjust | undefined,
): Adjust {
	if (!first || Object.keys(first).length === 0) return { ...second };
	if (!second || Object.keys(second).length === 0) return { ...first };
	const sharpen = Math.max(first.sharpen ?? 0, second.sharpen ?? 0);
	const out: Adjust = hasColor(second)
		? hasColor(first)
			? {
					...(first.colorMatrix ? { colorMatrix: first.colorMatrix } : {}),
					...(first.gamut ? { gamut: first.gamut } : {}),
					...(first.lut ? { lut: first.lut } : {}),
					lut3d: composedCube(first.lut3d, second),
				}
			: withoutSharpen(second)
		: withoutSharpen(first);
	if (sharpen > 0) out.sharpen = sharpen;
	return out;
}

// Keyed by the second adjustment's color parameters and the tables' identities,
// so equal settings return the same cube across compiles.
function composedCube(
	cube: AdjustLut3d | undefined,
	second: Adjust,
): AdjustLut3d {
	const size = Math.max(cube?.size ?? 0, COMPOSE_CUBE);
	const key = [
		size,
		cube ? `${cube.size}:${tableId(cube.data)}` : "-",
		second.colorMatrix?.join(",") ?? "-",
		second.gamut ?? "-",
		second.lut
			? `${tableId(second.lut.r)},${tableId(second.lut.g)},${tableId(second.lut.b)}`
			: "-",
		second.lut3d
			? `${second.lut3d.size}:${tableId(second.lut3d.data)}`
			: "-",
	].join("|");
	return memoLru(bakeMemo, BAKE_MEMO_MAX, key, () =>
		bakeLut3d(size, (rgb) =>
			applyAdjustColor(second, cube ? sampleLut3d(cube, rgb) : rgb),
		),
	);
}

function withoutSharpen(a: Adjust): Adjust {
	const { sharpen: _sharpen, ...rest } = a;
	return rest;
}

type Rgb = [number, number, number];

// The per-pixel part of an adjustment on one unpremultiplied colour in [0, 1],
// in the painter's order: matrix, gamut, curve, cube.
export function applyAdjustColor(a: Adjust, rgb: Rgb): Rgb {
	let c: Rgb = [rgb[0], rgb[1], rgb[2]];
	const m = a.colorMatrix;
	if (m) {
		const row = (i: number) =>
			m[i] * c[0] + m[i + 1] * c[1] + m[i + 2] * c[2] + m[i + 3] + m[i + 4];
		c = [row(0), row(5), row(10)];
	}
	c = a.gamut === "preserve-hue" ? fitGamut(c) : clampRgb(c);
	if (a.lut) {
		const at = (t: Uint8Array, v: number) => t[Math.round(v * 255)] / 255;
		c = [at(a.lut.r, c[0]), at(a.lut.g, c[1]), at(a.lut.b, c[2])];
	}
	if (a.lut3d) c = sampleLut3d(a.lut3d, c);
	return clampRgb(c);
}

function clampRgb(c: Rgb): Rgb {
	return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

function fitGamut(c: Rgb): Rgb {
	const l = clamp01(LUMA_R * c[0] + LUMA_G * c[1] + LUMA_B * c[2]);
	const scale = (v: number) => {
		const d = v - l;
		if (v > 1 && d > 0) return (1 - l) / d;
		if (v < 0 && d < 0) return -l / d;
		return 1;
	};
	const t = Math.min(scale(c[0]), scale(c[1]), scale(c[2]));
	return clampRgb([l + (c[0] - l) * t, l + (c[1] - l) * t, l + (c[2] - l) * t]);
}

function sampleLut3d(lut: AdjustLut3d, rgb: Rgb): Rgb {
	const { size, data } = lut;
	const top = size - 1;
	const f = rgb.map((v) => clamp01(v) * top) as Rgb;
	const lo = f.map(Math.floor) as Rgb;
	const hi = lo.map((v) => Math.min(v + 1, top)) as Rgb;
	const t = f.map((v, i) => v - lo[i]) as Rgb;
	const at = (r: number, g: number, b: number, ch: number) =>
		data[((b * size + g) * size + r) * 3 + ch] / 255;
	const mix = (a: number, b: number, k: number) => a + (b - a) * k;
	const edge = (g: number, b: number, ch: number) =>
		mix(at(lo[0], g, b, ch), at(hi[0], g, b, ch), t[0]);
	const out: Rgb = [0, 0, 0];
	for (let ch = 0; ch < 3; ch++) {
		const near = mix(edge(lo[1], lo[2], ch), edge(hi[1], lo[2], ch), t[1]);
		const far = mix(edge(lo[1], hi[2], ch), edge(hi[1], hi[2], ch), t[1]);
		out[ch] = mix(near, far, t[2]);
	}
	return out;
}

function bakeLut3d(size: number, fn: (rgb: Rgb) => Rgb): AdjustLut3d {
	const data = new Uint8Array(size * size * size * 3);
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const c = fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
				const at = ((b * size + g) * size + r) * 3;
				data[at] = Math.round(c[0] * 255);
				data[at + 1] = Math.round(c[1] * 255);
				data[at + 2] = Math.round(c[2] * 255);
			}
		}
	}
	return { size, data };
}
