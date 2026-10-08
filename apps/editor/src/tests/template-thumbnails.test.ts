// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { doc } from "./doc-fixture";

const renderSidePng = vi.fn(async () => ({
	png: new Uint8Array([1, 2, 3]),
	width: 160,
	height: 100,
	name: "x.png",
}));

vi.mock("~/app/export-png", () => ({ renderSidePng }));
vi.mock("~/render/fonts", () => ({
	resolveTemplateFonts: async () => ({ fonts: new Map() }),
}));

const { templateHash, templateThumbnail, THUMBNAIL_SIZE } = await import(
	"~/app/template-thumbnails"
);

describe("thumbnails", () => {
	it("draws the front side in the default variant at the thumbnail size", async () => {
		renderSidePng.mockClear();
		const t = { ...doc(), width: 800, height: 400 };
		const blob = await templateThumbnail("a", async () => t).fresh();
		expect(blob?.type).toBe("image/png");
		expect(renderSidePng).toHaveBeenCalledOnce();
		const [, opts] = renderSidePng.mock.calls[0] as unknown as [
			unknown,
			{ side: number; variantId?: string; scale: number },
		];
		expect(opts.side).toBe(0);
		expect(opts.variantId).toBeUndefined();
		expect(opts.scale).toBe(THUMBNAIL_SIZE / 800);
	});

	it("keeps a thumbnail until its template changes", async () => {
		renderSidePng.mockClear();
		let t = doc();
		const source = templateThumbnail("b", async () => t);
		expect(await source.cached()).toBeNull();
		await source.fresh();
		await source.fresh();
		expect(renderSidePng).toHaveBeenCalledTimes(1);
		expect(await source.cached()).not.toBeNull();
		t = { ...t, name: "Renamed" };
		await source.fresh();
		expect(renderSidePng).toHaveBeenCalledTimes(2);
	});

	it("hashes a template by its content", () => {
		const t = doc();
		expect(templateHash(t)).toBe(templateHash(structuredClone(t)));
		expect(templateHash(t)).not.toBe(templateHash({ ...t, name: "Other" }));
	});
});
