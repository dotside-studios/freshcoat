// The state behind a PaintCache, apart from paint-cache.ts so the public
// declarations need no CanvasKit types.

import type {
	Image,
	Paragraph,
	Path,
	Surface,
	TypefaceFontProvider,
} from "canvaskit-wasm";
import type { SvgPicture } from "./canvaskit";
import type { SharedFontProvider } from "./font-collection";
import {
	createLutImages,
	freeLutImages,
	type LutImages,
} from "./lut-images";
import type {
	PaintCache,
	PaintCacheOptions,
	PaintCacheStats,
} from "./paint-cache";
import type { CanvasLike } from "./runtime-types";
import type { PaintWarning } from "./types";

type FontKey = { family: string; bytes: Uint8Array }[];

export type ShapedLine = { para: Paragraph; ascent: number };

// A decoded image and, once a heavy downscale has asked for it, its mipmapped
// copy, freed together.
export type CachedImage = {
	image: Image | SvgPicture;
	mipped: Image | null;
};

// The pixels a paint's leading run of drawables left on its render surface,
// keyed by those drawables and the frame they were drawn into, with the
// warnings drawing them raised.
export type CachedBackground = {
	keys: string[];
	frame: string;
	pixels: Uint8Array;
	warnings: PaintWarning[];
};

// The dither noise of the finishing pass for one frame size, seed and mode.
export type CachedFinishNoise = {
	key: string;
	noise: Float32Array;
};

type CachedSurface = {
	surface: Surface;
	canvas: CanvasLike;
	loseContext: () => void;
	width: number;
	height: number;
	hosted: boolean;
};

const DEFAULT_MAX_IMAGES = 256;

const MAX_BACKGROUNDS = 4;

// What the backgrounds of a cache without an image budget may hold together:
// 64 MB of RGBA.
export const DEFAULT_MAX_BACKGROUND_PIXELS = 16_777_216;

// What an SVG picture costs beyond the rasters it embeds: its recorded ops.
export const SVG_PICTURE_PIXELS = 65_536;

export type PaintCacheState = {
	stats: PaintCacheStats;
	maxImagePixels: number;
	maxImages: number;
	// key is null for a provider the cache was lent rather than built.
	fonts: {
		key: FontKey | null;
		fonts: SharedFontProvider;
		generation: number;
	} | null;
	images: Map<string, CachedImage>;
	// Freed with the provider whose typefaces they use.
	lines: Map<string, ShapedLine>;
	linesUsed: Set<string>;
	paths: Map<string, Path>;
	pathsUsed: Set<string>;
	luts: LutImages;
	surface: CachedSurface | null;
	// Most recently used first.
	backgrounds: CachedBackground[];
	finishNoise: CachedFinishNoise | null;
	disposed: boolean;
};

// The state lives here rather than on the cache object so the public type stays
// three methods and nothing outside render-kit can reach into it.
const states = new WeakMap<PaintCache, PaintCacheState>();

export function newPaintCache(opts?: PaintCacheOptions): PaintCache {
	const state: PaintCacheState = {
		maxImagePixels: opts?.maxImagePixels ?? 0,
		maxImages: opts?.maxImages ?? DEFAULT_MAX_IMAGES,
		stats: {
			paints: 0,
			surfaceCreates: 0,
			fontProviderBuilds: 0,
			imageDecodes: 0,
			paragraphBuilds: 0,
			lutImageBuilds: 0,
			mipmapBuilds: 0,
			pathBuilds: 0,
			backgroundSnapshots: 0,
			backgroundReuses: 0,
			finishNoiseBuilds: 0,
		},
		fonts: null,
		images: new Map(),
		lines: new Map(),
		linesUsed: new Set(),
		paths: new Map(),
		pathsUsed: new Set(),
		luts: createLutImages(),
		surface: null,
		backgrounds: [],
		finishNoise: null,
		disposed: false,
	};
	const clear = () => {
		freeLines(state);
		freePaths(state);
		const fonts = state.fonts;
		state.fonts = null;
		if (fonts) tryFree(() => fonts.fonts.release());
		for (const entry of state.images.values()) freeImage(entry);
		state.images.clear();
		freeLutImages(state.luts);
		state.backgrounds = [];
		state.finishNoise = null;
		const surface = state.surface;
		state.surface = null;
		if (surface) releaseSurface(surface);
	};
	const cache: PaintCache = {
		clear,
		dispose() {
			clear();
			state.disposed = true;
		},
		stats: () => ({ ...state.stats, lutImageBuilds: state.luts.builds }),
	};
	states.set(cache, state);
	return cache;
}

// paintScene's handle on a cache. Throws for a disposed one, so a paint through
// it fails before it allocates anything the cache would then leak.
export function paintCacheState(cache: PaintCache): PaintCacheState {
	const state = states.get(cache);
	if (!state)
		throw new Error("render-kit: not a cache from createPaintCache()");
	if (state.disposed) throw new Error("render-kit: paint cache is disposed");
	return state;
}

