import { resolveTemplateFonts, type Template } from "@freshcoat-js/coatfile";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fontKey } from "~/render/use-document-fonts";
import { doc } from "./doc-fixture";

function weightedTemplate(weight: 400 | 700): Template {
	const template = doc();
	const frame = template.template_data[0];
	const text = frame?.elements.find((element) => element.type === "text");
	if (!frame || text?.type !== "text") throw new Error("fixture needs text");
	return {
		...template,
		fonts: undefined,
		template_data: [
			{
				...frame,
				elements: [
					{
						...text,
						properties: {
							...text.properties,
							font: { family: "Inter", size: 24, weight },
						},
					},
				],
			},
		],
	};
}

vi.mock("@freshcoat-js/coatfile", async (load) => {
	const m = await load<typeof import("@freshcoat-js/coatfile")>();
	return {
		...m,
		collectFontRequests: vi.fn(m.collectFontRequests),
		resolveTemplateFonts: vi.fn(async () => ({
			fonts: new Map(),
			declared: [],
			guessed: [],
			missing: [],
		})),
	};
});

beforeEach(() => {
	vi.mocked(resolveTemplateFonts).mockReset();
	vi.mocked(resolveTemplateFonts).mockImplementation(async () => ({
		fonts: new Map(),
		declared: [],
		guessed: [],
		missing: [],
	}));
});

afterEach(cleanup);

describe("useDocumentFonts", () => {
	test("a fallback weight edit resolves a new font map without losing diagnostics", async () => {
		const { resolveTemplateFonts } = await import("@freshcoat-js/coatfile");
		const { useDocumentFonts } = await import("~/render/use-document-fonts");
		const resolve = vi.mocked(resolveTemplateFonts);
		resolve.mockClear();
		resolve.mockResolvedValueOnce({
			fonts: new Map(),
			declared: [],
			guessed: ["Inter"],
			missing: [],
		});
		const { rerender, result } = renderHook(({ t }) => useDocumentFonts(t), {
			initialProps: { t: weightedTemplate(400) },
		});
		await vi.waitFor(() => expect(result.current.loading).toBe(false));
		const first = result.current.fonts;
		resolve.mockResolvedValueOnce({
			fonts: new Map(),
			declared: [],
			guessed: [],
			missing: ["Inter"],
		});
		rerender({ t: weightedTemplate(700) });
		await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.fonts).not.toBe(first);
		expect(result.current.missing).toEqual(["Inter"]);
		expect(result.current.guessed).toEqual([]);
		resolve.mockClear();
	});

	test("font identity follows fallback weights but keeps declared sources stable", () => {
		const regular = weightedTemplate(400);
		const bold = weightedTemplate(700);
		expect(fontKey(regular).key).not.toBe(fontKey(bold).key);
		const fonts: Template["fonts"] = [
			{
				kind: "google",
				family: "Inter",
				url: "https://fonts.example/inter.css",
			},
		];
		expect(fontKey({ ...regular, fonts }).key).toBe(
			fontKey({ ...bold, fonts }).key,
		);
	});

	test("an edit that leaves the fonts alone does not refetch", async () => {
		const { resolveTemplateFonts } = await import("@freshcoat-js/coatfile");
		const { useDocumentFonts } = await import("~/render/use-document-fonts");
		const t = doc();
		const { rerender, result } = renderHook(({ t }) => useDocumentFonts(t), {
			initialProps: { t },
		});
		await vi.waitFor(() => expect(result.current.loading).toBe(false));
		const fonts = result.current.fonts;
		rerender({ t: { ...t, name: "Renamed" } });
		rerender({ t: { ...t, width: 1001 } });
		await new Promise((r) => setTimeout(r, 10));
		expect(resolveTemplateFonts).toHaveBeenCalledTimes(1);
		expect(result.current.fonts).toBe(fonts);
	});

	test("the font walk is skipped for an unchanged template", async () => {
		const { collectFontRequests } = await import("@freshcoat-js/coatfile");
		const walk = vi.mocked(collectFontRequests);
		const t = doc();
		const first = fontKey(t);
		walk.mockClear();
		expect(fontKey(t)).toBe(first);
		expect(fontKey({ ...t, name: "Renamed", width: 1001 })).toBe(first);
		expect(walk).not.toHaveBeenCalled();
		fontKey({ ...t, fonts: [] });
		fontKey({ ...t, template_data: [...t.template_data] });
		expect(walk).toHaveBeenCalledTimes(2);
	});
});
