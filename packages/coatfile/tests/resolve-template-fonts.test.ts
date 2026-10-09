import { clearFontBytesCache, type FontFetch } from "@freshcoat-js/engine";
import { afterEach, describe, expect, test } from "vitest";
import { fontUsage } from "../src/font-usage";
import { resolveTemplateFonts } from "../src/fonts";
import type { Template } from "../src/types";

afterEach(() => clearFontBytesCache());

type Answer = { ok: boolean; status?: number; body?: string | number[] };

function fakeFetch(handler: (url: string) => Answer): {
	fetch: FontFetch;
	urls: string[];
} {
	const urls: string[] = [];
	const fetch: FontFetch = async (url) => {
		urls.push(url);
		const { ok, status = ok ? 200 : 404, body = "" } = handler(url);
		return {
			ok,
			status,
			text: async () => String(body),
			arrayBuffer: async () =>
				new Uint8Array(Array.isArray(body) ? body : []).buffer,
		} as Awaited<ReturnType<FontFetch>>;
	};
	return { fetch, urls };
}

const css = (file: string): Answer => ({
	ok: true,
	body: `@font-face { src: url(${file}); }`,
});

const text = (family: string, weight?: number, spans?: unknown[]) => ({
	type: "text",
	properties: {
		font: { family, ...(weight ? { weight } : {}) },
		text: "hi",
		...(spans ? { spans } : {}),
	},
});

function template(elements: unknown[], extra: Partial<Template> = {}): Template {
	return {
		format_version: "1.0",
		name: "T",
		width: 100,
		height: 100,
		fields: { properties: {} },
		variants: [],
		template_data: [
			{
				name: "front",
				background: { type: "rect", properties: {} },
				elements,
			},
		],
		...extra,
	} as unknown as Template;
}

const declaredRoboto = {
	fonts: [
		{
			kind: "google",
			family: "Roboto",
			url: "https://css/roboto",
		},
	],
} as Partial<Template>;

describe("resolveTemplateFonts", () => {
	test("loads a declared family from its descriptor", async () => {
		const { fetch, urls } = fakeFetch((url) =>
			url === "https://css/roboto"
				? css("https://f/roboto.ttf")
				: { ok: true, body: [1, 2, 3] },
		);
		const report = await resolveTemplateFonts(
			template([text("Roboto")], declaredRoboto),
			{ fetch },
		);
		expect(report.declared).toEqual(["Roboto"]);
		expect(report.guessed).toEqual([]);
		expect(report.missing).toEqual([]);
		expect(Array.from(report.fonts.get("Roboto")?.[0] ?? [])).toEqual([
			1, 2, 3,
		]);
		expect(urls).toEqual(["https://css/roboto", "https://f/roboto.ttf"]);
	});

	test("guesses an undeclared family on Google Fonts at the weights used", async () => {
		const { fetch, urls } = fakeFetch((url) =>
			url.startsWith("https://fonts.googleapis.com/")
				? css("https://f/inter.ttf")
				: { ok: true, body: [7] },
		);
		const report = await resolveTemplateFonts(
			template([text("Inter", 700), text("Inter")]),
			{ fetch },
		);
		expect(report.declared).toEqual([]);
		expect(report.guessed).toEqual(["Inter"]);
		expect(report.fonts.has("Inter")).toBe(true);
		expect(urls[0]).toBe(
			"https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
		);
	});

	test("reports a family nothing has as missing", async () => {
		const { fetch } = fakeFetch(() => ({ ok: false }));
		const report = await resolveTemplateFonts(
			template([text("Roboto"), text("Nowhere Sans")], declaredRoboto),
			{ fetch },
		);
		expect(report.fonts.size).toBe(0);
		expect(report.declared).toEqual(["Roboto"]);
		expect(report.missing).toEqual(["Nowhere Sans", "Roboto"]);
	});

	test("with guessGoogle off, an undeclared family is missing and not fetched", async () => {
		const { fetch, urls } = fakeFetch(() => css("https://f/x.ttf"));
		const report = await resolveTemplateFonts(template([text("Inter")]), {
			fetch,
			guessGoogle: false,
		});
		expect(report.missing).toEqual(["Inter"]);
		expect(urls).toEqual([]);
	});

	test("an empty result leaves the cache, so the next call retries", async () => {
		let up = false;
		const { fetch, urls } = fakeFetch((url) =>
			!up
				? { ok: false }
				: url.startsWith("https://fonts.googleapis.com/")
					? css("https://f/inter.ttf")
					: { ok: true, body: [5] },
		);
		const cache = new Map<string, Promise<Uint8Array[]>>();
		const t = template([text("Inter")]);

		expect((await resolveTemplateFonts(t, { fetch, cache })).missing).toEqual([
			"Inter",
		]);
		expect(cache.size).toBe(0);

		up = true;
		const second = await resolveTemplateFonts(t, { fetch, cache });
		expect(second.guessed).toEqual(["Inter"]);
		expect(cache.size).toBe(1);

		const fetched = urls.length;
		const third = await resolveTemplateFonts(t, { fetch, cache });
		expect(third.fonts.get("Inter")).toBe(second.fonts.get("Inter"));
		expect(urls.length).toBe(fetched);
	});

	test("an empty result does not delete a newer entry for the same key", async () => {
		const down = fakeFetch(() => ({ ok: false }));
		const { fetch, urls } = fakeFetch((url) =>
			url.startsWith("https://fonts.googleapis.com/")
				? css("https://f/inter.ttf")
				: { ok: true, body: [5] },
		);
		const stale = Promise.reject(new Error("stale"));
		stale.catch(() => {});
		const cache = new Map<string, Promise<Uint8Array[]>>();
		const t = template([text("Inter")]);
		cache.set("g:Inter:400", stale);

		const [first, second] = await Promise.all([
			resolveTemplateFonts(t, { fetch: down.fetch, cache }),
			resolveTemplateFonts(t, { fetch, cache }),
		]);
		expect(first.missing).toEqual(["Inter"]);
		expect(second.guessed).toEqual(["Inter"]);
		expect(cache.size).toBe(1);

		const fetched = urls.length;
		const third = await resolveTemplateFonts(t, { fetch, cache });
		expect(third.fonts.get("Inter")).toBe(second.fonts.get("Inter"));
		expect(urls.length).toBe(fetched);
	});
});

