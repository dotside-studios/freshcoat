export type ByteLoader = (src: string) => Promise<Uint8Array>;

export type LoaderPolicy = {
	/**
	 * Also allow `http:`. Unsafe: plaintext, and a template can aim it at
	 * internal services. Only for hosts that trust every template they render.
	 */
	unsafeAllowHttp?: boolean;
};

/** The subset of `fetch` a loader needs; the global `fetch` fits. */
export type LoaderFetch = (
	url: string,
	init: { redirect: RequestRedirect },
) => Promise<Pick<Response, "ok" | "status" | "arrayBuffer"> & RedirectInfo>;

type RedirectInfo = Partial<Pick<Response, "headers" | "type" | "body">>;

const BASE_SCHEMES = ["data:", "blob:", "https:"];
const SCHEME = /^([a-z][a-z\d+.-]*:)/i;
const MAX_REDIRECTS = 5;
const policies = new WeakMap<ByteLoader, LoaderPolicy>();

/**
 * The URL a default loader may fetch for `src`: `data:`, `blob:` and `https:`,
 * plus `http:` under `unsafeAllowHttp`. A relative src resolves against the
 * page (`globalThis.location`) and is refused where there is none. Anything
 * else throws, since a template controls these URLs.
 */
export function assertLoadableUrl(
	src: string,
	policy: LoaderPolicy = {},
): string {
	const allowed = policy.unsafeAllowHttp
		? [...BASE_SCHEMES, "http:"]
		: BASE_SCHEMES;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: strips what URL parsing ignores: tab, LF and CR anywhere, and leading controls
	const trimmed = src.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+/, "");
	const scheme = SCHEME.exec(trimmed)?.[1]?.toLowerCase();
	if (scheme) {
		if (allowed.includes(scheme)) return trimmed;
		throw new Error(
			`cannot load a "${scheme}" URL: the default loader allows only ${allowed.join(", ")}; pass your own loader to allow more`,
		);
	}
	const base = globalThis.location?.href;
	if (!base) {
		throw new Error(
			"cannot load a relative URL without a page to resolve it against; pass your own loader to read it",
		);
	}
	const url = new URL(trimmed, base);
	// A page served over http (a dev server) resolves its own relative URLs to http.
	if (url.protocol === "http:" && url.origin === new URL(base).origin)
		return url.href;
	return assertLoadableUrl(url.href, policy);
}

/**
 * Fetches `src` under `policy`, following up to 5 redirects and checking each
 * `Location` the same way. Where `redirect: "manual"` gives an opaque redirect
 * (a browser), the request is repeated with `redirect: "follow"` and the
 * browser's own mixed-content rules apply.
 */
export async function fetchUnderPolicy<
	R extends { status: number } & RedirectInfo,
>(
	src: string,
	policy: LoaderPolicy,
	fetcher: (url: string, redirect: RequestRedirect) => Promise<R>,
): Promise<R> {
	let url = assertLoadableUrl(src, policy);
	for (let hops = 0; ; hops++) {
		const res = await fetcher(url, "manual");
		if (res.type === "opaqueredirect") return fetcher(url, "follow");
		const location =
			res.status >= 300 && res.status < 400
				? res.headers?.get("location")
				: null;
		if (!location) return res;
		await res.body?.cancel();
		if (hops === MAX_REDIRECTS)
			throw new Error(`fetch ${src}: more than ${MAX_REDIRECTS} redirects`);
		url = assertLoadableUrl(new URL(location, url).href, policy);
	}
}

/** A loader that decodes `data:` URLs and fetches the rest under `policy`. */
export function createFetchLoader(
	policy: LoaderPolicy & { fetch?: LoaderFetch } = {},
): ByteLoader {
	const { fetch: fetcher, ...rest } = policy;
	const loader: ByteLoader = async (src) => {
		const url = assertLoadableUrl(src, rest);
		if (url.slice(0, 5).toLowerCase() === "data:") return dataUrlToBytes(url);
		const res = await fetchUnderPolicy(url, rest, (u, redirect) =>
			(fetcher ?? fetch)(u, { redirect }),
		);
		if (!res.ok) throw new Error(`fetch ${src} -> ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	};
	policies.set(loader, rest);
	return loader;
}

export const fetchLoader: ByteLoader = createFetchLoader();

/** The policy a loader made by `createFetchLoader` enforces; none for others. */
export function loaderPolicy(loader: ByteLoader): LoaderPolicy {
	return policies.get(loader) ?? {};
}

/** Marks `to`, a loader that delegates to `from`, as enforcing `from`'s policy. */
export function inheritLoaderPolicy<T extends ByteLoader>(
	from: ByteLoader,
	to: T,
): T {
	const policy = policies.get(from);
	if (policy) policies.set(to, policy);
	return to;
}

/** Serves a src from `bytes` when present, else from `next`. */
export function mapLoader(
	bytes: Map<string, Uint8Array> | undefined,
	next: ByteLoader = fetchLoader,
): ByteLoader {
	if (!bytes) return next;
	return inheritLoaderPolicy(next, (src) => {
		const hit = bytes.get(src);
		return hit ? Promise.resolve(hit) : next(src);
	});
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
