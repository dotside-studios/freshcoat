import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { clearFontBytesCache, fontBytes } from "../src/font-bytes";
import {
	assertLoadableUrl,
	base64ToBytes,
	bytesToBase64,
	createFetchLoader,
	dataUrlToBytes,
	fetchLoader,
	mapLoader,
} from "../src/loader";
import { createRect } from "../src/node";
import type { EncodedPaintResult } from "../src/runtime-types";
import type { Command, FontResolution } from "../src/types";
import { createHeadlessEnv, renderSceneToPng } from "./helpers/headless";

const local = (src: string): FontResolution => ({
	kind: "descriptor",
	descriptor: {
		kind: "local",
		family: "Local",
		files: [{ src, weight: 400, style: "normal" }],
	},
});

// `bun test`'s vitest shim has no vi.stubGlobal; swap the globals by hand.
const realFetch = globalThis.fetch;
const realLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

function stubFetch() {
	const urls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		urls.push(url);
		return {
			ok: true,
			status: 200,
			arrayBuffer: async () => new Uint8Array([9]).buffer,
		};
	}) as unknown as typeof globalThis.fetch;
	return urls;
}

function stubLocation(href: string | undefined) {
	Object.defineProperty(globalThis, "location", {
		value: href === undefined ? undefined : { href },
		configurable: true,
		writable: true,
	});
}

afterEach(() => {
	globalThis.fetch = realFetch;
	if (realLocation) Object.defineProperty(globalThis, "location", realLocation);
	else delete (globalThis as { location?: unknown }).location;
	clearFontBytesCache();
});

describe("fetchLoader", () => {
	test("decodes data: URLs without fetching", async () => {
		const fetch = stubFetch();
		expect([...(await fetchLoader("data:text/plain;base64,AQID"))]).toEqual([
			1, 2, 3,
		]);
		expect(dataUrlToBytes("data:,hi")).toEqual(new TextEncoder().encode("hi"));
		expect(fetch).toEqual([]);
	});

	test.each([
		["http:", "http://169.254.169.254/latest/meta-data"],
		["file:", "file:///etc/passwd"],
		["ftp:", "ftp://example.com/a.png"],
		["javascript:", "javascript:alert(1)"],
		["gopher:", "gopher://127.0.0.1:6379/_PING"],
		["ws:", "ws://localhost/socket"],
		["http:", "HTTP://localhost:8080/a.png"],
		["file:", "  file:///etc/passwd"],
	])("rejects %s without fetching", async (scheme, src) => {
		const fetch = stubFetch();
		await expect(fetchLoader(src)).rejects.toThrow(
			new RegExp(`"${scheme}".*your own loader`),
		);
		expect(fetch).toEqual([]);
	});

	test("fetches https: and blob: URLs", async () => {
		const fetch = stubFetch();
		expect([...(await fetchLoader("https://example.com/a.png"))]).toEqual([9]);
		expect([...(await fetchLoader("blob:https://example.com/uuid"))]).toEqual([
			9,
		]);
		expect(fetch).toEqual([
			"https://example.com/a.png",
			"blob:https://example.com/uuid",
		]);
	});

	test("rejects a relative URL when there is no page to resolve it against", async () => {
		const fetch = stubFetch();
		stubLocation(undefined);
		for (const src of ["/assets/x.png", "fonts/a.ttf", "//host/a.png"]) {
			await expect(fetchLoader(src)).rejects.toThrow(/relative URL/);
		}
		expect(fetch).toEqual([]);
	});

	test("resolves a relative URL against the page", async () => {
		const fetch = stubFetch();
		stubLocation("https://studio.test/app/index.html");
		await fetchLoader("/assets/x.png");
		await fetchLoader("fonts/a.ttf");
		expect(fetch).toEqual([
			"https://studio.test/assets/x.png",
			"https://studio.test/app/fonts/a.ttf",
		]);
	});

	test("lets a page served over http load its own relative URLs", () => {
		stubLocation("http://localhost:5173/");
		expect(assertLoadableUrl("/a.png")).toBe("http://localhost:5173/a.png");
		expect(() => assertLoadableUrl("http://localhost:5173/a.png")).toThrow(
			/"http:"/,
		);
	});

	test("allows http: only with unsafeAllowHttp", async () => {
		const fetch = stubFetch();
		await expect(fetchLoader("http://example.com/a.png")).rejects.toThrow(
			/"http:"/,
		);
		expect(fetch).toEqual([]);
		const unsafe = createFetchLoader({ unsafeAllowHttp: true });
		expect([...(await unsafe("http://example.com/a.png"))]).toEqual([9]);
		expect(fetch).toEqual(["http://example.com/a.png"]);
	});

	test("unsafeAllowHttp does not open other schemes", async () => {
		const fetch = stubFetch();
		const unsafe = createFetchLoader({ unsafeAllowHttp: true });
		for (const src of ["file:///etc/passwd", "ftp://h/a", "gopher://h/_x"]) {
			await expect(unsafe(src)).rejects.toThrow(/cannot load/);
		}
		expect(fetch).toEqual([]);
	});

	test("a custom fetch replaces the global one", async () => {
		const fetch = stubFetch();
		const own = createFetchLoader({
			fetch: async () => ({
				ok: true,
				status: 200,
				arrayBuffer: async () => new Uint8Array([3]).buffer,
			}),
		});
		expect([...(await own("https://example.com/a"))]).toEqual([3]);
		expect(fetch).toEqual([]);
	});

	test("an explicit loader keeps its own policy", async () => {
		const fetch = stubFetch();
		const loader = mapLoader(
			new Map([["file:///x", new Uint8Array([4])]]),
			async () => new Uint8Array(),
		);
		expect([...(await loader("file:///x"))]).toEqual([4]);
		expect(fetch).toEqual([]);
	});
});

