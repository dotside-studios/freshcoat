import { validate } from "@freshcoat/coatfile";
import { describe, expect, test } from "vitest";
import { collectIds, uniqueId, uniquifyTree } from "../doc/ids";
import { insertElements, removeElements, unwrap } from "../doc/ops";
import {
	childPaths,
	compareKeys,
	getElement,
	isAncestor,
	keyOf,
	parentOf,
	parseKey,
	remapKeys,
	resolvableKeys,
	siblingsOf,
	walkLayers,
} from "../doc/path";
import { doc, frozenDoc } from "./doc-fixture";

describe("fixture", () => {
	test("validates", () => {
		const v = validate(doc());
		expect(v.ok ? [] : v.errors).toEqual([]);
	});
});

describe("keys", () => {
	test("keyOf and parseKey round trip", () => {
		for (const key of ["0/bg", "1/bg", "0/3", "0/3/1", "0/2/-1", "2/0/-1/4"])
			expect(keyOf(parseKey(key) as never)).toBe(key);
		expect(parseKey("0/2/-1")).toEqual({ side: 0, path: [2, -1] });
		expect(parseKey("0/bg")).toEqual({ side: 0, background: true });
	});

	test("parseKey rejects malformed keys", () => {
		for (const key of [
			"",
			"0",
			"x/1",
			"0/a",
			"-1/0",
			"0/-1",
			"0/-2",
			"0/1.5",
			"0/bg/1",
		])
			expect(parseKey(key)).toBeNull();
	});

	test("compareKeys sorts in document order", () => {
		const keys = ["0/2", "1/0", "0/1/0", "0/bg", "0/1", "0/10", "0/1/-1"];
		expect([...keys].sort(compareKeys)).toEqual([
			"0/bg",
			"0/1",
			"0/1/-1",
			"0/1/0",
			"0/2",
			"0/10",
			"1/0",
		]);
	});
});

describe("navigation", () => {
	const t = frozenDoc();

	test("getElement resolves elements, children, mask source and background", () => {
		expect(getElement(t, "0/0")?.id).toBe("a");
		expect(getElement(t, "0/1/2/0")?.id).toBe("deep");
		expect(getElement(t, "0/2/-1")?.id).toBe("ms");
		expect(getElement(t, "0/2/0")?.id).toBe("img");
		expect(getElement(t, "1/bg")?.id).toBe("bg");
		expect(getElement(t, { side: 0, path: [3, 1] })?.id).toBe("r2");
	});

	test("getElement returns undefined for missing layers", () => {
		for (const key of ["0/99", "5/0", "0/0/0", "0/1/-1", "0/1/9", "bad"])
			expect(getElement(t, key)).toBeUndefined();
	});

	test("parentOf", () => {
		expect(parentOf("0/1/2/0")).toEqual({ side: 0, path: [1, 2] });
		expect(parentOf("0/2/-1")).toEqual({ side: 0, path: [2] });
		expect(parentOf("0/1")).toBeNull();
		expect(parentOf("0/bg")).toBeNull();
	});

	test("isAncestor is strict and side-aware", () => {
		expect(isAncestor("0/1", "0/1/2/0")).toBe(true);
		expect(isAncestor("0/1/2", "0/1/2/0")).toBe(true);
		expect(isAncestor("0/2", "0/2/-1")).toBe(true);
		expect(isAncestor("0/1", "0/1")).toBe(false);
		expect(isAncestor("0/1/2", "0/1")).toBe(false);
		expect(isAncestor("0/1", "1/1/0")).toBe(false);
		expect(isAncestor("0/1", "0/10/0")).toBe(false);
		expect(isAncestor("0/bg", "0/1")).toBe(false);
	});

	test("siblingsOf", () => {
		expect(siblingsOf(t, "0/1/0").map(keyOf)).toEqual([
			"0/1/0",
			"0/1/1",
			"0/1/2",
		]);
		expect(siblingsOf(t, "1/0").map(keyOf)).toEqual(["1/0"]);
		expect(siblingsOf(t, "0/2/0").map(keyOf)).toEqual(["0/2/0"]);
		expect(siblingsOf(t, "0/2/-1").map(keyOf)).toEqual(["0/2/-1"]);
		expect(siblingsOf(t, "0/bg").map(keyOf)).toEqual(["0/bg"]);
		expect(siblingsOf(t, "0/99")).toEqual([]);
	});

	test("childPaths lists a mask's source first", () => {
		expect(childPaths(t, "0/2").map(keyOf)).toEqual(["0/2/-1", "0/2/0"]);
		expect(childPaths(t, "0/1").map(keyOf)).toEqual([
			"0/1/0",
			"0/1/1",
			"0/1/2",
		]);
		expect(childPaths(t, "0/0")).toEqual([]);
		expect(childPaths(t, "0/bg")).toEqual([]);
	});

	test("walkLayers yields every layer depth-first, background first", () => {
		const entries = [...walkLayers(t, 0)];
		expect(entries.map((e) => e.key)).toEqual([
			"0/bg",
			"0/0",
			"0/1",
			"0/1/0",
			"0/1/1",
			"0/1/2",
			"0/1/2/0",
			"0/2",
			"0/2/-1",
			"0/2/0",
			"0/3",
			"0/3/0",
			"0/3/1",
			"0/3/2",
			"0/4",
			"0/5",
			"0/6",
			"0/6/0",
		]);
		const deep = entries.find((e) => e.key === "0/1/2/0");
		expect(deep?.parentKey).toBe("0/1/2");
		expect(deep?.depth).toBe(2);
		expect(deep?.element.id).toBe("deep");
		expect([...walkLayers(t, 9)]).toEqual([]);
	});

	test("resolvableKeys drops stale keys", () => {
		expect(resolvableKeys(t, ["0/0", "0/99", "0/2/-1", "x"])).toEqual([
			"0/0",
			"0/2/-1",
		]);
	});
});

