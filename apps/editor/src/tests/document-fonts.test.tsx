import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { doc } from "./doc-fixture";

vi.mock("~/render/fonts", () => ({
	resolveTemplateFonts: vi.fn(async () => ({
		fonts: new Map(),
		declared: [],
		guessed: [],
		missing: [],
	})),
}));

describe("useDocumentFonts", () => {
	test("an edit that leaves the fonts alone does not refetch", async () => {
		const { resolveTemplateFonts } = await import("~/render/fonts");
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
});