describe("default font fetch", () => {
	test("does not fetch a declared font with a file: url", async () => {
		const fetch = stubFetch();
		await expect(fontBytes(local("file:///etc/passwd"))).rejects.toThrow(
			/"file:"/,
		);
		expect(fetch).toEqual([]);
	});

	test("does not fetch an http: font url or stylesheet", async () => {
		const fetch = stubFetch();
		await expect(fontBytes(local("http://localhost/a.ttf"))).rejects.toThrow(
			/"http:"/,
		);
		await expect(
			fontBytes({
				kind: "descriptor",
				descriptor: {
					kind: "google",
					family: "X",
					url: "http://localhost/css",
				},
			}),
		).rejects.toThrow(/"http:"/);
		expect(fetch).toEqual([]);
	});

	test("fetches an https: font url", async () => {
		const fetch = stubFetch();
		const [bytes] = await fontBytes(local("https://fonts.test/a.ttf"));
		expect([...(bytes as Uint8Array)]).toEqual([9]);
		expect(fetch).toHaveLength(1);
	});

	test("follows the loader's unsafeAllowHttp for http: fonts", async () => {
		const fetch = stubFetch();
		const load = mapLoader(
			undefined,
			createFetchLoader({ unsafeAllowHttp: true }),
		);
		const [bytes] = await fontBytes(local("http://fonts.local/a.ttf"), load);
		expect([...(bytes as Uint8Array)]).toEqual([9]);
		expect(fetch).toEqual(["http://fonts.local/a.ttf"]);
		await expect(fontBytes(local("http://fonts.local/a.ttf"))).rejects.toThrow(
			/"http:"/,
		);
		await expect(fontBytes(local("file:///x"), load)).rejects.toThrow(
			/"file:"/,
		);
	});

	test("a fetcher passed by the host is not restricted", async () => {
		const fetch = stubFetch();
		const seen: string[] = [];
		const [bytes] = await fontBytes(
			local("http://mirror.local/a.ttf"),
			undefined,
			async (url) => {
				seen.push(url);
				return {
					ok: true,
					status: 200,
					text: async () => "",
					arrayBuffer: async () => new Uint8Array([5]).buffer,
				};
			},
		);
		expect([...(bytes as Uint8Array)]).toEqual([5]);
		expect(seen).toEqual(["http://mirror.local/a.ttf"]);
		expect(fetch).toEqual([]);
	});
});

