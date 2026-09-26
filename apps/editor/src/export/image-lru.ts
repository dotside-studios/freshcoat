/** Megapixels of decoded images one render worker keeps by default. */
export const DEFAULT_IMAGE_CACHE_PIXELS = 48_000_000;

export type ImageLru<T> = {
	get(key: string): T | undefined;
	/** Adds a decoded image of `pixels` pixels, then evicts down to the budget. */
	set(key: string, value: T, pixels: number): void;
	/** Keys that must not be evicted, such as the images of the item rendering
	 *  now. Replaces the previous set, then evicts down to the budget. */
	pin(keys: Iterable<string>): void;
	clear(): void;
	readonly pixels: number;
	readonly size: number;
};

/**
 * Decoded images, least recently used first out, bounded by their pixel count
 * rather than by how many there are: one 50 MP photo weighs as much as a
 * hundred logos. A pinned image stays however far over budget that leaves the
 * cache, and goes on the first eviction after it is unpinned.
 */
export function createImageLru<T>(
	maxPixels: number,
	free: (value: T) => void,
): ImageLru<T> {
	const entries = new Map<string, { value: T; pixels: number }>();
	let pinned = new Set<string>();
	let total = 0;

	const drop = (key: string) => {
		const entry = entries.get(key);
		if (!entry) return;
		entries.delete(key);
		total -= entry.pixels;
		free(entry.value);
	};

	const evict = () => {
		if (total <= maxPixels) return;
		for (const key of [...entries.keys()]) {
			if (total <= maxPixels) return;
			if (!pinned.has(key)) drop(key);
		}
	};

	return {
		get(key) {
			const entry = entries.get(key);
			if (!entry) return undefined;
			entries.delete(key);
			entries.set(key, entry);
			return entry.value;
		},
		set(key, value, pixels) {
			drop(key);
			entries.set(key, { value, pixels });
			total += pixels;
			evict();
		},
		pin(keys) {
			pinned = new Set(keys);
			evict();
		},
		clear() {
			for (const key of [...entries.keys()]) drop(key);
			pinned = new Set();
		},
		get pixels() {
			return total;
		},
		get size() {
			return entries.size;
		},
	};
}
