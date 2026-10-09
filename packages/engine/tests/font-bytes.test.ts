import { afterEach, describe, expect, test } from "vitest";
import type { FontResolution } from "../src/types";
import {
	clearFontBytesCache,
	FONT_MEMO_MAX,
	type FontFetch,
	fontBytes,
} from "../src/font-bytes";

// `bun test`'s vitest shim has no vi.stubGlobal; swap the global by hand.
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	clearFontBytesCache();
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

describe("fontBytes memo", () => {
	const http = (url: string) =>
		({
			kind: "descriptor",
			descriptor: {
				kind: "local",
				family: "X",
				files: [{ src: url, weight: 400, style: "normal" }],
			},
		}) satisfies FontResolution;

	test("two resolutions of one stylesheet make one fetch per URL and share arrays", async () => {
		const requested = stubFetch(SUBSET_CSS, {
			"https://f/ext-400.woff2": 1,
			"https://f/latin-400.woff2": 2,
			"https://f/ext-700.woff2": 3,
			"https://f/latin-700.woff2": 4,
		});
		const [a, b] = await Promise.all([
			fontBytes(google("https://css/vend")),
			fontBytes(google("https://css/vend")),
		]);
		const c = await fontBytes(google("https://css/vend"));
		expect(requested.filter((u) => u === "https://css/vend")).toHaveLength(1);
		expect(requested.filter((u) => u.startsWith("https://f/"))).toHaveLength(4);
		a.forEach((bytes, i) => {
			expect(b[i]).toBe(bytes);
			expect(c[i]).toBe(bytes);
		});
	});

	test("two resolutions of one font URL make one fetch and return the same array", async () => {
		const requested = stubFetch("", { "https://f/a.ttf": 7 });
		const [a] = await fontBytes(http("https://f/a.ttf"));
		const [b] = await fontBytes(http("https://f/a.ttf"));
		expect(requested).toEqual(["https://f/a.ttf"]);
		expect(b).toBe(a);
	});

	test("a failed fetch is retried", async () => {
		const requested = stubFetch("", {});
		await expect(fontBytes(http("https://f/a.ttf"))).rejects.toThrow(/404/);
		stubFetch("", { "https://f/a.ttf": 7 });
		const [bytes] = await fontBytes(http("https://f/a.ttf"));
		expect(bytes?.[0]).toBe(7);
		expect(requested).toEqual(["https://f/a.ttf"]);
	});

	test("the file memo evicts the least recently used URL past its cap", async () => {
		const bytes: Record<string, number> = {};
		const urls = Array.from(
			{ length: FONT_MEMO_MAX + 1 },
			(_, i) => `https://f/${i}.ttf`,
		);
		for (const url of urls) bytes[url] = 1;
		const requested = stubFetch("", bytes);
		for (const url of urls.slice(0, FONT_MEMO_MAX)) await fontBytes(http(url));
		await fontBytes(http(urls[0] as string));
		await fontBytes(http(urls[FONT_MEMO_MAX] as string));
		expect(requested).toHaveLength(FONT_MEMO_MAX + 1);
		await fontBytes(http(urls[0] as string));
		expect(requested).toHaveLength(FONT_MEMO_MAX + 1);
		await fontBytes(http(urls[1] as string));
		expect(requested).toHaveLength(FONT_MEMO_MAX + 2);
	});

	test("the stylesheet memo evicts past its cap", async () => {
		const requested = stubFetch(
			"@font-face { src: url(https://f/a.ttf); }",
			{ "https://f/a.ttf": 1 },
		);
		for (let i = 0; i <= FONT_MEMO_MAX; i++)
			await fontBytes(google(`https://css/${i}`));
		await fontBytes(google("https://css/0"));
		expect(requested.filter((u) => u === "https://css/0")).toHaveLength(2);
	});

	test("a data: font decodes to the same array each time", async () => {
		const src = `data:font/ttf;base64,${btoa("abc")}`;
		const [a] = await fontBytes(http(src));
		const [b] = await fontBytes(http(src));
		expect(b).toBe(a);
		expect([...(a ?? [])]).toEqual([97, 98, 99]);
	});
});

describe("fontBytes with a fetcher", () => {
	test("sends every request through it, with memos of its own", async () => {
		const file = {
			kind: "descriptor",
			descriptor: {
				kind: "local",
				family: "X",
				files: [{ src: "https://f/a.ttf", weight: 400, style: "normal" }],
			},
		} satisfies FontResolution;
		const requested = stubFetch("", { "https://f/a.ttf": 1 });
		const seen: string[] = [];
		const fetcher: FontFetch = async (url) => {
			seen.push(url);
			return {
				ok: true,
				status: 200,
				text: async () => "",
				arrayBuffer: async () => new Uint8Array([2]).buffer,
			};
		};
		const [global] = await fontBytes(file);
		const [own] = await fontBytes(file, undefined, fetcher);
		await fontBytes(file, undefined, fetcher);
		expect(global?.[0]).toBe(1);
		expect(own?.[0]).toBe(2);
		expect(requested).toEqual(["https://f/a.ttf"]);
		expect(seen).toEqual(["https://f/a.ttf"]);
	});
});
