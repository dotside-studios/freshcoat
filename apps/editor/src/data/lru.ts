/**
 * A least-recently-used map bounded by entry count and by a total size the
 * caller measures. Setting past either bound evicts from the cold end, and
 * `onEvict` hears about every entry that leaves, whether evicted, replaced,
 * deleted or cleared, so it can free what the entry holds. An entry
 * `isPinned` names is never evicted, even past the bounds.
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
			isPinned?: (key: K, value: V) => boolean;
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
		this.trim(key);
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

	private trim(newest: K): void {
		const maxSize = this.opts.maxSize ?? Number.POSITIVE_INFINITY;
		const over = () =>
			this.map.size > this.opts.maxEntries || this.total > maxSize;
		if (!over()) return;
		for (const [key, { value }] of this.map) {
			if (!over()) return;
			// The newest entry stays even when it alone is over the size bound.
			if (key === newest && this.opts.maxEntries > 0) continue;
			if (this.opts.isPinned?.(key, value)) continue;
			this.delete(key);
		}
	}
}
