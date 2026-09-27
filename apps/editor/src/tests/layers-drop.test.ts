import type { Element, Template } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import { rectOf } from "../doc/geometry";
import { moveElements, unwrap } from "../doc/ops";
import { getElement } from "../doc/path";
import { dropToMove } from "../panels/layers/drop";
import { doc, frozenDoc, geometryOf } from "./doc-fixture";

// front, paint order: 0 a · 1 f [f1, t1, inner [deep]] · 2 m (ms) [img] ·
// 3 row [r1, r2, abs] · 4 title · 5 rot · 6 spin [spun]. The tree shows each
// list reversed: spin first, a last, then the background.

const ids = (t: Template, list: Element[] = t.template_data[0].elements) =>
	list.map((e) => e.id);
const kids = (t: Template, key: string) =>
	(getElement(t, key) as Extract<Element, { type: "frame" | "mask" }>)
		.properties.children;

function apply(
	t: Template,
	dragged: string[],
	target: string,
	pos: "before" | "after" | "on",
) {
	const move = dropToMove(t, dragged, target, pos);
	if (!move) throw new Error("drop refused");
	return unwrap(
		moveElements(t, move.keys, move.parent, move.index, geometryOf(t)),
	);
}

describe("dropToMove: before and after a row", () => {
	it("before the topmost row puts the layer on top of the stack", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/0"], "0/6", "before")).toEqual({
			keys: ["0/0"],
			parent: { side: 0 },
			index: 7,
		});
		const r = apply(t, ["0/0"], "0/6", "before");
		expect(ids(r.template)).toEqual([
			"f",
			"m",
			"row",
			"title",
			"rot",
			"spin",
			"a",
		]);
		expect(r.keys).toEqual(["0/6"]);
	});

	it("after the bottom row of a stack sends the layer to the back", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/6"], "0/0", "after")).toEqual({
			keys: ["0/6"],
			parent: { side: 0 },
			index: 0,
		});
		expect(ids(apply(t, ["0/6"], "0/0", "after").template)).toEqual([
			"spin",
			"a",
			"f",
			"m",
			"row",
			"title",
			"rot",
		]);
	});

	it("before a row paints the layer just above that row", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/0"], "0/1", "before")?.index).toBe(2);
		expect(ids(apply(t, ["0/0"], "0/1", "before").template)).toEqual([
			"f",
			"a",
			"m",
			"row",
			"title",
			"rot",
			"spin",
		]);
	});

	it("after a row paints the layer just below it", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/5"], "0/2", "after")?.index).toBe(2);
		expect(ids(apply(t, ["0/5"], "0/2", "after").template)).toEqual([
			"a",
			"f",
			"rot",
			"m",
			"row",
			"title",
			"spin",
		]);
	});

	it("before or after a nested row reparents into that row's parent", () => {
		const t = frozenDoc();
		// f1 is f's bottom child, shown last among f's rows.
		expect(dropToMove(t, ["0/0"], "0/1/0", "before")).toEqual({
			keys: ["0/0"],
			parent: "0/1",
			index: 1,
		});
		expect(dropToMove(t, ["0/0"], "0/1/0", "after")).toEqual({
			keys: ["0/0"],
			parent: "0/1",
			index: 0,
		});
		const r = apply(t, ["0/0"], "0/1/0", "before");
		// a left index 0, so f is now 0/0.
		expect(ids(r.template, kids(r.template, "0/0"))).toEqual([
			"f1",
			"a",
			"t1",
			"inner",
		]);
		expect(r.keys).toEqual(["0/0/1"]);
	});

	it("a reparented layer keeps its absolute box", () => {
		const t = frozenDoc();
		const before = rectOf(t, "0/0", geometryOf(t));
		const r = apply(t, ["0/0"], "0/1/2/0", "after");
		const key = (r.keys as string[])[0] as string;
		expect(key).toBe("0/0/2/0");
		const after = rectOf(r.template, key, geometryOf(r.template));
		expect(after?.x).toBeCloseTo(before?.x ?? Number.NaN, 5);
		expect(after?.y).toBeCloseTo(before?.y ?? Number.NaN, 5);
	});

	it("moves a nested layer out to the side's top level", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/1/2/0"], "0/6", "after")).toEqual({
			keys: ["0/1/2/0"],
			parent: { side: 0 },
			index: 6,
		});
		const r = apply(t, ["0/1/2/0"], "0/6", "after");
		expect(ids(r.template).slice(-2)).toEqual(["deep", "spin"]);
		expect(kids(r.template, "0/1/2")).toEqual([]);
	});
});

