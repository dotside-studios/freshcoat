import type { Template } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { getElement } from "~/doc/path";
import { isSliceable, setSlice } from "~/doc/slice";
import { doc } from "./doc-fixture";

const sliceOf = (t: Template, key: string) =>
	(getElement(t, key)?.properties as { slice?: object }).slice;

describe("slice ops", () => {
	test("only top-level rects and vectors can be slices", () => {
		const t = doc();
		expect(isSliceable(t, "0/0")).toBe(true);
		expect(isSliceable(t, "0/5")).toBe(true);
		expect(isSliceable(t, "0/1")).toBe(false);
		expect(isSliceable(t, "0/1/0")).toBe(false);
		expect(isSliceable(t, "0/4")).toBe(false);
		expect(isSliceable(t, "0/bg")).toBe(false);
		expect(isSliceable(t, "0/9")).toBe(false);
	});

	test("setSlice adds an empty modifier and removes it", () => {
		const on = setSlice(doc(), ["0/0", "0/5"], true);
		if (!on.ok) throw new Error(on.reason);
		expect(sliceOf(on.template, "0/0")).toEqual({});
		expect(sliceOf(on.template, "0/5")).toEqual({});
		const off = setSlice(on.template, ["0/0"], false);
		if (!off.ok) throw new Error(off.reason);
		expect(sliceOf(off.template, "0/0")).toBeUndefined();
		expect(sliceOf(off.template, "0/5")).toEqual({});
	});

	test("keeps an existing slice and skips layers that cannot be one", () => {
		const first = setSlice(doc(), ["0/0"], true);
		if (!first.ok) throw new Error(first.reason);
		const edited = {
			...first.template,
		} as Template;
		const again = setSlice(edited, ["0/0", "0/1", "0/4"], true);
		if (!again.ok) throw new Error(again.reason);
		expect(sliceOf(again.template, "0/1")).toBeUndefined();
		expect(sliceOf(again.template, "0/4")).toBeUndefined();
	});
});
