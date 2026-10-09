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
	if (meta.includes(";base64")) return base64ToBytes(data);
	return new TextEncoder().encode(decodeURIComponent(data));
}

// String.fromCharCode is applied to a spread, so the argument count — not the
// byte count — is what has a ceiling. 32K per call stays well under every
// engine's limit while keeping the loop short for multi-megabyte rasters.
const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
	return out;
}