describe("dropToMove: on a row", () => {
	it("on a frame makes the layer its topmost child", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/0"], "0/1", "on")).toEqual({
			keys: ["0/0"],
			parent: "0/1",
			index: 3,
		});
		const r = apply(t, ["0/0"], "0/1", "on");
		expect(ids(r.template, kids(r.template, "0/0"))).toEqual([
			"f1",
			"t1",
			"inner",
			"a",
		]);
	});

	it("on a mask counts its children, not its source", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/0"], "0/2", "on")).toEqual({
			keys: ["0/0"],
			parent: "0/2",
			index: 1,
		});
		const r = apply(t, ["0/0"], "0/2", "on");
		expect(ids(r.template, kids(r.template, "0/1"))).toEqual(["img", "a"]);
	});

	it("on an auto-layout frame appends to its flow", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/5"], "0/3", "on")?.index).toBe(3);
	});

	it("on a child's own parent lifts it to the top of that parent", () => {
		const t = frozenDoc();
		const r = apply(t, ["0/1/0"], "0/1", "on");
		expect(ids(r.template, kids(r.template, "0/1"))).toEqual([
			"t1",
			"inner",
			"f1",
		]);
	});

	it("on a leaf is refused", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/0"], "0/4", "on")).toBeNull();
		expect(dropToMove(t, ["0/0"], "0/1/0", "on")).toBeNull();
	});
});

describe("dropToMove: refusals", () => {
	it("the background takes only a drop before it, as the bottom of the side", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/6"], "0/bg", "before")).toEqual({
			keys: ["0/6"],
			parent: { side: 0 },
			index: 0,
		});
		expect(dropToMove(t, ["0/6"], "0/bg", "after")).toBeNull();
		expect(dropToMove(t, ["0/6"], "0/bg", "on")).toBeNull();
	});

	it("the background and a mask source cannot be dragged", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/bg"], "0/6", "before")).toBeNull();
		expect(dropToMove(t, ["0/2/-1"], "0/6", "before")).toBeNull();
		expect(dropToMove(t, ["0/0", "0/bg"], "0/6", "before")).toBeNull();
	});

	it("a mask's source slot takes no drop", () => {
		const t = frozenDoc();
		for (const pos of ["before", "after", "on"] as const)
			expect(dropToMove(t, ["0/0"], "0/2/-1", pos)).toBeNull();
	});

	it("a layer cannot go inside itself", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/1"], "0/1", "on")).toBeNull();
		expect(dropToMove(t, ["0/1"], "0/1/2", "on")).toBeNull();
		expect(dropToMove(t, ["0/1"], "0/1/0", "before")).toBeNull();
		expect(dropToMove(t, ["0/1"], "0/1/2/0", "after")).toBeNull();
	});

	it("drops that change nothing are refused", () => {
		const t = frozenDoc();
		expect(dropToMove(t, ["0/6"], "0/6", "before")).toBeNull();
		expect(dropToMove(t, ["0/6"], "0/6", "after")).toBeNull();
		// a is directly below f already.
		expect(dropToMove(t, ["0/0"], "0/1", "after")).toBeNull();
		expect(dropToMove(t, ["0/1/2"], "0/1", "on")).toBeNull();
		expect(dropToMove(t, ["0/3", "0/4"], "0/4", "before")).toBeNull();
		expect(dropToMove(t, ["0/3", "0/4"], "0/2", "before")).toBeNull();
	});

	it("unknown keys, other sides and empty drags are refused", () => {
		const t = frozenDoc();
		expect(dropToMove(t, [], "0/0", "before")).toBeNull();
		expect(dropToMove(t, ["0/99"], "0/0", "before")).toBeNull();
		expect(dropToMove(t, ["0/0"], "0/99", "before")).toBeNull();
		expect(dropToMove(t, ["1/0"], "0/0", "before")).toBeNull();
	});
});

describe("dropToMove: several layers", () => {
	it("keeps their stacking order and drops descendants of dragged layers", () => {
		const t = frozenDoc();
		expect(
			dropToMove(t, ["0/4", "0/1/0", "0/0", "0/1"], "0/6", "before"),
		).toEqual({ keys: ["0/0", "0/1", "0/4"], parent: { side: 0 }, index: 7 });
		const r = apply(t, ["0/4", "0/0"], "0/6", "before");
		expect(ids(r.template)).toEqual([
			"f",
			"m",
			"row",
			"rot",
			"spin",
			"a",
			"title",
		]);
	});

	it("gathers layers from different parents into the target", () => {
		const t = frozenDoc();
		const r = apply(t, ["0/1/0", "0/6/0"], "0/2", "on");
		expect(ids(r.template, kids(r.template, "0/2"))).toEqual([
			"img",
			"f1",
			"spun",
		]);
		expect(ids(r.template, kids(r.template, "0/1"))).toEqual(["t1", "inner"]);
		expect(ids(r.template, kids(r.template, "0/6"))).toEqual([]);
	});

	it("a run that is not contiguous is not a no-op", () => {
		const t = doc();
		expect(dropToMove(t, ["0/3", "0/5"], "0/4", "before")).toEqual({
			keys: ["0/3", "0/5"],
			parent: { side: 0 },
			index: 5,
		});
	});
});
