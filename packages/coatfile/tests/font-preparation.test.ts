import { expect, test } from "bun:test";
import { testFontBytes } from "@freshcoat-js/test-utils";
import { fixtures } from "../fixtures";
import { createFontPreparation } from "../src/font-preparation";
import { createTemplateRenderer } from "../src/node";

const regular = testFontBytes("Geist-Regular.ttf");
const bold = testFontBytes("VendSans-Variable-latin.woff2");

function templateAt(weight: 400 | 700) {
	const template = structuredClone(fixtures.minimalCard);
	const text = template.template_data[0]?.elements[0];
	if (text?.type !== "text") throw new Error("fixture needs text");
	text.properties.font.weight = weight;
	return template;
}

test("reused rendering follows fallback weight changes without rebuilding unchanged fonts", async () => {
	const requests: number[][] = [];
	const renderer = await createTemplateRenderer({
		fontOptions: {
			fallback: {
				id: "weights",
				load: async (_family, weights) => {
					requests.push(weights);
					return [weights.includes(700) ? bold : regular];
				},
			},
		},
	});
	try {
		await renderer.render(templateAt(400), {});
		const initial = renderer.renderer.fonts;
		await renderer.render(templateAt(400), {});
		expect(renderer.renderer.fonts).toBe(initial);
		await renderer.render(templateAt(700), {});
		expect(renderer.renderer.fonts.get("Comfortaa")?.[0]).toBe(bold);
		await renderer.render(templateAt(400), {});
		expect(renderer.renderer.fonts.get("Comfortaa")?.[0]).toBe(regular);
		expect(requests).toEqual([[400], [700]]);
	} finally {
		renderer.dispose();
	}
});

test("changed declarations replace automatically installed faces", async () => {
	const template = templateAt(400);
	template.fonts = [
		{
			kind: "local",
			family: "Comfortaa",
			files: [{ weight: 400, src: "first.ttf" }],
		},
	];
	const renderer = await createTemplateRenderer({
		fontOptions: {
			fallback: null,
			load: async (src) => (src === "first.ttf" ? regular : bold),
		},
	});
	try {
		await renderer.render(template, {});
		expect(renderer.renderer.fonts.get("Comfortaa")?.[0]).toBe(regular);
		const changed = structuredClone(template);
		changed.fonts = [
			{
				kind: "local",
				family: "Comfortaa",
				files: [{ weight: 400, src: "second.ttf" }],
			},
		];
		await renderer.render(changed, {});
		expect(renderer.renderer.fonts.get("Comfortaa")?.[0]).toBe(bold);
	} finally {
		renderer.dispose();
	}
});

test("constructor fonts take precedence over automatic resolution at every weight", async () => {
	const renderer = await createTemplateRenderer({
		fonts: { Comfortaa: [regular] },
		fontOptions: { fallback: { id: "explicit", load: async () => [bold] } },
	});
	try {
		const initial = renderer.renderer.fonts;
		await renderer.render(templateAt(400), {});
		await renderer.render(templateAt(700), {});
		expect(renderer.renderer.fonts).toBe(initial);
		expect(renderer.renderer.fonts.get("Comfortaa")?.[0]).toBe(regular);
	} finally {
		renderer.dispose();
	}
});

test("later explicit registration of the same faces survives a changed fallback request", async () => {
	const renderer = await createTemplateRenderer({
		fontOptions: {
			fallback: {
				id: "later",
				load: async (_family, weights) => [
					weights.includes(700) ? bold : regular,
				],
			},
		},
	});
	try {
		await renderer.render(templateAt(400), {});
		await renderer.renderer.addFonts({ Comfortaa: [regular] });
		const explicit = renderer.renderer.fonts;
		await renderer.render(templateAt(700), {});
		expect(renderer.renderer.fonts).toBe(explicit);
		expect(renderer.renderer.fonts.get("Comfortaa")?.[0]).toBe(regular);
	} finally {
		renderer.dispose();
	}
});

test("an empty fallback is retried without poisoning subsequent rendering", async () => {
	let attempts = 0;
	const renderer = await createTemplateRenderer({
		fontOptions: {
			fallback: {
				id: "retry",
				load: async () => (++attempts === 1 ? [] : [regular]),
			},
		},
	});
	try {
		await renderer.render(templateAt(400), {});
		expect(renderer.renderer.fonts.has("Comfortaa")).toBe(false);
		await renderer.render(templateAt(400), {});
		expect(attempts).toBe(2);
		expect(renderer.renderer.fonts.get("Comfortaa")?.[0]).toBe(regular);
	} finally {
		renderer.dispose();
	}
});