describe("remapKeys", () => {
	test("follows layers whose index shifted", () => {
		const t = frozenDoc();
		const next = unwrap(removeElements(t, ["0/0"])).template;
		expect(
			remapKeys(t, next, ["0/1/1", "0/3/0", "0/0", "1/0", "0/bg"]),
		).toEqual(["0/0/1", "0/2/0", "1/0", "0/bg"]);
	});

	test("falls back to a unique id when the object changed", () => {
		const t = frozenDoc();
		const next = unwrap(
			insertElements(t, { side: 0 }, 0, [
				{ id: "n", type: "rect", properties: {} },
			]),
		).template;
		expect(remapKeys(t, next, ["0/1/2/0"])).toEqual(["0/2/2/0"]);
	});
});

describe("ids", () => {
	test("collectIds covers every depth, the background and mask source", () => {
		const ids = collectIds(frozenDoc(), 0);
		for (const id of ["bg", "a", "f", "f1", "deep", "ms", "img", "abs", "spun"])
			expect(ids.has(id)).toBe(true);
		expect(collectIds(frozenDoc(), 1)).toEqual(new Set(["bg", "a"]));
	});

	test("uniqueId returns the base when free, else counts up", () => {
		const t = frozenDoc();
		expect(uniqueId(t, 0, "rect")).toBe("rect");
		expect(uniqueId(t, 0, "a")).toBe("a-2");
		expect(uniqueId(t, 0, "deep")).toBe("deep-2");
		expect(uniqueId(t, 1, "f1")).toBe("f1");
		expect(uniqueId(t, 0, "a", new Set(["a-2", "a-3"]))).toBe("a-4");
	});

	test("a base ending in -n counts on from its stem", () => {
		const t = unwrap(
			insertElements(frozenDoc(), { side: 0 }, 0, [
				{ id: "title-2", type: "rect", properties: {} },
			]),
		).template;
		expect(uniqueId(t, 0, "title")).toBe("title-3");
		expect(uniqueId(t, 0, "title-2")).toBe("title-3");
	});

	test("uniquifyTree renames nested ids and keeps unchanged trees", () => {
		const t = frozenDoc();
		const f = getElement(t, "0/1") as never;
		const used = collectIds(t, 0);
		const copy = uniquifyTree(f, used) as {
			id: string;
			properties: {
				children: { id: string; properties: { children?: { id: string }[] } }[];
			};
		};
		expect(copy.id).toBe("f-2");
		expect(copy.properties.children.map((c) => c.id)).toEqual([
			"f1-2",
			"t1-2",
			"inner-2",
		]);
		expect(copy.properties.children[2].properties.children?.[0].id).toBe(
			"deep-2",
		);
		const fresh = { id: "zzz", type: "rect", properties: {} } as never;
		expect(uniquifyTree(fresh, used)).toBe(fresh);
	});
});

describe("remapKeys after an edit in place", () => {
	test("keeps a renamed layer and drops a replaced sibling list", async () => {
		const { doc } = await import("./doc-fixture");
		const { renameElement, removeElements, unwrap } = await import("~/doc/ops");
		const { remapKeys } = await import("~/doc/path");
		const before = doc();
		const renamed = unwrap(renameElement(before, "0/5", "turned")).template;
		expect(remapKeys(before, renamed, ["0/5"])).toEqual(["0/5"]);
		const removed = unwrap(removeElements(before, ["0/5"])).template;
		expect(remapKeys(before, removed, ["0/5"])).toEqual([]);
	});
});
