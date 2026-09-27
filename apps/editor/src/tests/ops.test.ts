import type { Element, Template } from "@freshcoat-js/coatfile";
import { subtleSha256, validate } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import {
	addField,
	addFont,
	addSide,
	attachImageAsset,
	duplicateElements,
	fieldReferences,
	groupElements,
	insertElements,
	moveElements,
	moveSide,
	type OpResult,
	pruneUnusedAssets,
	removeElements,
	removeField,
	removeFont,
	removeSide,
	renameElement,
	renameField,
	resizeTemplate,
	setFrameProp,
	setTemplateMeta,
	ungroup,
	unwrap,
	updateElement,
	updateField,
} from "../doc/ops";
import { getElement } from "../doc/path";
import {
	deepFreeze,
	doc,
	frozenDoc,
	geometryOf,
	PNG_BYTES,
	PNG_SHA,
} from "./doc-fixture";

function expectValid(t: Template) {
	const v = validate(t);
	expect(v.ok ? [] : v.errors).toEqual([]);
}

function refused(r: OpResult, code: string) {
	expect(r.ok).toBe(false);
	if (!r.ok) {
		expect(r.code).toBe(code);
		expect(r.reason.length).toBeGreaterThan(0);
	}
	return r;
}

const el = (t: Template, key: string) => getElement(t, key) as Element;
const ids = (t: Template, side = 0) =>
	t.template_data[side].elements.map((e) => e.id);

describe("updateElement", () => {
	test("merges shell fields and properties one level deep", () => {
		const t = frozenDoc();
		const r = unwrap(
			updateElement(t, "0/1/0", {
				pos: { x: 1, y: 2 },
				opacity: 0.5,
				properties: { cornerRadius: 4 },
			}),
		);
		const f1 = el(r.template, "0/1/0");
		expect(f1).toMatchObject({
			id: "f1",
			pos: { x: 1, y: 2 },
			opacity: 0.5,
			properties: { fill: "#222222", cornerRadius: 4 },
		});
		expect(r.keys).toEqual(["0/1/0"]);
		expectValid(r.template);
	});

	test("shares untouched subtrees and leaves the input alone", () => {
		const t = frozenDoc();
		const before = JSON.stringify(t);
		const r = unwrap(updateElement(t, "0/1/0", { opacity: 0.2 }));
		expect(JSON.stringify(t)).toBe(before);
		expect(r.template.template_data[1]).toBe(t.template_data[1]);
		expect(el(r.template, "0/0")).toBe(el(t, "0/0"));
		expect(el(r.template, "0/1/1")).toBe(el(t, "0/1/1"));
		expect(el(r.template, "0/1")).not.toBe(el(t, "0/1"));
		expect(r.template.variants).toBe(t.variants);
	});

	test("undefined removes a key", () => {
		const r = unwrap(
			updateElement(frozenDoc(), "0/5", {
				rotation: undefined,
				properties: { fill: undefined },
			}),
		);
		expect("rotation" in el(r.template, "0/5")).toBe(false);
	});

	test("a function replaces the element", () => {
		const r = unwrap(
			updateElement(frozenDoc(), "0/0", (e) => ({ ...e, id: "swapped" })),
		);
		expect(el(r.template, "0/0").id).toBe("swapped");
	});

	test("works on the background and on a mask source", () => {
		const t = frozenDoc();
		const bg = unwrap(
			updateElement(t, "0/bg", { properties: { fill: "#123456" } }),
		);
		expect(bg.template.template_data[0].background.properties).toEqual({
			fill: "#123456",
		});
		const ms = unwrap(updateElement(t, "0/2/-1", { opacity: 0.4 }));
		expect(el(ms.template, "0/2/-1").opacity).toBe(0.4);
		expectValid(ms.template);
	});

	test("refuses a missing layer", () => {
		refused(updateElement(frozenDoc(), "0/42", { opacity: 1 }), "not_found");
	});
});

