// @vitest-environment node
import { assetUri, type Template } from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import { createJobCaches, createWorkerText } from "~/export/worker-caches";
import { minimal } from "~/samples/minimal";

describe("render worker job caches", () => {
	it("are kept across items and emptied at job end", () => {
		const caches = createJobCaches();
		const paint = caches.paint();
		const analysis = caches.analysis();
		expect(caches.paint()).toBe(paint);
		expect(caches.analysis()).toBe(analysis);
		const dispose = vi.spyOn(paint, "dispose");

		caches.clear();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(caches.paint()).not.toBe(paint);
		expect(caches.analysis()).not.toBe(analysis);
		expect(caches.analysis().size).toBe(0);
	});

	it("key a template's assets by their sha256", () => {
		const sha = "a".repeat(64);
		const template: Template = {
			...minimal(),
			assets: [{ sha256: sha, contentType: "image/png", base64: btoa("png") }],
		} as Template;
		const caches = createJobCaches();
		const key = caches.analysisKey(template);
		expect(key(`data:image/png;base64,${btoa("png")}`)).toBe(assetUri(sha));
		expect(key("ws:abc")).toBeUndefined();
	});

	it("tell apart assets whose data URLs sample alike", () => {
		const a = "a".repeat(64);
		const b = "b".repeat(64);
		const body = (mid: string) => `${"A".repeat(500)}${mid}${"A".repeat(500)}`;
		const template: Template = {
			...minimal(),
			assets: [
				{ sha256: a, contentType: "image/png", base64: body("QUJD") },
				{ sha256: b, contentType: "image/png", base64: body("REVG") },
			],
		} as Template;
		const key = createJobCaches().analysisKey(template);
		expect(key(`data:image/png;base64,${body("QUJD")}`)).toBe(assetUri(a));
		expect(key(`data:image/png;base64,${body("REVG")}`)).toBe(assetUri(b));
		expect(key(`data:image/png;base64,${body("R0hJ")}`)).toBeUndefined();
	});

	it("memoize the text engine, and rebuild it when the fonts change", () => {
		const fakeEngine = () => ({
			measureText: vi.fn(() => ({ width: 10, height: 12 })),
			measureSpanWidth: vi.fn((_text: string, _font: unknown) => 10),
			layoutText: vi.fn(),
			dispose: vi.fn(),
		});
		const create = vi.fn(fakeEngine);
		const text = createWorkerText<ReturnType<typeof fakeEngine>>();
		const fonts = new Map<string, Uint8Array[]>();
		const font = { family: "Geist", weight: 400, style: "normal", size: 13 };

		const first = text.get(fonts, create);
		expect(text.get(fonts, create)).toBe(first);
		first.engine.measureSpanWidth("hello", font as never);
		first.engine.measureSpanWidth("hello", font as never);
		expect(first.engine.cacheStats()).toMatchObject({ hits: 1, misses: 1 });
		const inner = create.mock.results[0].value;
		expect(inner.measureSpanWidth).toHaveBeenCalledTimes(1);

		const second = text.get(new Map(), create);
		expect(create).toHaveBeenCalledTimes(2);
		expect(inner.dispose).toHaveBeenCalledTimes(1);
		expect(second.engine.cacheStats()).toMatchObject({ hits: 0, size: 0 });

		text.clear();
		expect(create.mock.results[1].value.dispose).toHaveBeenCalledTimes(1);
		expect(text.get(fonts, create).engine).not.toBe(first.engine);
	});
});
