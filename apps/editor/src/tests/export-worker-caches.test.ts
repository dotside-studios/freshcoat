// @vitest-environment node
import { assetUri, type Template } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { createJobCaches } from "~/export/worker-caches";
import { minimal } from "~/samples/minimal";

describe("render worker job caches", () => {
	it("are kept across items and emptied at job end", () => {
		const caches = createJobCaches();
		const analysis = caches.analysis();
		expect(caches.analysis()).toBe(analysis);

		caches.clear();
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
});