describe("insertElements", () => {
	const rect = (id: string): Element => ({
		id,
		type: "rect",
		pos: { x: 0, y: 0 },
		size: { width: 1, height: 1 },
		properties: {},
	});

	test("inserts at an index on the side and returns the new keys", () => {
		const r = unwrap(
			insertElements(frozenDoc(), { side: 0 }, 1, [rect("n1"), rect("n2")]),
		);
		expect(ids(r.template).slice(0, 4)).toEqual(["a", "n1", "n2", "f"]);
		expect(r.keys).toEqual(["0/1", "0/2"]);
		expectValid(r.template);
	});

	test("makes ids unique across the side, nested included", () => {
		const frame: Element = {
			id: "f",
			type: "frame",
			properties: { children: [rect("deep"), rect("x")] },
		};
		const r = unwrap(
			insertElements(frozenDoc(), { side: 0 }, 99, [
				rect("a"),
				rect("a"),
				frame,
			]),
		);
		expect(r.keys).toEqual(["0/7", "0/8", "0/9"]);
		expect(r.keys?.map((k) => el(r.template, k).id)).toEqual([
			"a-2",
			"a-3",
			"f-2",
		]);
		expect(el(r.template, "0/9/0").id).toBe("deep-2");
		expect(el(r.template, "0/9/1").id).toBe("x");
		expectValid(r.template);
	});

	test("inserts into a frame and a mask", () => {
		const t = frozenDoc();
		const r = unwrap(insertElements(t, "0/1", 0, [rect("z")]));
		expect(r.keys).toEqual(["0/1/0"]);
		expect(el(r.template, "0/1/1").id).toBe("f1");
		const m = unwrap(insertElements(t, "0/2", 1, [rect("z")]));
		expect(m.keys).toEqual(["0/2/1"]);
	});

	test("clamps the index", () => {
		const r = unwrap(insertElements(frozenDoc(), "0/1", -5, [rect("z")]));
		expect(r.keys).toEqual(["0/1/0"]);
	});

	test("refuses a leaf, the background and a missing parent", () => {
		const t = frozenDoc();
		refused(insertElements(t, "0/0", 0, [rect("z")]), "not_a_container");
		refused(insertElements(t, "0/bg", 0, [rect("z")]), "background");
		refused(insertElements(t, "0/77", 0, [rect("z")]), "not_found");
		refused(insertElements(t, { side: 7 }, 0, [rect("z")]), "not_found");
	});
});

describe("removeElements", () => {
	test("removes several layers, nested ones included, deepest first", () => {
		const r = unwrap(
			removeElements(frozenDoc(), ["0/0", "0/1/0", "0/1/2/0", "0/3"]),
		);
		expect(ids(r.template)).toEqual(["f", "m", "title", "rot", "spin"]);
		expect(el(r.template, "0/0/0").id).toBe("t1");
		expect(
			(el(r.template, "0/0/1") as { properties: { children: Element[] } })
				.properties.children,
		).toEqual([]);
		expectValid(r.template);
	});

	test("a layer inside another removed one is ignored", () => {
		const r = unwrap(removeElements(frozenDoc(), ["0/1/0", "0/1"]));
		expect(ids(r.template)).toEqual(["a", "m", "row", "title", "rot", "spin"]);
	});

	test("refuses the background and a mask source", () => {
		refused(removeElements(frozenDoc(), ["0/0", "0/bg"]), "background");
		refused(removeElements(frozenDoc(), ["0/2/-1"]), "mask_source");
		refused(removeElements(frozenDoc(), ["0/88"]), "not_found");
	});
});

