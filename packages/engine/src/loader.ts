export type ByteLoader = (src: string) => Promise<Uint8Array>;

export const fetchLoader: ByteLoader = async (src) => {
	if (src.startsWith("data:")) return dataUrlToBytes(src);
	const res = await fetch(src);
	if (!res.ok) throw new Error(`fetch ${src} -> ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
};

/** Serves a src from `bytes` when present, else from `next`. */
export function mapLoader(
	bytes: Map<string, Uint8Array> | undefined,
	next: ByteLoader = fetchLoader,
): ByteLoader {
	if (!bytes) return next;
	return (src) => {
		const hit = bytes.get(src);
		return hit ? Promise.resolve(hit) : next(src);
	};
}

export function dataUrlToBytes(src: string): Uint8Array {
	const comma = src.indexOf(",");
	const meta = src.slice(0, comma);
	const data = src.slice(comma + 1);
	if (meta.includes(";base64")) {
		const bin = atob(data);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	return new TextEncoder().encode(decodeURIComponent(data));
}
