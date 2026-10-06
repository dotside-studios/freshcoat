import {
	type ColorMatrix,
	concatColorMatrix,
	contrastMatrix,
	identityColorMatrix,
	saturationMatrix,
} from "@freshcoat-js/engine";
import { detectOrientation } from "./geometry";
import type {
	GamutReport,
	ImageAnalysis,
	PixelData,
	PrintOptimizeOptions,
} from "./types";

// The cross-channel half of a correction — saturation then contrast — as one
// matrix, or null when both are identity. Shared with the planner so a measurement
// and the render it describes can never diverge.
export function correctionMatrix(o: PrintOptimizeOptions): ColorMatrix | null {
	let m = identityColorMatrix();
	let touched = false;
	if (o.saturation !== 1) {
		m = concatColorMatrix(saturationMatrix(o.saturation), m);
		touched = true;
	}
	if (o.contrast !== 1) {
		m = concatColorMatrix(contrastMatrix(o.contrast), m);
		touched = true;
	}
	return touched ? m : null;
}

// Rec.709 luma, the axis chroma is scaled toward.
const LUMA = [0.2126, 0.7152, 0.0722] as const;

// The largest factor in [0,1] that brings one channel back inside [0,1] when the
// color is scaled toward `l`. Mirrors the shader's fitScale (see freshcoat's
// adjust pass) so the number reported is the pullback actually rendered.
function fitScale(v: number, l: number): number {
	const d = v - l;
	if (v > 1 && d > 0) return (1 - l) / d;
	if (v < 0 && d < 0) return -l / d;
	return 1;
}

// Measure what a correction costs at the top of the range: how much of the image
// it drives past full scale, and how much chroma comes back to fit. Reports the
// pressure itself, so the answer is the same whether the render clips or
// preserves hue.
export function measureGamut(
	pixels: PixelData,
	opts: PrintOptimizeOptions,
): GamutReport {
	const m = correctionMatrix(opts);
	const { data } = pixels;
	const total = data.length / 4;
	if (!m || total === 0) return { clipped: 0, pullback: 0 };

	let clipped = 0;
	let pullbackSum = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;
		const r2 = m[0] * r + m[1] * g + m[2] * b + m[4];
		const g2 = m[5] * r + m[6] * g + m[7] * b + m[9];
		const b2 = m[10] * r + m[11] * g + m[12] * b + m[14];
		if (r2 >= 0 && r2 <= 1 && g2 >= 0 && g2 <= 1 && b2 >= 0 && b2 <= 1) {
			continue;
		}
		clipped++;
		const l = Math.min(
			1,
			Math.max(0, LUMA[0] * r2 + LUMA[1] * g2 + LUMA[2] * b2),
		);
		const t = Math.min(fitScale(r2, l), fitScale(g2, l), fitScale(b2, l));
		pullbackSum += 1 - t;
	}
	return {
		clipped: clipped / total,
		pullback: clipped === 0 ? 0 : pullbackSum / clipped,
	};
}

// Robust brightness statistics from a decoded RGBA buffer. Percentiles (from a
// 256-bin histogram) instead of a mean + std-dev: the mean lies on the images
// that matter most — a dark subject on a bright ground averages to a middling
// value that misrepresents both, and a high-key shot reads as "needs darkening"
// when it's deliberately bright. The median is the robust typical level, the p5/
// p95 tails expose crushed shadows / clipping highlights, and their spread is a
// far more interpretable contrast measure than a std-dev.
export type ImageStats = {
	meanBrightness: number;
	medianBrightness: number; // p50 — the robust "typical" level
	shadow: number; // p5 — how dense the darkest content already is
	highlight: number; // p95 — how close highlights are to clipping
	avgSaturation: number;
	contrast: number; // (p95 − p5) / 255 — perceptual tonal spread, 0..1
};

// The i-th value where the cumulative histogram first reaches p·total.
function percentile(hist: Uint32Array, total: number, p: number): number {
	const target = p * total;
	let cum = 0;
	for (let i = 0; i < 256; i++) {
		cum += hist[i];
		if (cum >= target) return i;
	}
	return 255;
}

// Compute robust statistics in a single pass — one fixed 256-int histogram, no
// per-pixel array (the old approach pushed every pixel's brightness into a growing
// list, millions of floats for a full-res photo).
export function analyzeStats(pixels: PixelData): ImageStats {
	const { data, width, height } = pixels;
	const pixelCount = width * height;
	if (pixelCount === 0) {
		return {
			meanBrightness: 0,
			medianBrightness: 0,
			shadow: 0,
			highlight: 0,
			avgSaturation: 0,
			contrast: 0,
		};
	}

	const hist = new Uint32Array(256);
	let totalBrightness = 0;
	let totalSaturation = 0;

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];

		const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		totalBrightness += brightness;
		hist[Math.min(255, Math.max(0, Math.round(brightness)))]++;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2 / 255;
		const sat =
			max === min ? 0 : (max - min) / 255 / (l <= 0.5 ? 2 * l : 2 - 2 * l);
		totalSaturation += Math.min(sat, 1);
	}

	const shadow = percentile(hist, pixelCount, 0.05);
	const highlight = percentile(hist, pixelCount, 0.95);
	return {
		meanBrightness: totalBrightness / pixelCount,
		medianBrightness: percentile(hist, pixelCount, 0.5),
		shadow,
		highlight,
		avgSaturation: totalSaturation / pixelCount,
		contrast: (highlight - shadow) / 255,
	};
}