describe("mapLoader", () => {
	test("serves mapped bytes and falls back to the next loader", async () => {
		const mapped = new Uint8Array([1]);
		const fallback = new Uint8Array([2]);
		const seen: string[] = [];
		const load = mapLoader(new Map([["a", mapped]]), async (src) => {
			seen.push(src);
			return fallback;
		});
		expect(await load("a")).toBe(mapped);
		expect(await load("b")).toBe(fallback);
		expect(seen).toEqual(["b"]);
	});

	test("reads entries added to the map after it was made", async () => {
		const map = new Map<string, Uint8Array>();
		const load = mapLoader(map, async () => {
			throw new Error("miss");
		});
		const bytes = new Uint8Array([3]);
		map.set("late", bytes);
		expect(await load("late")).toBe(bytes);
	});
});

describe("fontBytes with a loader", () => {
	test("loads local font files through the loader once per src", async () => {
		clearFontBytesCache();
		const bytes = new Uint8Array([7]);
		let calls = 0;
		const load = async (src: string) => {
			calls++;
			expect(src).toBe("fonts/a.ttf");
			return bytes;
		};
		const [a] = await fontBytes(local("fonts/a.ttf"), load);
		const [b] = await fontBytes(local("fonts/a.ttf"), load);
		expect(a).toBe(bytes);
		expect(b).toBe(bytes);
		expect(calls).toBe(1);
	});

	test("retries a local file whose load failed", async () => {
		clearFontBytesCache();
		let fail = true;
		const load = async () => {
			if (fail) throw new Error("missing");
			return new Uint8Array([1]);
		};
		await expect(fontBytes(local("x.ttf"), load)).rejects.toThrow("missing");
		fail = false;
		expect(await fontBytes(local("x.ttf"), load)).toHaveLength(1);
	});
});

describe("createHeadlessEnv({ load })", () => {
	test("paints local fonts and images from the loader", async () => {
		clearFontBytesCache();
		const ck = await loadCanvasKit();
		const logo = await renderSceneToPng(
			createRect({
				size: { width: 4, height: 4 },
				fills: [{ kind: "solid", color: "#ff0000" }],
			}),
			{ width: 4, height: 4, ck },
		);
		const files = new Map([
			["fonts/geist.ttf", testFontBytes("Geist-Regular.ttf")],
			["logo.png", logo.bytes],
		]);
		const requested: string[] = [];
		const env = createHeadlessEnv({
			load: async (src) => {
				requested.push(src);
				const bytes = files.get(src);
				if (!bytes) throw new Error(`no ${src}`);
				return bytes;
			},
		});
		const commands: Command[] = [
			{ op: "createCanvas", width: 4, height: 4 },
			{
				op: "loadFonts",
				requests: [
					{
						family: "Geist",
						descriptor: {
							kind: "local",
							family: "Geist",
							files: [{ src: "fonts/geist.ttf", weight: 400, style: "normal" }],
						},
					},
				],
			},
			{ op: "loadImages", srcs: ["logo.png"] },
		];
		const result = (await env.paint(commands, ck)) as EncodedPaintResult;
		expect(result.warnings).toEqual([]);
		expect(requested.sort()).toEqual(["fonts/geist.ttf", "logo.png"]);
	});
});

describe("base64 round-trip", () => {
	test("survives high bytes and zeroes", () => {
		const bytes = [1, 2, 3, 250, 0, 255];
		expect([...base64ToBytes(bytesToBase64(new Uint8Array(bytes)))]).toEqual(
			bytes,
		);
	});

	test("handles a payload longer than one encode chunk", () => {
		const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 256);
		const round = base64ToBytes(bytesToBase64(bytes));
		expect(round.length).toBe(bytes.length);
		expect(round[round.length - 1]).toBe(bytes[bytes.length - 1]);
	});
});
