/**
 * A least-recently-used map bounded by entry count and by a total size the
 * caller measures. Setting past either bound evicts from the cold end, and
 * `onEvict` hears about every entry that leaves, whether evicted, replaced,
 * deleted or cleared, so it can free what the entry holds.
 */
export class Lru<K, V> {
	private readonly map = new Map<K, { value: V; size: number }>();
	private total = 0;

	constructor(
		private readonly opts: {
			maxEntries: number;
			maxSize?: number;
			sizeOf?: (value: V) => number;
			onEvict?: (key: K, value: V) => void;
		},
	) {}

	get size(): number {
		return this.map.size;
	}

	/** The summed sizes of what is held. */
	get totalSize(): number {
		return this.total;
	}

	has(key: K): boolean {
		return this.map.has(key);
	}

	/** The value, marked as just used. */
	get(key: K): V | undefined {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		this.map.delete(key);
		this.map.set(key, hit);
		return hit.value;
	}

	/** The value, without marking it used. */
	peek(key: K): V | undefined {
		return this.map.get(key)?.value;
	}

	set(key: K, value: V): void {
		this.delete(key);
		const size = this.opts.sizeOf?.(value) ?? 0;
		this.map.set(key, { value, size });
		this.total += size;
		this.trim();
	}

	delete(key: K): boolean {
		const hit = this.map.get(key);
		if (!hit) return false;
		this.map.delete(key);
		this.total -= hit.size;
		this.opts.onEvict?.(key, hit.value);
		return true;
	}

	clear(): void {
		for (const key of [...this.map.keys()]) this.delete(key);
	}

	keys(): K[] {
		return [...this.map.keys()];
	}

	private trim(): void {
		const maxSize = this.opts.maxSize ?? Number.POSITIVE_INFINITY;
		// The newest entry stays even when it alone is over the size bound.
		while (
			this.map.size > 1 &&
			(this.map.size > this.opts.maxEntries || this.total > maxSize)
		) {
			const oldest = this.map.keys().next().value as K;
			this.delete(oldest);
		}
		if (this.map.size > this.opts.maxEntries) this.clear();
	}
}