describe("moveElements", () => {
	const geometry = geometryOf(doc());

	test("reorders within a list, reading the index before the move", () => {
		const r = unwrap(
			moveElements(frozenDoc(), ["0/0"], { side: 0 }, 3, geometry),
		);
		expect(ids(r.template)).toEqual([
			"f",
			"m",
			"a",
			"row",
			"title",
			"rot",
			"spin",
		]);
		expect(r.keys).toEqual(["0/2"]);
		expect(el(r.template, "0/2").pos).toEqual({ x: 10, y: 20 });
		const back = unwrap(
			moveElements(frozenDoc(), ["0/4", "0/5"], { side: 0 }, 0, geometry),
		);
		expect(ids(back.template)).toEqual([
			"title",
			"rot",
			"a",
			"f",
			"m",
			"row",
			"spin",
		]);
		expect(back.keys).toEqual(["0/0", "0/1"]);
	});

	test("reparenting keeps the absolute position", () => {
		const t = frozenDoc();
		const r = unwrap(moveElements(t, ["0/0"], "0/1", 3, geometry));
		// The frame shifted up one once `a` left the top level.
		expect(r.keys).toEqual(["0/0/3"]);
		expect(el(r.template, "0/0/3")).toMatchObject({
			id: "a",
			pos: { x: -190, y: -80 },
		});
		const out = unwrap(moveElements(t, ["0/1/2/0"], { side: 0 }, 99, geometry));
		expect(out.keys).toEqual(["0/7"]);
		expect(el(out.template, "0/7").pos).toEqual({ x: 305, y: 206 });
		expectValid(out.template);
	});

	test("moves several layers, keeping their order", () => {
		const r = unwrap(
			moveElements(frozenDoc(), ["0/5", "0/0"], "0/1/2", 0, geometry),
		);
		expect(r.keys).toEqual(["0/0/2/0", "0/0/2/1"]);
		expect(el(r.template, "0/0/2/0").id).toBe("a");
		expect(el(r.template, "0/0/2/1").id).toBe("rot");
		expect(el(r.template, "0/0/2/2").id).toBe("deep");
	});

	test("refuses moving into itself, the background, across sides", () => {
		const t = frozenDoc();
		refused(moveElements(t, ["0/1"], "0/1/2", 0, geometry), "into_descendant");
		refused(moveElements(t, ["0/1"], "0/1", 0, geometry), "into_descendant");
		refused(moveElements(t, ["0/bg"], { side: 0 }, 0, geometry), "background");
		refused(
			moveElements(t, ["0/2/-1"], { side: 0 }, 0, geometry),
			"mask_source",
		);
		refused(moveElements(t, ["0/0"], { side: 1 }, 0, geometry), "cross_side");
		refused(moveElements(t, ["0/0"], "0/5", 0, geometry), "not_a_container");
		refused(moveElements(t, ["0/0"], "0/bg", 0, geometry), "background");
		refused(moveElements(t, [], { side: 0 }, 0, geometry), "empty_selection");
	});

	test("without geometry falls back to the template's offsets", () => {
		const r = unwrap(
			moveElements(frozenDoc(), ["0/1/2/0"], { side: 0 }, 0, new Map()),
		);
		expect(el(r.template, "0/0").pos).toEqual({ x: 305, y: 206 });
	});
});

describe("duplicateElements", () => {
	test("places an offset copy directly above the original", () => {
		const r = unwrap(duplicateElements(frozenDoc(), ["0/0"]));
		expect(ids(r.template).slice(0, 3)).toEqual(["a", "a-2", "f"]);
		expect(el(r.template, "0/1").pos).toEqual({ x: 20, y: 30 });
		expect(r.keys).toEqual(["0/1"]);
		expectValid(r.template);
	});

	test("copies nested layers with unique ids", () => {
		const r = unwrap(duplicateElements(frozenDoc(), ["0/1"]));
		expect(el(r.template, "0/2").id).toBe("f-2");
		expect(el(r.template, "0/2/2/0").id).toBe("deep-2");
		expect(el(r.template, "0/2").pos).toEqual({ x: 210, y: 110 });
	});

	test("does not offset inside auto layout", () => {
		const r = unwrap(duplicateElements(frozenDoc(), ["0/3/0", "0/3/2"]));
		expect(el(r.template, "0/3/1")).toMatchObject({ id: "r1-2" });
		expect(el(r.template, "0/3/1").pos).toBeUndefined();
		// An absolute child is still placed by hand, so it is offset.
		expect(el(r.template, "0/3/4")).toMatchObject({
			id: "abs-2",
			pos: { x: 15, y: 15 },
		});
		expect(r.keys).toEqual(["0/3/1", "0/3/4"]);
	});

	test("returns every copy's key after later copies shift earlier ones", () => {
		const r = unwrap(duplicateElements(frozenDoc(), ["0/1/0", "0/0", "0/4"]));
		expect(r.keys?.map((k) => el(r.template, k).id)).toEqual([
			"a-2",
			"f1-2",
			"title-2",
		]);
		expect(r.keys).toEqual(["0/1", "0/2/1", "0/6"]);
	});

	test("refuses the background", () => {
		refused(duplicateElements(frozenDoc(), ["0/bg"]), "background");
	});
});