describe("fontUsage", () => {
	const bold = (font: Record<string, unknown>) =>
		({
			variants: [
				{
					id: "bold",
					label: "Bold",
					overrides: [
						{ name: "front", elements: [{ id: "a", properties: { font } }] },
					],
				},
			],
		}) as unknown as Partial<Template>;

	test("collects weights from spans, variants and barcodes", () => {
		const t = template(
			[
				{ ...text("Inter", 300, [{ font: { weight: 600 } }]), id: "a" },
				text("Roboto", undefined, [{ font: { family: "Lora", weight: 500 } }]),
				{ type: "barcode", properties: { fontFamily: "Mono" } },
			],
			bold({ family: "Inter", weight: 800 }),
		);
		expect(Object.fromEntries(fontUsage(t))).toEqual({
			Inter: { weights: [300, 600, 800], italic: false },
			Roboto: { weights: [400], italic: false },
			Lora: { weights: [500], italic: false },
			Mono: { weights: [400], italic: false },
		});
	});

	test("includes a family only a variant uses", () => {
		const t = template(
			[{ ...text("Inter"), id: "a" }],
			bold({ family: "Playfair Display", weight: 700 }),
		);
		expect(fontUsage(t).get("Playfair Display")).toEqual({
			weights: [700],
			italic: false,
		});
	});

	test("gives a barcode without a font the default family", () => {
		const t = template([
			text("Inter", 600),
			{ type: "barcode", properties: {} },
		]);
		expect(fontUsage(t).get("Inter")).toEqual({
			weights: [400, 600],
			italic: false,
		});
	});

	test("reports italics, inherited by spans", () => {
		const t = template([
			{
				type: "text",
				properties: {
					font: { family: "Inter", style: "italic" },
					text: "hi",
					spans: [{ font: { family: "Lora" } }],
				},
			},
			text("Roboto", 700, [{ font: { style: "italic" } }]),
			text("Mono"),
		]);
		const usage = fontUsage(t);
		expect(usage.get("Inter")?.italic).toBe(true);
		expect(usage.get("Lora")?.italic).toBe(true);
		expect(usage.get("Roboto")).toEqual({ weights: [700], italic: true });
		expect(usage.get("Mono")?.italic).toBe(false);
	});
});
