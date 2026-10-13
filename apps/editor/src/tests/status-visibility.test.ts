import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "freshcoat.statusItems";

async function fresh() {
	vi.resetModules();
	return import("~/app/status/visibility");
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("status item visibility", () => {
	it("hides the render stats by default and nothing else", async () => {
		const v = await fresh();
		expect(v.isStatusItemHidden("render")).toBe(true);
		expect(v.isStatusItemHidden("zoom")).toBe(false);
	});

	it("toggles an item and remembers it", async () => {
		const v = await fresh();
		v.toggleStatusItem("zoom");
		expect(v.isStatusItemHidden("zoom")).toBe(true);
		expect(JSON.parse(localStorage.getItem(KEY) ?? "")).toEqual({ zoom: true });
		expect((await fresh()).isStatusItemHidden("zoom")).toBe(true);
	});

	it("keeps only the choices that differ from the default", async () => {
		const v = await fresh();
		v.toggleStatusItem("render");
		expect(v.isStatusItemHidden("render")).toBe(false);
		expect(JSON.parse(localStorage.getItem(KEY) ?? "")).toEqual({
			render: false,
		});
		v.toggleStatusItem("render");
		expect(v.isStatusItemHidden("render")).toBe(true);
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it("carries over the old render stats setting once", async () => {
		localStorage.setItem("freshcoat.renderStats", "1");
		const v = await fresh();
		expect(v.isStatusItemHidden("render")).toBe(false);
		expect(localStorage.getItem("freshcoat.renderStats")).toBeNull();
		expect((await fresh()).isStatusItemHidden("render")).toBe(false);
	});

	it("starts from the defaults when storage is unreadable", async () => {
		localStorage.setItem(KEY, "{nope");
		const v = await fresh();
		expect(v.isStatusItemHidden("render")).toBe(true);
		expect(v.isStatusItemHidden("zoom")).toBe(false);
	});
});