describe("groupElements", () => {
	const geometry = geometryOf(doc());

	test("wraps siblings in a frame at their union box", () => {
		const r = unwrap(groupElements(frozenDoc(), ["0/1/0", "0/1/1"], geometry));
		expect(r.keys).toEqual(["0/1/0"]);
		const g = el(r.template, "0/1/0") as Extract<Element, { type: "frame" }>;
		expect(g).toMatchObject({
			id: "group",
			type: "frame",
			pos: { x: 10, y: 10 },
			size: { width: 160, height: 50 },
		});
		expect(g.properties.children.map((c) => [c.id, c.pos])).toEqual([
			["f1", { x: 0, y: 0 }],
			["t1", { x: 60, y: 0 }],
		]);
		expect(el(r.template, "0/1/1").id).toBe("inner");
		expectValid(r.template);
	});

	test("places the frame where the topmost layer was", () => {
		const r = unwrap(groupElements(frozenDoc(), ["0/0", "0/2"], geometry));
		expect(ids(r.template)).toEqual([
			"f",
			"group",
			"row",
			"title",
			"rot",
			"spin",
		]);
		expect(r.keys).toEqual(["0/1"]);
		expect(el(r.template, "0/1")).toMatchObject({
			pos: { x: 10, y: 20 },
			size: { width: 240, height: 380 },
		});
	});

	test("a rotated member contributes its painted bounds", () => {
		const r = unwrap(groupElements(frozenDoc(), ["0/5"], geometry));
		const g = el(r.template, "0/5");
		const child = el(r.template, "0/5/0");
		expect(child.rotation).toBe(30);
		expect(g.pos?.x ?? 0).toBeLessThan(700);
		expect((g.pos?.x ?? 0) + (child.pos?.x ?? 0)).toBeCloseTo(700, 1);
		expect((g.pos?.y ?? 0) + (child.pos?.y ?? 0)).toBeCloseTo(300, 1);
	});

	test("refuses non-siblings and the background", () => {
		refused(
			groupElements(frozenDoc(), ["0/0", "0/1/0"], geometry),
			"not_siblings",
		);
		refused(
			groupElements(frozenDoc(), ["0/bg", "0/0"], geometry),
			"background",
		);
		refused(groupElements(frozenDoc(), [], geometry), "empty_selection");
	});
});

describe("ungroup", () => {
	const geometry = geometryOf(doc());

	test("lifts children into the parent keeping absolute boxes", () => {
		const r = unwrap(ungroup(frozenDoc(), "0/1", geometry));
		expect(ids(r.template).slice(0, 5)).toEqual([
			"a",
			"f1",
			"t1",
			"inner",
			"m",
		]);
		expect(el(r.template, "0/1").pos).toEqual({ x: 210, y: 110 });
		expect(el(r.template, "0/3").pos).toEqual({ x: 300, y: 200 });
		expect(el(r.template, "0/3/0").pos).toEqual({ x: 5, y: 6 });
		expect(r.keys).toEqual(["0/1", "0/2", "0/3"]);
		expectValid(r.template);
	});

	test("group then ungroup restores positions", () => {
		const t = frozenDoc();
		const g = unwrap(groupElements(t, ["0/1/0", "0/1/1"], geometry));
		const u = unwrap(ungroup(g.template, "0/1/0", geometryOf(g.template)));
		expect(u.template.template_data[0].elements[1]).toEqual(
			t.template_data[0].elements[1],
		);
	});

	test("refuses a rotated frame, an auto-layout frame and non-frames", () => {
		const t = frozenDoc();
		refused(ungroup(t, "0/6", geometry), "rotated");
		refused(ungroup(t, "0/3", geometry), "auto_layout");
		refused(ungroup(t, "0/0", geometry), "not_a_frame");
		refused(ungroup(t, "0/2", geometry), "not_a_frame");
		refused(ungroup(t, "0/bg", geometry), "not_a_frame");
		refused(ungroup(t, "0/99", geometry), "not_found");
	});
});