// A built provider is keyed on the registered list itself, family and
// byte-array identity in order, so a caller that keeps its fonts map stable
// keeps its provider, whichever of those families a scene uses. A lent one is
// kept while it is the same provider with no faces added since.
export function cachedFontProvider(
	state: PaintCacheState,
	source:
		| { shared: SharedFontProvider }
		| { key: FontKey; build: () => SharedFontProvider },
): TypefaceFontProvider {
	const hit = state.fonts;
	if (
		hit &&
		("shared" in source
			? hit.fonts === source.shared &&
				hit.generation === source.shared.generation
			: hit.key !== null && sameFonts(hit.key, source.key))
	)
		return hit.fonts.provider;
	state.fonts = null;
	freeLines(state);
	if (hit) tryFree(() => hit.fonts.release());
	let fonts: SharedFontProvider;
	if ("shared" in source) {
		fonts = source.shared;
		fonts.retain();
	} else fonts = source.build();
	state.stats.fontProviderBuilds++;
	state.fonts = {
		key: "shared" in source ? null : [...source.key],
		fonts,
		generation: fonts.generation,
	};
	return fonts.provider;
}

function sameFonts(a: FontKey, b: FontKey): boolean {
	return (
		a.length === b.length &&
		a.every((f, i) => f.family === b[i]?.family && f.bytes === b[i]?.bytes)
	);
}

// Reused only when it was made the same way (for a host canvas, or offscreen)
// at the same device size; anything else replaces it.
export function cachedSurface(
	state: PaintCacheState,
	want: { width: number; height: number; hosted: boolean },
	make: () => {
		surface: Surface;
		canvas: CanvasLike;
		loseContext: () => void;
	},
): CachedSurface {
	const hit = state.surface;
	if (
		hit &&
		hit.width === want.width &&
		hit.height === want.height &&
		hit.hosted === want.hosted
	)
		return hit;
	state.surface = null;
	if (hit) releaseSurface(hit);
	const made = make();
	state.stats.surfaceCreates++;
	state.surface = { ...made, ...want };
	return state.surface;
}

// Deletes the cached images this paint's scene did not use, oldest first, until
// what is left fits the cache's image budget and entry cap. Backgrounds, cheaper
// to redraw than an image is to decode, go least recently used first until they
// fit beside them, then the finish noise.
export function evictUnusedImages(
	state: PaintCacheState,
	used: string[],
): void {
	const keep = new Set(used);
	for (const src of keep) {
		const entry = state.images.get(src);
		if (!entry) continue;
		state.images.delete(src);
		state.images.set(src, entry);
	}
	let total = 0;
	if (state.maxImagePixels > 0)
		for (const entry of state.images.values()) total += imagePixels(entry);
	for (const [src, entry] of state.images) {
		if (keep.has(src)) continue;
		if (
			state.maxImagePixels > 0 &&
			total <= state.maxImagePixels &&
			state.images.size <= state.maxImages
		)
			break;
		state.images.delete(src);
		total -= imagePixels(entry);
		freeImage(entry);
	}
	if (state.maxImagePixels <= 0) return;
	let held = total + finishNoisePixels(state);
	for (const bg of state.backgrounds) held += backgroundPixels(bg);
	while (held > state.maxImagePixels) {
		const bg = state.backgrounds.pop();
		if (!bg) break;
		held -= backgroundPixels(bg);
	}
	if (total + finishNoisePixels(state) > state.maxImagePixels)
		state.finishNoise = null;
}

// The background at `frame` sharing the longest leading run with `keys`, the
// more recently used on a tie.
export function closestBackground(
	state: PaintCacheState,
	frame: string,
	keys: string[],
): { held: CachedBackground; shared: number } | null {
	let best: { held: CachedBackground; shared: number } | null = null;
	for (const held of state.backgrounds) {
		if (held.frame !== frame) continue;
		const shared = sharedLength(held.keys, keys);
		if (!best || shared > best.shared) best = { held, shared };
	}
	return best;
}

export function touchBackground(
	state: PaintCacheState,
	background: CachedBackground,
): void {
	const at = state.backgrounds.indexOf(background);
	if (at > 0) {
		state.backgrounds.splice(at, 1);
		state.backgrounds.unshift(background);
	}
	state.stats.backgroundReuses++;
}

// Whether a background of `pixels` fits beside the images and finish noise the
// budget also holds, so a paint reads back only what it can keep.
export function backgroundFits(
	state: PaintCacheState,
	pixels: number,
): boolean {
	if (state.maxImagePixels <= 0) return pixels <= DEFAULT_MAX_BACKGROUND_PIXELS;
	return (
		imagesPixels(state) + finishNoisePixels(state) + pixels <=
		state.maxImagePixels
	);
}

