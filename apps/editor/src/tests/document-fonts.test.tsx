import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { fontKey } from "~/render/use-document-fonts";
import { doc } from "./doc-fixture";

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

describe("useDocumentFonts", () => {
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