describe("renameElement", () => {
	test("renames and rewrites the variant overrides on its side", () => {
		const r = unwrap(renameElement(frozenDoc(), "0/1/0", "swatch"));
		expect(el(r.template, "0/1/0").id).toBe("swatch");
		const front = r.template.variants?.[0].overrides[0];
		expect(front?.elements?.map((e) => e.id)).toEqual(["a", "swatch"]);
		expectValid(r.template);
	});

	test("leaves another side's override with the same id alone", () => {
		const r = unwrap(renameElement(frozenDoc(), "0/0", "b"));
		const [front, back] = r.template.variants?.[0].overrides ?? [];
		expect(front.elements?.[0].id).toBe("b");
		expect(back.elements?.[0].id).toBe("a");
	});

	test("refuses an empty or used id", () => {
		const t = frozenDoc();
		refused(renameElement(t, "0/0", "  "), "empty_id");
		refused(renameElement(t, "0/0", "deep"), "duplicate_id");
		refused(renameElement(t, "0/0", "ms"), "duplicate_id");
		refused(renameElement(t, "0/9", "x"), "not_found");
	});

	test("the same id on another side is fine, and the same id is a no-op", () => {
		const t = frozenDoc();
		expect(unwrap(renameElement(t, "1/0", "deep")).template).not.toBe(t);
		expect(unwrap(renameElement(t, "0/0", "a")).template).toBe(t);
	});
});

describe("sides", () => {
	test("setFrameProp renames a side and its overrides", () => {
		const r = unwrap(setFrameProp(frozenDoc(), 0, { name: "face" }));
		expect(r.template.template_data[0].name).toBe("face");
		expect(r.template.variants?.[0].overrides.map((o) => o.name)).toEqual([
			"face",
			"back",
		]);
		expectValid(r.template);
	});

	test("setFrameProp replaces the background", () => {
		const bg = {
			id: "bg",
			type: "rect" as const,
			properties: { fill: "#abcdef" },
		};
		const r = unwrap(setFrameProp(frozenDoc(), 1, { background: bg }));
		expect(r.template.template_data[1].background).toBe(bg);
		expect(r.keys).toEqual(["1/bg"]);
	});

	test("setFrameProp refuses a duplicate or empty name", () => {
		refused(setFrameProp(frozenDoc(), 0, { name: "back" }), "duplicate_side");
		refused(setFrameProp(frozenDoc(), 0, { name: " " }), "empty_name");
		refused(setFrameProp(frozenDoc(), 5, { name: "x" }), "not_found");
	});

	test("addSide appends a white side", () => {
		const r = unwrap(addSide(frozenDoc(), "inside"));
		expect(r.template.template_data.map((f) => f.name)).toEqual([
			"front",
			"back",
			"inside",
		]);
		expect(r.keys).toEqual(["2/bg"]);
		expectValid(r.template);
		refused(addSide(frozenDoc(), "back"), "duplicate_side");
		refused(addSide(frozenDoc(), ""), "empty_name");
	});

	test("removeSide drops its overrides and refuses the last side", () => {
		const r = unwrap(removeSide(frozenDoc(), 1));
		expect(r.template.template_data.map((f) => f.name)).toEqual(["front"]);
		expect(r.template.variants?.[0].overrides.map((o) => o.name)).toEqual([
			"front",
		]);
		expectValid(r.template);
		refused(removeSide(r.template, 0), "last_side");
		refused(removeSide(frozenDoc(), 4), "not_found");
	});

	test("moveSide reorders", () => {
		const r = unwrap(moveSide(frozenDoc(), 1, 0));
		expect(r.template.template_data.map((f) => f.name)).toEqual([
			"back",
			"front",
		]);
		refused(moveSide(frozenDoc(), 0, 2), "invalid_index");
		refused(moveSide(frozenDoc(), 3, 0), "invalid_index");
	});
});

