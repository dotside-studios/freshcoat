// An opt-in cache a runtime carries across paints of the same scene, for an
// interactive caller that repaints many times a second. It keeps the three things
// paintScene would otherwise rebuild on every paint: the font provider, the
// decoded images and the output surface. A runtime without one paints exactly as
// it always has, building and freeing all three per paint.

import type { CanvasLike } from "./types";

export type PaintCacheStats = {
	paints: number;
	surfaceCreates: number;
	fontProviderBuilds: number;
	imageDecodes: number;
};

export type PaintCache = {
	// Frees everything held. The next paint rebuilds it.
	clear(): void;
	// clear(), and a later paint through this cache throws.
	dispose(): void;
	stats(): PaintCacheStats;
};

// biome-ignore lint/suspicious/noExplicitAny: external WASM API, untyped
type CK = any;

type FontKey = { family: string; bytes: Uint8Array }[];

type CachedSurface = {
	surface: CK;
	canvas: CanvasLike;
	loseContext: () => void;
	width: number;
	height: number;
	hosted: boolean;
};

export type PaintCacheState = {
	stats: PaintCacheStats;
	fonts: { key: FontKey; provider: CK } | null;
	images: Map<string, CK>;
	surface: CachedSurface | null;
	disposed: boolean;
};

// The state lives here rather than on the cache object so the public type stays
// three methods and nothing outside render-kit can reach into it.
const states = new WeakMap<PaintCache, PaintCacheState>();

export function createPaintCache(): PaintCache {
	const state: PaintCacheState = {
		stats: {
			paints: 0,
			surfaceCreates: 0,
			fontProviderBuilds: 0,
			imageDecodes: 0,
		},
		fonts: null,
		images: new Map(),
		surface: null,
		disposed: false,
	};
	const clear = () => {
		const fonts = state.fonts;
		state.fonts = null;
		if (fonts) tryFree(() => fonts.provider.delete());
		for (const img of state.images.values()) tryFree(() => img.delete());
		state.images.clear();
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
		stats: () => ({ ...state.stats }),
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

// The provider is keyed on the loaded list itself, family and byte-array
// identity in order, so a caller that keeps its fonts map stable keeps its
// provider.
export function cachedFontProvider(
	state: PaintCacheState,
	loaded: FontKey,
	build: () => CK,
): CK {
	const hit = state.fonts;
	if (
		hit &&
		hit.key.length === loaded.length &&
		hit.key.every(
			(f, i) => f.family === loaded[i]?.family && f.bytes === loaded[i]?.bytes,
		)
	)
		return hit.provider;
	state.fonts = null;
	if (hit) tryFree(() => hit.provider.delete());
	const provider = build();
	state.stats.fontProviderBuilds++;
	state.fonts = { key: [...loaded], provider };
	return provider;
}

// Reused only when it was made the same way (for a host canvas, or offscreen)
// at the same device size; anything else replaces it.
export function cachedSurface(
	state: PaintCacheState,
	want: { width: number; height: number; hosted: boolean },
	make: () => { surface: CK; canvas: CanvasLike; loseContext: () => void },
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

// Deletes the cached images this paint's scene did not use.
export function evictUnusedImages(
	state: PaintCacheState,
	used: string[],
): void {
	const keep = new Set(used);
	for (const [src, img] of state.images) {
		if (keep.has(src)) continue;
		state.images.delete(src);
		tryFree(() => img.delete());
	}
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