test("a cache that returns new arrays of the same faces keeps registration stable", async () => {
	const renderer = await createTemplateRenderer({
		fontOptions: {
			cache: { get: async () => [regular], set() {}, delete() {} },
			fallback: {
				id: "copied-arrays",
				load: async () => {
					throw new Error("cache should satisfy this request");
				},
			},
		},
	});
	try {
		await renderer.render(templateAt(400), {});
		const registered = renderer.renderer.fonts;
		await renderer.render(templateAt(400), {});
		expect(renderer.renderer.fonts).toBe(registered);
	} finally {
		renderer.dispose();
	}
});

test("concurrent requests paint with the font faces requested by each template", async () => {
	const renderer = await createTemplateRenderer({
		fontOptions: {
			fallback: {
				id: "concurrent",
				load: async (_family, weights) => [
					weights.includes(700) ? bold : regular,
				],
			},
		},
	});
	const regularRenderer = await createTemplateRenderer({
		fonts: { Comfortaa: [regular] },
	});
	const boldRenderer = await createTemplateRenderer({
		fonts: { Comfortaa: [bold] },
	});
	const output = { output: { pixels: true as const } };
	try {
		const [first, second] = await Promise.all([
			renderer.render(templateAt(400), {}, output),
			renderer.render(templateAt(700), {}, output),
		]);
		const [expectedRegular] = await regularRenderer.render(
			templateAt(400),
			{},
			output,
		);
		const [expectedBold] = await boldRenderer.render(
			templateAt(700),
			{},
			output,
		);
		expect(first[0]?.pixels.data).toEqual(expectedRegular?.pixels.data);
		expect(second[0]?.pixels.data).toEqual(expectedBold?.pixels.data);
		expect(first[0]?.pixels.data).not.toEqual(second[0]?.pixels.data);
	} finally {
		renderer.dispose();
		regularRenderer.dispose();
		boldRenderer.dispose();
	}
});

test("a rejected render does not prevent the next queued render", async () => {
	const renderer = await createTemplateRenderer({
		fonts: { Comfortaa: [regular] },
	});
	try {
		const failed = renderer.render(
			templateAt(400),
			{},
			{ variantId: "missing" },
		);
		const succeeding = renderer.render(templateAt(400), {});
		await expect(failed).rejects.toThrow();
		expect((await succeeding)[0]?.bytes.length).toBeGreaterThan(0);
	} finally {
		renderer.dispose();
	}
});

test("disposing during resolution prevents registration and further preparation", async () => {
	const renderer = await createTemplateRenderer();
	let finish!: (bytes: Uint8Array[]) => void;
	let started!: () => void;
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	const preparation = createFontPreparation(renderer.renderer, {
		fallback: {
			id: "dispose",
			load: () => {
				started();
				return new Promise((resolve) => {
					finish = resolve;
				});
			},
		},
	});
	const pending = preparation.prepare(templateAt(400));
	try {
		await ready;
		preparation.dispose();
		finish([regular]);
		await expect(pending).rejects.toThrow("disposed");
		expect(renderer.renderer.fonts.has("Comfortaa")).toBe(false);
		await expect(preparation.prepare(templateAt(400))).rejects.toThrow(
			"disposed",
		);
	} finally {
		preparation.dispose();
		renderer.dispose();
	}
});

test("preparation preserves resolution reports and caller-owned caches", async () => {
	const renderer = await createTemplateRenderer();
	const cache = new Map<string, Promise<Uint8Array[]>>();
	const preparation = createFontPreparation(renderer.renderer, {
		cache,
		fallback: { id: "report", load: async () => [regular] },
	});
	try {
		const report = await preparation.prepare(templateAt(400));
		expect(report.guessed).toEqual(["Comfortaa"]);
		expect(report.declared).toEqual([]);
		expect(report.missing).toEqual([]);
		preparation.dispose();
		expect(cache.size).toBe(1);
	} finally {
		preparation.dispose();
		renderer.dispose();
	}
});

test("font family names are treated as keys rather than object properties", async () => {
	const renderer = await createTemplateRenderer();
	const preparation = createFontPreparation(renderer.renderer, {
		fallback: { id: "family-keys", load: async () => [regular] },
	});
	const template = templateAt(400);
	const text = template.template_data[0]?.elements[0];
	if (text?.type !== "text") throw new Error("fixture needs text");
	text.properties.font.family = "__proto__";
	try {
		await preparation.prepare(template);
		expect(renderer.renderer.fonts.get("__proto__")?.[0]).toBe(regular);
	} finally {
		preparation.dispose();
		renderer.dispose();
	}
});