describe("template", () => {
	test("setTemplateMeta sets fields and drops empty optionals", () => {
		const r = unwrap(
			setTemplateMeta(frozenDoc(), {
				name: "New",
				description: "d",
				product: "",
				author: { name: "Me" },
			}),
		);
		expect(r.template).toMatchObject({
			name: "New",
			description: "d",
			author: { name: "Me" },
		});
		expect("product" in r.template).toBe(false);
		expectValid(r.template);
		refused(setTemplateMeta(frozenDoc(), { name: "" }), "empty_name");
		refused(setTemplateMeta(frozenDoc(), { id: " " }), "empty_name");
	});

	test("resizeTemplate changes size and backgrounds that carry one", () => {
		const t = deepFreeze({
			...doc(),
			variants: [
				{
					id: "v",
					label: "V",
					overrides: [
						{
							name: "front",
							background: {
								id: "bg",
								type: "rect" as const,
								size: { width: 1000, height: 600 },
								properties: {},
							},
						},
					],
				},
			],
		});
		const r = unwrap(resizeTemplate(t, 800, 500));
		expect(r.template.width).toBe(800);
		expect(r.template.template_data[0].background.size).toEqual({
			width: 800,
			height: 500,
		});
		expect(r.template.template_data[1].background.size).toBeUndefined();
		expect(r.template.variants?.[0].overrides[0].background?.size).toEqual({
			width: 800,
			height: 500,
		});
		expect(el(r.template, "0/0")).toBe(el(t, "0/0"));
		expectValid(r.template);
		for (const [w, h] of [
			[0, 10],
			[10.5, 10],
			[16385, 10],
			[10, -1],
		])
			refused(resizeTemplate(t, w, h), "invalid_size");
		expect(unwrap(resizeTemplate(t, 16384, 1)).template.width).toBe(16384);
	});
});

describe("fields", () => {
	test("addField and updateField", () => {
		const t = frozenDoc();
		const r = unwrap(addField(t, "city", { type: "string", title: "City" }));
		expect(Object.keys(r.template.fields.properties)).toEqual([
			"name",
			"title",
			"show",
			"city",
		]);
		refused(addField(t, "name", { type: "string" }), "duplicate_field");
		refused(addField(t, "9lives", { type: "string" }), "invalid_field_key");
		refused(addField(t, "has space", { type: "string" }), "invalid_field_key");
		const u = unwrap(updateField(t, "name", { type: "string", default: "Bo" }));
		expect(u.template.fields.properties.name.default).toBe("Bo");
		refused(updateField(t, "nope", { type: "string" }), "unknown_field");
	});

	test("renameField rewrites tokens, visibleWhen, required and variants", () => {
		const t = deepFreeze({
			...doc(),
			variants: [
				{
					id: "v",
					label: "V",
					overrides: [
						{
							name: "front",
							elements: [{ id: "t1", properties: { value: "Yo {{name}}" } }],
						},
					],
				},
			],
		});
		const withShow = unwrap(renameField(t, "show", "visible"));
		expect(el(withShow.template, "0/4").visibleWhen).toEqual({
			field: "visible",
		});
		const r = unwrap(renameField(withShow.template, "name", "full_name"));
		expect(
			(el(r.template, "0/1/1") as { properties: { value: string } }).properties
				.value,
		).toBe("Hi {{ full_name }}");
		expect(
			r.template.variants?.[0].overrides[0].elements?.[0].properties.value,
		).toBe("Yo {{full_name}}");
		expect(Object.keys(r.template.fields.properties)).toEqual([
			"full_name",
			"title",
			"visible",
		]);
		expect(r.template.fields.required).toEqual(["full_name", "title"]);
		expect(el(r.template, "0/0")).toBe(el(t, "0/0"));
		expectValid(r.template);
	});

	test("renameField does not touch a longer name that shares a prefix", () => {
		const t = unwrap(
			addField(frozenDoc(), "name2", { type: "string" }),
		).template;
		const t2 = unwrap(
			updateElement(t, "0/0", { properties: { fill: "{{name2}}" } }),
		).template;
		const r = unwrap(renameField(t2, "name", "n"));
		expect(
			(el(r.template, "0/0") as { properties: { fill: string } }).properties
				.fill,
		).toBe("{{name2}}");
	});

	test("renameField refusals", () => {
		const t = frozenDoc();
		refused(renameField(t, "nope", "x"), "unknown_field");
		refused(renameField(t, "name", "title"), "duplicate_field");
		refused(renameField(t, "name", "bad-key"), "invalid_field_key");
		expect(unwrap(renameField(t, "name", "name")).template).toBe(t);
	});

	test("removeField refuses while referenced and lists the layers", () => {
		const t = frozenDoc();
		const r = refused(removeField(t, "name"), "field_in_use");
		expect(!r.ok && r.references).toEqual(["0/1/1"]);
		const s = refused(removeField(t, "show"), "field_in_use");
		expect(!s.ok && s.references).toEqual(["0/4"]);
		refused(removeField(t, "nope"), "unknown_field");
	});

	test("fieldReferences finds variant overrides", () => {
		const t = unwrap(
			addField(frozenDoc(), "tint", { type: "string" }),
		).template;
		const withVariant = {
			...t,
			variants: [
				{
					id: "v",
					label: "V",
					overrides: [
						{
							name: "front",
							elements: [{ id: "a", properties: { fill: "{{tint}}" } }],
						},
					],
				},
			],
		};
		expect(fieldReferences(withVariant, "tint")).toEqual(["variant:v"]);
	});

	test("removeField removes an unreferenced field and its required entry", () => {
		const t = unwrap(removeElements(frozenDoc(), ["0/4"])).template;
		const r = unwrap(removeField(t, "title"));
		expect(Object.keys(r.template.fields.properties)).toEqual(["name", "show"]);
		expect(r.template.fields.required).toEqual(["name"]);
		expectValid(r.template);
	});
});

