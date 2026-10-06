// Native images built from adjust LUT tables, looked up first by array identity
// and then by content, so equal tables share one image without stringifying
// them. A paint owns one per bin; a PaintCache keeps one across paints.

// biome-ignore lint/suspicious/noExplicitAny: external WASM API, untyped
type CK = any;

type Entry = {
	size: number;
	// The caller's arrays, for the identity lookup.
	source: Uint8Array[];
	// A private copy, so a caller mutating its arrays cannot fake a content match.
	bytes: Uint8Array[];
	image: CK | null;
	used: boolean;
};

export type LutImages = {
	byArray: WeakMap<Uint8Array, Entry>;
	byHash: Map<number, Entry[]>;
	builds: number;
};

export function createLutImages(): LutImages {
	return { byArray: new WeakMap(), byHash: new Map(), builds: 0 };
}

// `parts` are the table's arrays (r/g/b for a curve, data for a cube) and `size`
// tells tables of equal bytes but different shape apart.
export function cachedLutImage(
	luts: LutImages,
	size: number,
	parts: Uint8Array[],
	build: () => CK,
): CK {
	const known = luts.byArray.get(parts[0]);
	if (
		known?.image &&
		known.size === size &&
		known.source.length === parts.length &&
		known.source.every((p, i) => p === parts[i])
	) {
		known.used = true;
		return known.image;
	}
	const hash = hashLut(size, parts);
	let bucket = luts.byHash.get(hash);
	const hit = bucket?.find((e) => sameBytes(e, size, parts));
	if (hit) {
		hit.used = true;
		hit.source = parts;
		luts.byArray.set(parts[0], hit);
		return hit.image;
	}
	const entry: Entry = {
		size,
		source: parts,
		bytes: parts.map((p) => p.slice()),
		image: build(),
		used: true,
	};
	luts.builds++;
	if (!bucket) {
		bucket = [];
		luts.byHash.set(hash, bucket);
	}
	bucket.push(entry);
	luts.byArray.set(parts[0], entry);
	return entry.image;
}

// Deletes the images no lookup asked for since the last eviction.
export function evictUnusedLutImages(luts: LutImages): void {
	for (const [hash, bucket] of luts.byHash) {
		const kept = bucket.filter((e) => {
			if (e.used) {
				e.used = false;
				return true;
			}
			freeEntry(e);
			return false;
		});
		if (kept.length) luts.byHash.set(hash, kept);
		else luts.byHash.delete(hash);
	}
}

export function freeLutImages(luts: LutImages): void {
	for (const bucket of luts.byHash.values()) for (const e of bucket) freeEntry(e);
	luts.byHash.clear();
	luts.byArray = new WeakMap();
}

function freeEntry(e: Entry): void {
	const image = e.image;
	e.image = null;
	try {
		image?.delete();
	} catch {}
}

function sameBytes(e: Entry, size: number, parts: Uint8Array[]): boolean {
	if (e.size !== size || e.bytes.length !== parts.length) return false;
	for (let i = 0; i < parts.length; i++) {
		const a = e.bytes[i];
		const b = parts[i];
		if (a.length !== b.length) return false;
		for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return false;
	}
	return true;
}

// 32-bit FNV-1a over the shape and the bytes.
function hashLut(size: number, parts: Uint8Array[]): number {
	let h = 0x811c9dc5;
	const mix = (v: number) => {
		h ^= v & 0xff;
		h = Math.imul(h, 0x01000193);
	};
	const mixInt = (v: number) => {
		for (let s = 0; s < 32; s += 8) mix(v >>> s);
	};
	mixInt(size);
	mixInt(parts.length);
	for (const p of parts) {
		mixInt(p.length);
		for (let i = 0; i < p.length; i++) {
			h ^= p[i];
			h = Math.imul(h, 0x01000193);
		}
	}
	return h >>> 0;
}
