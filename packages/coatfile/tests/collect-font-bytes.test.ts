import { clearFontBytesCache } from "@freshcoat-js/engine";
import { afterEach, describe, expect, test } from "vitest";
import { collectFontBytes } from "../src/fonts";
import type { Template } from "../src/types";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	clearFontBytesCache();
});

/** Swap in a fetch that answers by URL. Assigned directly rather than through a
 *  runner's global-stubbing helper so the suite runs under both `vitest` and the
 *  package's own `bun test`. */
function stubFetch(handler: (url: string) => unknown): void {
	globalThis.fetch = ((input: RequestInfo | URL) =>
		Promise.resolve(handler(String(input)))) as typeof fetch;
}

const stylesheet = (fontUrl: string) => ({
	ok: true,
	text: async () => `src: url(${fontUrl})`,
});
const file = (bytes: number[]) => ({
	ok: true,
	arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

const template = {
	format_version: "1.0",
	name: "T",
	width: 100,
	height: 100,
	fonts: [
		{
			kind: "google",
			family: "Roboto",
			url: "https://fonts.googleapis.com/css2?family=Roboto",
		},
	],
	fields: { properties: {} },
	variants: [],
	template_data: [
		{
			name: "front",
			background: { type: "rect", properties: {} },
			elements: [
				{
					type: "text",
					properties: { font: { family: "Roboto" }, text: "hi" },
				},
			],
		},
	],
} as unknown as Template;

// Two families, one declared against a URL that doesn't resolve — the shape a
// Figma export takes when the design uses a custom (non-Google) face.
const twoFamilies = {
	...template,
	fonts: [
		{
			kind: "google",
			family: "Roboto",
			url: "https://fonts.googleapis.com/css2?family=Roboto",
		},
		{
			kind: "google",
			family: "Vend Sans",
			url: "https://fonts.googleapis.com/css2?family=Vend+Sans",
		},
	],
	template_data: [
		{
			name: "front",
			background: { type: "rect", properties: {} },
			elements: [
				{ type: "text", properties: { font: { family: "Vend Sans" } } },
				{ type: "text", properties: { font: { family: "Roboto" } } },
			],
		},
	],
} as unknown as Template;

describe("collectFontBytes", () => {
	test("resolves each used family to bytes via the shared fetch", async () => {
		stubFetch((url) =>
			url.includes("css")
				? stylesheet("https://x/roboto.ttf")
				: file([9, 8, 7]),
		);
		const map = await collectFontBytes(template);
		expect([...map.keys()]).toEqual(["Roboto"]);
		expect(Array.from(map.get("Roboto")![0])).toEqual([9, 8, 7]);
	});

	test("one unresolvable family does not take the others down with it", async () => {
		// A custom Figma face declared as Google 404s. The map is the painter's
		// entire font supply, so letting that reject would render the WHOLE
		// template — Roboto included — in tofu.
		stubFetch((url) => {
			if (url.includes("Vend")) return { ok: false, status: 404 };
			return url.includes("css")
				? stylesheet("https://x/roboto.ttf")
				: file([1, 2]);
		});
		const map = await collectFontBytes(twoFamilies);
		expect([...map.keys()]).toEqual(["Roboto"]);
		expect(Array.from(map.get("Roboto")![0])).toEqual([1, 2]);
	});

	test("returns an empty map when nothing resolves", async () => {
		stubFetch(() => ({ ok: false, status: 500 }));
		expect((await collectFontBytes(twoFamilies)).size).toBe(0);
	});
});
