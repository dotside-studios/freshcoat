import { describe, expect, it } from "vitest";
import { unwrap, updateElement } from "../doc/ops";
import {
	buildLayerRows,
	filterRows,
	flattenRows,
	type LayerRow,
} from "../panels/layers/rows";
import { booleanDoc, frozenDoc } from "./doc-fixture";

const find = (rows: LayerRow[], id: string): LayerRow | undefined => {
	for (const r of rows) {
		if (r.id === id) return r;
		const hit = find(r.children, id);
		if (hit) return hit;
	}
	return undefined;
};

describe("buildLayerRows", () => {
	it("lists the topmost layer first and the background last", () => {
		const rows = buildLayerRows(frozenDoc(), 0);
		expect(rows.map((r) => [r.id, r.key])).toEqual([
			["spin", "0/6"],
			["rot", "0/5"],
			["title", "0/4"],
			["row", "0/3"],
			["m", "0/2"],
			["f", "0/1"],
			["a", "0/0"],
			["bg", "0/bg"],
		]);
		expect(rows.at(-1)?.kind).toBe("background");
		expect(rows.slice(0, -1).every((r) => r.kind === "layer")).toBe(true);
	});

	it("reverses children too", () => {
		const f = find(buildLayerRows(frozenDoc(), 0), "f") as LayerRow;
		expect(f.children.map((r) => r.key)).toEqual(["0/1/2", "0/1/1", "0/1/0"]);
		expect(f.children[0]?.children.map((r) => r.id)).toEqual(["deep"]);
	});

	it("shows a mask's source as its last child, marked", () => {
		const m = find(buildLayerRows(frozenDoc(), 0), "m") as LayerRow;
		expect(m.children.map((r) => [r.id, r.key, r.kind])).toEqual([
			["img", "0/2/0", "layer"],
			["ms", "0/2/-1", "maskSource"],
		]);
		expect(m.container).toBe(true);
		expect(m.children[1]?.container).toBe(false);
	});

	it("marks containers", () => {
		const rows = buildLayerRows(frozenDoc(), 0);
		const containers = flattenRows(rows).filter(
			(k) => byKey(rows, k)?.container,
		);
		expect(containers).toEqual(["0/6", "0/3", "0/2", "0/1", "0/1/2"]);
	});

	it("shows a boolean's operands as its rows, topmost first", () => {
		const rows = buildLayerRows(booleanDoc(), 0);
		const shape = find(rows, "shape") as LayerRow;
		expect(shape.container).toBe(true);
		expect(shape.children.map((r) => [r.id, r.key, r.kind])).toEqual([
			["dot", "0/7/1", "layer"],
			["sq", "0/7/0", "layer"],
		]);
		expect(shape.children.every((r) => !r.container)).toBe(true);
		expect(flattenRows(rows).slice(0, 3)).toEqual(["0/7", "0/7/1", "0/7/0"]);
	});

	it("keeps a boolean's rows when its operand matches a filter", () => {
		const { rows, ancestors } = filterRows(
			buildLayerRows(booleanDoc(), 0),
			"dot",
		);
		expect(ancestors).toEqual(["0/7"]);
		expect(rows[0]?.children.map((r) => r.id)).toEqual(["dot"]);
	});

	it("badges layers that read a field themselves", () => {
		const rows = buildLayerRows(frozenDoc(), 0);
		const bound = (id: string) => find(rows, id)?.bound;
		expect(bound("t1")).toBe(true); // "Hi {{ name }}"
		expect(bound("title")).toBe(true); // visibleWhen and a token
		expect(bound("a")).toBe(false);
		// A frame holding a bound text is not bound itself.
		expect(bound("f")).toBe(false);
		expect(bound("bg")).toBe(false);
	});

	it("lists the fields a layer reads, tokens then conditions", () => {
		const rows = buildLayerRows(frozenDoc(), 0);
		expect(find(rows, "t1")?.fields).toEqual(["name"]);
		expect(find(rows, "title")?.fields).toEqual(["title", "show"]);
		expect(find(rows, "f")?.fields).toEqual([]);
	});

	it("lists another side on its own", () => {
		expect(buildLayerRows(frozenDoc(), 1).map((r) => r.key)).toEqual([
			"1/0",
			"1/bg",
		]);
		expect(buildLayerRows(frozenDoc(), 5)).toEqual([]);
	});

	it("flattens depth first in display order", () => {
		expect(flattenRows(buildLayerRows(frozenDoc(), 0))).toEqual([
			"0/6",
			"0/6/0",
			"0/5",
			"0/4",
			"0/3",
			"0/3/2",
			"0/3/1",
			"0/3/0",
			"0/2",
			"0/2/0",
			"0/2/-1",
			"0/1",
			"0/1/2",
			"0/1/2/0",
			"0/1/1",
			"0/1/0",
			"0/0",
			"0/bg",
		]);
	});

	it("reuses the rows of untouched layers", () => {
		const t = frozenDoc();
		const first = buildLayerRows(t, 0);
		expect(buildLayerRows(t, 0)[5]).toBe(first[5]);
		const next = unwrap(
			updateElement(t, "0/0", { properties: { fill: "#ff0000" } }),
		).template;
		const second = buildLayerRows(next, 0);
		expect(second[5]).toBe(first[5]); // f, untouched
		expect(second[6]).not.toBe(first[6]); // a, edited
	});
});

function byKey(rows: LayerRow[], key: string): LayerRow | undefined {
	for (const r of rows) {
		if (r.key === key) return r;
		const hit = byKey(r.children, key);
		if (hit) return hit;
	}
	return undefined;
}

describe("filterRows", () => {
	it("keeps matches by name and the ancestors that lead to them", () => {
		const { rows, ancestors } = filterRows(
			buildLayerRows(frozenDoc(), 0),
			"DEEP",
		);
		expect(flattenRows(rows)).toEqual(["0/1", "0/1/2", "0/1/2/0"]);
		expect(ancestors.sort()).toEqual(["0/1", "0/1/2"]);
	});

	it("matches the layer type, and the background by its role", () => {
		const all = buildLayerRows(frozenDoc(), 0);
		const { rows, ancestors } = filterRows(all, "text");
		const matched = flattenRows(rows).filter((k) => !ancestors.includes(k));
		expect(matched).toContain("0/1/1");
		expect(matched.every((k) => byKey(all, k)?.element.type === "text")).toBe(
			true,
		);
		expect(flattenRows(filterRows(all, "background").rows)).toEqual(["0/bg"]);
	});

	it("an empty query keeps every row; no match keeps none", () => {
		const all = buildLayerRows(frozenDoc(), 0);
		expect(filterRows(all, "  ").rows).toBe(all);
		expect(filterRows(all, "nothing-like-this").rows).toEqual([]);
	});
});