describe("fonts", () => {
	const local = {
		kind: "local" as const,
		family: "Mine",
		files: [{ weight: 400 as const, src: "data:font/woff2;base64,AA==" }],
	};

	test("addFont refuses a duplicate family", () => {
		const r = unwrap(addFont(frozenDoc(), local));
		expect(r.template.fonts?.map((f) => f.family)).toEqual(["Inter", "Mine"]);
		refused(addFont(r.template, local), "duplicate_font");
	});

	test("removeFont refuses a family in use", () => {
		const t = frozenDoc();
		const r = refused(removeFont(t, "Inter"), "font_in_use");
		expect(!r.ok && r.references).toEqual(["0/1/1", "0/4"]);
		refused(removeFont(t, "Nope"), "unknown_font");
		const added = unwrap(addFont(t, local)).template;
		expect(unwrap(removeFont(added, "Mine")).template.fonts).toEqual(t.fonts);
	});

	test("removing the last font drops the block", () => {
		const t = { ...doc(), fonts: [local] };
		expect("fonts" in unwrap(removeFont(t, "Mine")).template).toBe(false);
	});
});

describe("assets", () => {
	test("attachImageAsset embeds by sha256 once", async () => {
		const t = frozenDoc();
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const r = await attachImageAsset(t, bytes, "image/png");
		const sha = await subtleSha256(bytes);
		expect(r.src).toBe(`asset:${sha}`);
		expect(r.template.assets?.map((a) => a.sha256)).toEqual([PNG_SHA, sha]);
		const again = await attachImageAsset(r.template, bytes, "image/png");
		expect(again.template).toBe(r.template);
		const existing = await attachImageAsset(t, PNG_BYTES, "image/png");
		expect(existing.template).toBe(t);
	});

	test("pruneUnusedAssets drops only what nothing references", () => {
		const t = frozenDoc();
		expect(pruneUnusedAssets(t)).toBe(t);
		const extra = {
			...t,
			assets: [
				...(t.assets ?? []),
				{ sha256: "feed", base64: "AA==", contentType: "image/png" },
				{ sha256: "f0e7", base64: "AA==", contentType: "font/woff2" },
			],
			fonts: [
				...(t.fonts ?? []),
				{
					kind: "local" as const,
					family: "Embedded",
					files: [{ weight: 400 as const, src: "asset:f0e7" }],
				},
			],
		};
		expect(pruneUnusedAssets(extra).assets?.map((a) => a.sha256)).toEqual([
			PNG_SHA,
			"f0e7",
		]);
		const none = unwrap(removeElements(t, ["0/2"])).template;
		expect("assets" in pruneUnusedAssets(none)).toBe(false);
	});
});
