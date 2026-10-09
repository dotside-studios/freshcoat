import { type ByteLoader, dataUrlToBytes, fetchLoader } from "./loader";
import type { FontDescriptor, FontRequest, FontResolution } from "./types";

// Resolve a request against the env's pre-supplied bytes, else its descriptor.
// Shared by every runtime — the only per-env input is the pre-supplied map.
export function resolveFontRequest(
	req: FontRequest | string,
	bytesByFamily?: Map<string, Uint8Array[]>,
): FontResolution {
	const r: FontRequest = typeof req === "string" ? { family: req } : req;
	const pre = bytesByFamily?.get(r.family);
	if (pre) return { kind: "bytes", bytes: pre };
	if ("descriptor" in r)
		return { kind: "descriptor", descriptor: r.descriptor };
	return { kind: "none" };
}

// Old UA nudges Google Fonts / Fontsource to serve one unsubsetted TTF, which the
// sfnt metrics reader (readFontMetrics) can parse; it cannot parse WOFF2.
// Browsers treat user-agent as a forbidden header and ignore it, falling back to
// WOFF2, which CanvasKit decodes fine.
const TTF_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.30 (KHTML, like Gecko)";
const FONT_FETCH_TIMEOUT_MS = 8000;

export type FontFetch = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Pick<Response, "ok" | "status" | "text" | "arrayBuffer">>;

// Turn a resolution into raw font-file bytes. data: and http(s) sources are
// handled here; any other local file src goes through `load`. http(s) requests
// go through `fetcher`, the global fetch when it is omitted.
export async function fontBytes(
	res: FontResolution,
	load: ByteLoader = fetchLoader,
	fetcher?: FontFetch,
): Promise<Uint8Array[]> {
	if (res.kind === "bytes") return res.bytes;
	if (res.kind === "none") return [];
	return descriptorBytes(res.descriptor, load, httpFor(fetcher));
}

type Http = {
	fetch: FontFetch;
	file: Map<string, Promise<Uint8Array>>;
	stylesheet: Map<string, Promise<Uint8Array[]>>;
};

async function descriptorBytes(
	d: FontDescriptor,
	load: ByteLoader,
	http: Http,
): Promise<Uint8Array[]> {
	if (d.kind === "local") {
		return Promise.all(d.files.map((f) => fileBytes(f.src, load, http)));
	}
	// google / fontsource carry a CSS stylesheet, not a font file.
	return stylesheetFontBytes(d.url, http);
}

async function fileBytes(
	src: string,
	load: ByteLoader,
	http: Http,
): Promise<Uint8Array> {
	if (src.startsWith("data:")) return dataFontBytes(src);
	if (/^https?:/i.test(src)) return fetchBytes(src, http);
	return memoize(loaderMemo(load), src, load);
}

/**
 * Every font file a Google / Fontsource stylesheet points at, Latin-covering
 * faces first.
 *
 * Taking the stylesheet's *first* url is wrong, and silently so. When the
 * request carries a modern user-agent — which is every browser, since UA is a
 * forbidden header there and TTF_UA below is dropped — Google answers with one
 * `@font-face` per (weight × unicode subset), and it lists `latin-ext` before
 * `latin`. That first face's range starts at U+0100, so it has no A–Z at all:
 * every ASCII glyph renders as .notdef, with correct metrics, which reads as a
 * broken template rather than a wrong font file. Servers never saw it, because
 * the old UA gets them a single unsubsetted TTF.
 *
 * So: parse the faces, sort the ones that cover Basic Latin to the front —
 * `deriveFontMetrics` reads `faces[0]`, and a subset without Latin would give
 * the wrong cap height — and load them all, which also picks up the accented
 * ranges and the other weights the single-face fetch was dropping.
 */
function stylesheetFontBytes(
	cssUrl: string,
	http: Http,
): Promise<Uint8Array[]> {
	return memoize(http.stylesheet, cssUrl, (url) =>
		loadStylesheetFontBytes(url, http),
	);
}

