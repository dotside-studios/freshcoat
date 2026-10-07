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

// Turn a resolution into raw font-file bytes. data: and http(s) sources are
// handled here; any other local file src goes through `load`.
export async function fontBytes(
	res: FontResolution,
	load: ByteLoader = fetchLoader,
): Promise<Uint8Array[]> {
	if (res.kind === "bytes") return res.bytes;
	if (res.kind === "none") return [];
	return descriptorBytes(res.descriptor, load);
}

async function descriptorBytes(
	d: FontDescriptor,
	load: ByteLoader,
): Promise<Uint8Array[]> {
	if (d.kind === "local") {
		return Promise.all(d.files.map((f) => fileBytes(f.src, load)));
	}
	// google / fontsource carry a CSS stylesheet, not a font file.
	return stylesheetFontBytes(d.url);
}

async function fileBytes(src: string, load: ByteLoader): Promise<Uint8Array> {
	if (src.startsWith("data:")) return dataFontBytes(src);
	if (/^https?:/i.test(src)) return fetchBytes(src);
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
function stylesheetFontBytes(cssUrl: string): Promise<Uint8Array[]> {
	return memoize(stylesheetMemo, cssUrl, loadStylesheetFontBytes);
}

async function loadStylesheetFontBytes(cssUrl: string): Promise<Uint8Array[]> {
	const css = await fetchText(cssUrl);
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
	return Promise.all(unique.map((f) => fetchBytes(f.url)));
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

async function fetchText(url: string): Promise<string> {
	const res = await fetch(url, {
		headers: { "user-agent": TTF_UA },
		signal: AbortSignal.timeout(FONT_FETCH_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
	return res.text();
}

function fetchBytes(url: string): Promise<Uint8Array> {
	return memoize(fileMemo, url, loadBytes);
}

async function loadBytes(url: string): Promise<Uint8Array> {
	const res = await fetch(url, {
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
