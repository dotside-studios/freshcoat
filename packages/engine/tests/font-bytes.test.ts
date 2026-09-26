import { afterEach, describe, expect, test } from "vitest";
import { fontBytes } from "../src/font-bytes";

// `bun test`'s vitest shim has no vi.stubGlobal; swap the global by hand.
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Serve `css` for the stylesheet URL, and one byte per font file keyed by url. */
function stubFetch(css: string, bytesByUrl: Record<string, number>) {
	const requested: string[] = [];
	globalThis.fetch = (async (url: string) => {
		requested.push(url);
		if (url.startsWith("https://css/")) {
			return { ok: true, text: async () => css };
		}
		const byte = bytesByUrl[url];
		if (byte === undefined) return { ok: false, status: 404 };
		return { ok: true, arrayBuffer: async () => new Uint8Array([byte]).buffer };
	}) as unknown as typeof globalThis.fetch;
	return requested;
}

const google = (url: string) =>
	({
		kind: "descriptor",
		descriptor: { kind: "google", family: "Vend Sans", url },
	}) as const;

// The shape fonts.googleapis.com actually answers a browser with: one face per
// (weight × subset), latin-ext listed BEFORE latin, and latin-ext's range
// starting at U+0100 — so it carries no A-Z.
const SUBSET_CSS = `
/* latin-ext */
@font-face {
  font-family: 'Vend Sans';
  font-weight: 400;
  src: url(https://f/ext-400.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F, U+2020, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'Vend Sans';
  font-weight: 400;
  src: url(https://f/latin-400.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F, U+2122;
}
/* latin-ext */
@font-face {
  font-family: 'Vend Sans';
  font-weight: 700;
  src: url(https://f/ext-700.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Vend Sans';
  font-weight: 700;
  src: url(https://f/latin-700.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
`;

describe("fontBytes over a subsetted stylesheet", () => {
	test("puts a Latin-covering face first, though the stylesheet lists latin-ext", async () => {
		stubFetch(SUBSET_CSS, {
			"https://f/ext-400.woff2": 1,
			"https://f/latin-400.woff2": 2,
			"https://f/ext-700.woff2": 3,
			"https://f/latin-700.woff2": 4,
		});
		const bytes = await fontBytes(google("https://css/vend"));
		// deriveFontMetrics reads faces[0]; a latin-ext face there would give the
		// cap height of a font that has no A-Z.
		expect(bytes[0]?.[0]).toBe(2);
		expect(bytes.slice(0, 2).map((b) => b[0])).toEqual([2, 4]);
	});

	test("loads every face, so accents and the other weights render too", async () => {
		stubFetch(SUBSET_CSS, {
			"https://f/ext-400.woff2": 1,
			"https://f/latin-400.woff2": 2,
			"https://f/ext-700.woff2": 3,
			"https://f/latin-700.woff2": 4,
		});
		const bytes = await fontBytes(google("https://css/vend"));
		expect(bytes.map((b) => b[0]).sort()).toEqual([1, 2, 3, 4]);
	});

	test("fetches one file once, however many weight rows point at it", async () => {
		// A VARIABLE family: `wght@400;600;700` answers with the same file per
		// subset, listed once per weight. The repeats are not extra faces — the
		// weight is set at draw time via the `wght` axis — so fetching and
		// registering them again is pure cost.
		const VARIABLE_CSS = `
			/* latin-ext */
			@font-face { font-weight: 400; src: url(https://f/ext.woff2); unicode-range: U+0100-02BA; }
			/* latin */
			@font-face { font-weight: 400; src: url(https://f/latin.woff2); unicode-range: U+0000-00FF; }
			/* latin-ext */
			@font-face { font-weight: 700; src: url(https://f/ext.woff2); unicode-range: U+0100-02BA; }
			/* latin */
			@font-face { font-weight: 700; src: url(https://f/latin.woff2); unicode-range: U+0000-00FF; }
		`;
		const requested = stubFetch(VARIABLE_CSS, {
			"https://f/ext.woff2": 1,
			"https://f/latin.woff2": 2,
		});
		const bytes = await fontBytes(google("https://css/vend"));
		expect(bytes.map((b) => b[0])).toEqual([2, 1]);
		expect(requested.filter((u) => u.startsWith("https://f/"))).toEqual([
			"https://f/latin.woff2",
			"https://f/ext.woff2",
		]);
	});

	test("treats a face with no unicode-range as covering Latin", async () => {
		// What the old-UA (server) path gets back: a single unsubsetted TTF.
		stubFetch(
			`@font-face { font-family: 'X'; src: url(https://f/all.ttf) format('truetype'); }`,
			{ "https://f/all.ttf": 9 },
		);
		const bytes = await fontBytes(google("https://css/x"));
		expect(bytes.map((b) => b[0])).toEqual([9]);
	});

	test("prefers a font file over other urls inside one face", async () => {
		stubFetch(
			`@font-face { src: local('X'), url(https://f/a.eot#iefix), url(https://f/a.woff2) format('woff2'); }`,
			{ "https://f/a.woff2": 7 },
		);
		const bytes = await fontBytes(google("https://css/x"));
		expect(bytes.map((b) => b[0])).toEqual([7]);
	});

	test("falls back to a whole-file scan when there is no @font-face", async () => {
		stubFetch(`.x { background: url(https://f/odd.woff2) }`, {
			"https://f/odd.woff2": 5,
		});
		const bytes = await fontBytes(google("https://css/x"));
		expect(bytes.map((b) => b[0])).toEqual([5]);
	});

	test("throws when the stylesheet points at no font at all", async () => {
		stubFetch(`/* nothing here */`, {});
		await expect(fontBytes(google("https://css/x"))).rejects.toThrow(
			/no font file found/,
		);
	});
});