// Keeps `background` as the most recently used, in place of `replaces` when
// given, else beside the others. The least recently used go past the cap, or
// until the rest fit the image budget or, without one, the default cap.
export function cacheBackground(
	state: PaintCacheState,
	background: CachedBackground,
	replaces: CachedBackground | null,
): void {
	const at = replaces ? state.backgrounds.indexOf(replaces) : -1;
	if (at >= 0) state.backgrounds.splice(at, 1);
	state.backgrounds.unshift(background);
	if (state.backgrounds.length > MAX_BACKGROUNDS)
		state.backgrounds.length = MAX_BACKGROUNDS;
	state.stats.backgroundSnapshots++;
	const budgeted = state.maxImagePixels > 0;
	const limit = budgeted ? state.maxImagePixels : DEFAULT_MAX_BACKGROUND_PIXELS;
	let held = budgeted ? imagesPixels(state) + finishNoisePixels(state) : 0;
	for (const bg of state.backgrounds) held += backgroundPixels(bg);
	while (state.backgrounds.length > 1 && held > limit)
		held -= backgroundPixels(state.backgrounds.pop() as CachedBackground);
}

function sharedLength(a: string[], b: string[]): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

// Keeps the noise of one frame, replacing any other. With an image budget it
// counts against that budget (see evictUnusedImages).
export function cacheFinishNoise(
	state: PaintCacheState,
	noise: CachedFinishNoise,
): void {
	state.finishNoise = noise;
	state.stats.finishNoiseBuilds++;
}

// In pixels of 8-bit RGBA: a float of noise takes the bytes of one.
function finishNoisePixels(state: PaintCacheState): number {
	return state.finishNoise ? state.finishNoise.noise.length : 0;
}

function backgroundPixels(background: CachedBackground): number {
	return background.pixels.length / 4;
}

function imagesPixels(state: PaintCacheState): number {
	let total = 0;
	for (const entry of state.images.values()) total += imagePixels(entry);
	return total;
}

function imagePixels(entry: CachedImage): number {
	const { image, mipped } = entry;
	if ("rasterPixels" in image) return SVG_PICTURE_PIXELS + image.rasterPixels;
	const pixels = image.width() * image.height();
	return mipped ? Math.ceil((pixels * 4) / 3) : pixels;
}

// The mipmapped copy of a cached image, built on first use. null when `image`
// is not the one cached under `src`.
export function cachedMipmaps(
	state: PaintCacheState,
	src: string,
	image: Image | SvgPicture,
	build: () => Image,
): Image | null {
	const entry = state.images.get(src);
	if (!entry || entry.image !== image) return null;
	if (!entry.mipped) {
		entry.mipped = build();
		state.stats.mipmapBuilds++;
	}
	return entry.mipped;
}

// Drops a decoded image and every background that drew it, so the next paint
// decodes `src` again from whatever bytes it is given.
export function forgetImage(state: PaintCacheState, src: string): void {
	const entry = state.images.get(src);
	if (entry) {
		state.images.delete(src);
		freeImage(entry);
	}
	const key = JSON.stringify(src);
	state.backgrounds = state.backgrounds.filter(
		(bg) => !bg.keys.some((k) => k.includes(key)),
	);
}

function freeImage(entry: CachedImage): void {
	const { image, mipped } = entry;
	if (mipped) tryFree(() => mipped.delete());
	tryFree(() => image.delete());
}

export function cachedLine(
	state: PaintCacheState,
	key: string,
	build: () => ShapedLine,
): ShapedLine {
	state.linesUsed.add(key);
	const hit = state.lines.get(key);
	if (hit) return hit;
	const line = build();
	state.stats.paragraphBuilds++;
	state.lines.set(key, line);
	return line;
}

export function evictUnusedLines(state: PaintCacheState): void {
	for (const [key, line] of state.lines) {
		if (state.linesUsed.has(key)) continue;
		state.lines.delete(key);
		tryFree(() => line.para.delete());
	}
	state.linesUsed.clear();
}

// A path parsed once per key and reused by every paint that draws it. Callers
// must not mutate it.
export function cachedPath(
	state: PaintCacheState,
	key: string,
	build: () => Path | null,
): Path | null {
	state.pathsUsed.add(key);
	const hit = state.paths.get(key);
	if (hit) return hit;
	const path = build();
	if (!path) return path;
	state.stats.pathBuilds++;
	state.paths.set(key, path);
	return path;
}

export function evictUnusedPaths(state: PaintCacheState): void {
	for (const [key, path] of state.paths) {
		if (state.pathsUsed.has(key)) continue;
		state.paths.delete(key);
		tryFree(() => path.delete());
	}
	state.pathsUsed.clear();
}

function freePaths(state: PaintCacheState): void {
	for (const path of state.paths.values()) tryFree(() => path.delete());
	state.paths.clear();
	state.pathsUsed.clear();
}

function freeLines(state: PaintCacheState): void {
	for (const line of state.lines.values()) tryFree(() => line.para.delete());
	state.lines.clear();
	state.linesUsed.clear();
}

function releaseSurface(s: CachedSurface): void {
	tryFree(() => s.surface.dispose());
	tryFree(s.loseContext);
}

function tryFree(free: () => void): void {
	try {
		free();
	} catch {}
}