async function loadStylesheetFontBytes(
	cssUrl: string,
	http: Http,
): Promise<Uint8Array[]> {
	const css = await fetchText(cssUrl, http.fetch);
	const faces = parseStylesheetFaces(css);
	if (faces.length === 0) {
		throw new Error(`no font file found in stylesheet: ${cssUrl}`);
	}
	const ordered = [
		...faces.filter((f) => f.coversLatin),
		...faces.filter((f) => !f.coversLatin),
	];
	// One URL, one face. A VARIABLE family answers every requested weight with the
	// same file per subset — `wght@400;600;700` is three @font-face rows pointing
	// at one woff2 — so without this the same bytes are fetched and registered
	// three times. The duplicates are not a second weight (the axis is set at
	// draw time, see paragraph-layout's spanTextStyle); they are only cost, and
	// they make the family's face list read as if the weights were there.
	const seen = new Set<string>();
	const unique: StylesheetFace[] = [];
	for (const face of ordered) {
		if (seen.has(face.url)) continue;
		seen.add(face.url);
		unique.push(face);
	}
	return Promise.all(unique.map((f) => fetchBytes(f.url, http)));
}

type StylesheetFace = { url: string; coversLatin: boolean };

const FONT_FILE = /\.(ttf|otf|woff2?)(\?|#|$)/i;
const LATIN_A = 0x41;

function parseStylesheetFaces(css: string): StylesheetFace[] {
	const faces: StylesheetFace[] = [];
	// A CSS @font-face body has no nested braces, so the first `}` ends it.
	for (const chunk of css.split(/@font-face/i).slice(1)) {
		const end = chunk.indexOf("}");
		const body = end === -1 ? chunk : chunk.slice(0, end);
		const urls = [...body.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map(
			(m) => m[2] as string,
		);
		const url = urls.find((u) => FONT_FILE.test(u)) ?? urls[0];
		if (!url) continue;
		const range = body.match(/unicode-range:\s*([^;}]+)/i)?.[1];
		// No declared range means the face carries everything it has.
		faces.push({
			url,
			coversLatin: range === undefined || rangeCovers(range, LATIN_A),
		});
	}
	if (faces.length > 0) return faces;

	// A stylesheet with no @font-face at all (or one shaped unexpectedly): fall
	// back to the old whole-file scan rather than claim the font is unavailable.
	const urls = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map(
		(m) => m[2] as string,
	);
	const url = urls.find((u) => FONT_FILE.test(u)) ?? urls[0];
	return url ? [{ url, coversLatin: true }] : [];
}

/** Whether a CSS `unicode-range` value covers a code point. */
function rangeCovers(spec: string, code: number): boolean {
	for (const part of spec.split(",")) {
		const token = part.trim().replace(/^u\+/i, "");
		if (!token) continue;
		if (token.includes("?")) {
			// Wildcard form, e.g. `U+00??` — every code point matching the pattern.
			const lo = Number.parseInt(token.replace(/\?/g, "0"), 16);
			const hi = Number.parseInt(token.replace(/\?/g, "F"), 16);
			if (code >= lo && code <= hi) return true;
			continue;
		}
		const [from, to] = token.split("-");
		const lo = Number.parseInt(from as string, 16);
		const hi = to === undefined ? lo : Number.parseInt(to, 16);
		if (Number.isFinite(lo) && code >= lo && code <= hi) return true;
	}
	return false;
}

async function fetchText(url: string, fetcher: FontFetch): Promise<string> {
	const res = await fetcher(url, {
		headers: { "user-agent": TTF_UA },
		signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return res.text();
}

function fetchBytes(url: string, http: Http): Promise<Uint8Array> {
	return memoize(http.file, url, (u) => loadBytes(u, http.fetch));
}

async function loadBytes(url: string, fetcher: FontFetch): Promise<Uint8Array> {
	const res = await fetcher(url, {
		headers: { "user-agent": TTF_UA },
		signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

// Same source, same Uint8Array: the PaintCache keys its font provider on byte
// identity. In-flight promises are shared and a rejection is evicted, so a
// failed load is retried by the next paint. Each memo is a small LRU.
const fileMemo = new Map<string, Promise<Uint8Array>>();
const stylesheetMemo = new Map<string, Promise<Uint8Array[]>>();
const dataMemo = new Map<string, Uint8Array>();
let loaderMemos = new WeakMap<ByteLoader, Map<string, Promise<Uint8Array>>>();
let fetchMemos = new WeakMap<FontFetch, Http>();
export const FONT_MEMO_MAX = 64;
const DATA_MEMO_MAX = 16;

function memoize<T>(
	memo: Map<string, Promise<T>>,
	key: string,
	load: (key: string) => Promise<T>,
): Promise<T> {
	const hit = touch(memo, key);
	if (hit) return hit;
	const p = load(key);
	remember(memo, key, p, FONT_MEMO_MAX);
	p.catch(() => {
		if (memo.get(key) === p) memo.delete(key);
	});
	return p;
}

// The global fetch is read per call so a host or test can replace it; a fetcher
// given explicitly gets memos of its own, so its answers never leak to another.
function httpFor(fetcher: FontFetch | undefined): Http {
	if (!fetcher)
		return {
			fetch: (url, init) => fetch(url, init),
			file: fileMemo,
			stylesheet: stylesheetMemo,
		};
	let http = fetchMemos.get(fetcher);
	if (!http) {
		http = { fetch: fetcher, file: new Map(), stylesheet: new Map() };
		fetchMemos.set(fetcher, http);
	}
	return http;
}

function loaderMemo(load: ByteLoader): Map<string, Promise<Uint8Array>> {
	let memo = loaderMemos.get(load);
	if (!memo) {
		memo = new Map();
		loaderMemos.set(load, memo);
	}
	return memo;
}

function dataFontBytes(src: string): Uint8Array {
	const hit = touch(dataMemo, src);
	if (hit) return hit;
	const bytes = dataUrlToBytes(src);
	remember(dataMemo, src, bytes, DATA_MEMO_MAX);
	return bytes;
}

function touch<T>(memo: Map<string, T>, key: string): T | undefined {
	const hit = memo.get(key);
	if (hit !== undefined) {
		memo.delete(key);
		memo.set(key, hit);
	}
	return hit;
}

function remember<T>(
	memo: Map<string, T>,
	key: string,
	value: T,
	max: number,
): void {
	memo.set(key, value);
	if (memo.size > max) memo.delete(memo.keys().next().value as string);
}

export function clearFontBytesCache(): void {
	fileMemo.clear();
	stylesheetMemo.clear();
	dataMemo.clear();
	loaderMemos = new WeakMap();
	fetchMemos = new WeakMap();
}

// The ArrayBuffer CanvasKit registers a font from, copied only when the view
// does not span its whole buffer.
export function fontArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const { buffer, byteOffset, byteLength } = bytes;
	if (
		byteOffset === 0 &&
		byteLength === buffer.byteLength &&
		buffer instanceof ArrayBuffer
	)
		return buffer;
	return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

const CSS2 = "https://fonts.googleapis.com/css2";

// The css2 `family` parameter: each word URI-encoded, joined by `+`.
export function googleFamilyParam(family: string): string {
	return family.trim().split(/\s+/).map(encodeURIComponent).join("+");
}

// A Google Fonts css2 stylesheet URL. Without `weights` it asks for the
// family's default face; an empty list asks for 400. `italic` adds the italic
// of every weight.
export function googleCss2Url(
	family: string,
	weights?: Iterable<number>,
	italic = false,
): string {
	const name = googleFamilyParam(family);
	if (weights === undefined) return `${CSS2}?family=${name}&display=swap`;
	const ws = [...new Set(weights)].sort((a, b) => a - b);
	if (ws.length === 0) ws.push(400);
	const axes = italic
		? `ital,wght@${[...ws.map((w) => `0,${w}`), ...ws.map((w) => `1,${w}`)].join(";")}`
		: `wght@${ws.join(";")}`;
	return `${CSS2}?family=${name}:${axes}&display=swap`;
}

// Identifies the bytes a request resolves to, for caching. A data: src can be
// large; its length and tail identify it well enough.
export function fontRequestKey(request: FontRequest): string {
	if (!("descriptor" in request)) return `${request.family}:none`;
	const d = request.descriptor;
	return d.kind === "local"
		? `${request.family}:local:${d.files.map((f) => `${f.weight}/${f.style ?? ""}/${f.src.length}/${f.src.slice(-48)}`).join(",")}`
		: `${request.family}:${d.kind}:${d.url}`;
}
