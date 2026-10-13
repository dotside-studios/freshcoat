import type { Element, Template } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { updateElement } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { hasOpenPath, isSliceable, openPieceKeys, setSlice } from "~/doc/slice";
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

const N = doc().template_data[0]?.elements.length ?? 0;
const KEYS = { fold: `0/${N}`, loop: `0/${N + 1}`, mixed: `0/${N + 2}` };

function withVectors(): Template {
	const t = doc();
	const front = t.template_data[0];
	if (!front) throw new Error("fixture");
	const vector = (id: string, d: string): Element => ({
		id,
		type: "vector",
		pos: { x: 0, y: 0 },
		size: { width: 100, height: 10 },
		properties: { d },
	});
	return {
		...t,
		template_data: [
			{
				...front,
				elements: [
					...front.elements,
					vector("fold", "M0 5H100"),
					vector("loop", "M0 0H100V10H0Z"),
					vector("mixed", "M0 0H10V10Z M20 0H60"),
				],
			},
			...t.template_data.slice(1),
		],
	};
}

describe("open paths as slices", () => {
	test("finds an open subpath in a plain vector", () => {
		const t = withVectors();
		expect(hasOpenPath(t, KEYS.fold)).toBe(true);
		expect(hasOpenPath(t, KEYS.loop)).toBe(false);
		expect(hasOpenPath(t, KEYS.mixed)).toBe(true);
		expect(hasOpenPath(t, "0/0")).toBe(false);
	});

	test("turning on a slice for an open vector makes it a score line, not a piece", () => {
		const on = setSlice(withVectors(), [KEYS.fold, KEYS.loop], true);
		if (!on.ok) throw new Error(on.reason);
		expect(sliceOf(on.template, KEYS.fold)).toEqual({
			output: "none",
			edge: "score",
		});
		expect(sliceOf(on.template, KEYS.loop)).toEqual({});
	});
});

describe("open paths set as pieces", () => {
	test("are listed by layer key, and a cut line or closed shape is not", () => {
		const t = withVectors();
		expect(openPieceKeys(t)).toEqual([]);
		const on = setSlice(t, [KEYS.fold, KEYS.loop], true);
		if (!on.ok) throw new Error(on.reason);
		expect(openPieceKeys(on.template)).toEqual([]);
		const piece = updateElement(t, KEYS.mixed, {
			properties: { slice: { output: "piece" } },
		});
		if (!piece.ok) throw new Error(piece.reason);
		expect(openPieceKeys(piece.template)).toEqual([KEYS.mixed]);
	});
});
