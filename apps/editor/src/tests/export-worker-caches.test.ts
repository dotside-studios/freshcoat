// @vitest-environment node
import { assetUri, type Template } from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import { createJobCaches } from "~/export/worker-caches";
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
});
