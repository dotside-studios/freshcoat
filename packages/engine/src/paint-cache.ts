// An opt-in cache a runtime carries across paints of the same scene, for an
// interactive caller that repaints many times a second. It keeps what paintScene
// would otherwise rebuild on every paint: the font provider, the shaped lines of
// text, the decoded images, the output surface and, offscreen, the pixels of a
// leading background the paints share. A runtime without one paints exactly as
// it always has, building and freeing all three per paint.
//
// By default a paint frees every cached image its scene did not draw. A batch
// caller painting many different scenes passes `maxImagePixels` instead: images
// a paint did not draw then stay, least recently used first out, until the
// cached images fit the budget.

import { newPaintCache } from "./paint-cache-state";

export type PaintCacheStats = {
	paints: number;
	surfaceCreates: number;
	fontProviderBuilds: number;
	imageDecodes: number;
	paragraphBuilds: number;
	lutImageBuilds: number;
	mipmapBuilds: number;
	pathBuilds: number;
	backgroundSnapshots: number;
	backgroundReuses: number;
};

export type PaintCache = {
	// Frees everything held. The next paint rebuilds it.
	clear(): void;
	// clear(), and a later paint through this cache throws.
	dispose(): void;
	stats(): PaintCacheStats;
};

export type PaintCacheOptions = {
	// Decoded pixels kept across paints. Images the current paint draws are
	// always kept, however far over this that leaves the cache.
	maxImagePixels?: number;
	// Cached images kept across paints with `maxImagePixels`, whatever their
	// size. Default 256.
	maxImages?: number;
};

export function createPaintCache(opts?: PaintCacheOptions): PaintCache {
	return newPaintCache(opts);
}