// Inspect a decoded RGBA buffer and recommend print-optimization settings. Pure —
// the caller decodes (e.g. via freshcoat's `decodePixels`, optionally rendering
// the layer as it appears on the card); for-print never touches a canvas.
// `imageWidth`/`imageHeight` reflect the buffer you pass.
export function analyzePixels(pixels: PixelData): ImageAnalysis {
	const stats = analyzeStats(pixels);
	const { recommendation, notes } = buildRecommendation(stats);

	const detectedOrientation = detectOrientation(pixels.width, pixels.height);
	notes.unshift(
		`Buffer is ${pixels.width}x${pixels.height} — ${detectedOrientation} orientation`,
	);

	const gamut = measureGamut(pixels, recommendation);
	if (gamut.clipped > 0) {
		notes.push(
			`${Math.round(gamut.clipped * 100)}% of this image is too saturated for the correction to keep — ` +
				`pulled back ${Math.round(gamut.pullback * 100)}% there to hold the hue`,
		);
	}

	return {
		avgBrightness: stats.meanBrightness,
		avgSaturation: stats.avgSaturation,
		contrast: stats.contrast,
		detectedOrientation,
		imageWidth: pixels.width,
		imageHeight: pixels.height,
		recommendation,
		gamut,
		notes,
	};
}

// Pure: derive recommended print settings from robust image statistics. Brightness
// decisions key off the median (not the mean), with explicit guards for the tails —
// protect near-clipping highlights, and ease off darkening when shadows are already
// crushed. Contrast keys off the p5–p95 spread.
export function buildRecommendation(stats: ImageStats): {
	recommendation: PrintOptimizeOptions;
	notes: Array<string>;
} {
	const {
		medianBrightness: mid,
		shadow,
		highlight,
		avgSaturation,
		contrast,
	} = stats;
	const notes: Array<string> = [];
	let saturation = 1.0;
	let contrastMul = 1.0;
	let gamma = 1.0;
	const sharpness = 0.3;
	let darkness = 0.0;

	// Pastel/light designs: bright, desaturated, low tonal spread.
	const isPastel = mid > 180 && avgSaturation < 0.3 && contrast < 0.3;

	// Saturated designed art — a brand gradient or flat vector ground rather than a
	// photograph. The intersection of the two buckets below that would otherwise
	// fire hardest on it: already at the top saturation bucket, and inside the
	// low-spread contrast bucket. Its narrow luma spread is one hue sitting in a
	// band, not a flat exposure, so the boosts those buckets prescribe are aimed at
	// a problem it doesn't have and push its leading channel past full scale.
	const isBrandArt = avgSaturation > 0.55 && contrast < 0.35;

	if (isPastel) {
		saturation = 1.2;
		gamma = 0.92;
		darkness = 0.1;
		contrastMul = 1.1;
		notes.push(
			"Pastel/light design detected — using gentle settings to preserve subtle colors",
		);
		notes.push(
			"Tip: adjust darkness slider manually to taste, heavy overlay will shift delicate tones",
		);
	} else {
		// --- Saturation ---
		if (isBrandArt) {
			saturation = 1.0;
			notes.push(
				"Saturated brand art — already dense, no saturation boost applied",
			);
		} else if (avgSaturation < 0.2) {
			saturation = 1.45;
			notes.push("Very low saturation — aggressive boost needed for dye-sub");
		} else if (avgSaturation < 0.35) {
			saturation = 1.35;
			notes.push("Low saturation — strong boost for dye-sub");
		} else if (avgSaturation < 0.55) {
			saturation = 1.25;
			notes.push("Moderate saturation — standard dye-sub boost");
		} else {
			saturation = 1.15;
			notes.push("Good saturation — light dye-sub compensation");
		}

		// --- Brightness / darkness (median-driven) ---
		if (mid > 200) {
			gamma = 0.85;
			darkness = 0.3;
			notes.push("Very bright image — 30% overlay + gamma to prevent washout");
		} else if (mid > 160) {
			gamma = 0.85;
			darkness = 0.2;
			notes.push("Bright image — 20% overlay + gamma for dye-sub");
		} else if (mid > 120) {
			gamma = 0.88;
			darkness = 0.15;
			notes.push("Moderate brightness — light overlay + gamma");
		} else if (mid < 60) {
			gamma = 0.95;
			darkness = 0.0;
			notes.push("Dark image — minimal adjustment, already dense");
		} else {
			gamma = 0.9;
			darkness = 0.1;
			notes.push("Medium-dark image — light dye-sub compensation");
		}

		// Highlight guard: a bright subject on a mid ground has a moderate median but
		// blown highlights — add a touch of darkening to hold them even so.
		if (highlight > 248 && darkness < 0.15) {
			darkness = 0.15;
			notes.push("Highlights near clipping — light overlay to hold detail");
		}
		// Shadow guard: if the darkest content is already dense, ease off darkening so
		// shadow detail survives the dye-sub compression.
		if (shadow < 12 && darkness > 0.1) {
			darkness = 0.1;
			notes.push("Shadows already dense — easing darkening to keep detail");
		}

		// --- Contrast (p5–p95 spread) ---
		if (isBrandArt) {
			contrastMul = 1.05;
			notes.push(
				"Narrow spread is the hue, not flatness — minimal contrast boost",
			);
		} else if (contrast < 0.35) {
			contrastMul = 1.3;
			notes.push("Low tonal spread — strong contrast boost to add definition");
		} else if (contrast < 0.6) {
			contrastMul = 1.2;
			notes.push("Moderate tonal spread — standard contrast boost");
		} else {
			contrastMul = 1.1;
			notes.push("Wide tonal spread — light compensation for dye spread");
		}
	}

	return {
		recommendation: {
			saturation,
			contrast: contrastMul,
			gamma,
			sharpness,
			darkness,
		},
		notes,
	};
}
