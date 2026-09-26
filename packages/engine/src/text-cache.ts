// A TextEngine that remembers what it has shaped. Shaping is a pure function of
// the text, the font and the width for a fixed set of font faces, and an
// interactive caller lays out the same paragraphs on every frame, so the second
// and later frames only shape what changed. Results are frozen: they are
// shared between callers, and a write to one would reach every later caller.
import type { TextEngine } from "./text-engine";

export type TextEngineCacheStats = {
	hits: number;
	misses: number;
	size: number;
};

export type CachedTextEngine<E extends TextEngine> = E & {
	cacheStats(): TextEngineCacheStats;
};

/** Wraps `engine` with a least-recently-used cache of `maxEntries` results per
 *  method. The wrapped engine must not change the faces it shapes with. */
export function memoizeTextEngine<E extends TextEngine>(
	engine: E,
	opts: { maxEntries?: number } = {},
): CachedTextEngine<E> {
	const max = opts.maxEntries ?? 4000;
	const stats = { hits: 0, misses: 0 };
	const caches: Map<string, unknown>[] = [];

	const memo = <A extends unknown[], R>(fn: (...args: A) => R) => {
		const cache = new Map<string, R>();
		caches.push(cache);
		return (...args: A): R => {
			const key = JSON.stringify(args);
			const hit = cache.get(key);
			if (hit !== undefined) {
				stats.hits++;
				cache.delete(key);
				cache.set(key, hit);
				return hit;
			}
			stats.misses++;
			const value = deepFreeze(fn(...args));
			cache.set(key, value);
			if (cache.size > max) cache.delete(cache.keys().next().value as string);
			return value;
		};
	};

	return {
		...engine,
		measureText: memo(engine.measureText),
		measureSpanWidth: memo(engine.measureSpanWidth),
		layoutText: memo(engine.layoutText),
		...(engine.layoutInline ? { layoutInline: memo(engine.layoutInline) } : {}),
		cacheStats: () => ({
			...stats,
			size: caches.reduce((n, c) => n + c.size, 0),
		}),
	};
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
}
