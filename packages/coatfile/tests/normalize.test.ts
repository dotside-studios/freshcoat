import { describe, expect, test } from "vitest";
import { fixtures } from "../fixtures";
import {
	healElementIds,
	nextFreeId,
	uniquifyElementIds,
	uniquifyElementIdsDeep,
	unwrapLegacyBundle,
} from "../src/normalize";
import type { Element, Template } from "../src/types";
import { validate } from "../src/validate";

describe("uniquifyElementIds", () => {
	test("leaves already-unique ids untouched (same references)", () => {
		const els = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const out = uniquifyElementIds(els);
		expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
		expect(out[0]).toBe(els[0]);
	});

	test("suffixes repeated ids in occurrence order", () => {
		const out = uniquifyElementIds([
			{ id: "Vector" },
			{ id: "Vector" },
			{ id: "Vector" },
		]);
		expect(out.map((e) => e.id)).toEqual(["Vector", "Vector_2", "Vector_3"]);
	});

	test("keeps the first occurrence's id, renames only later collisions", () => {
		const a = { id: "x", keep: 1 };
		const out = uniquifyElementIds([a, { id: "x", keep: 2 }]);
		expect(out[0]).toBe(a);
		expect(out[1]).toEqual({ id: "x_2", keep: 2 });
	});

	test("does not collide with a literal id that matches a generated suffix", () => {
		const out = uniquifyElementIds([
			{ id: "Vector" },
			{ id: "Vector" },
			{ id: "Vector_2" },
		]);
		const ids = out.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length); // all unique
		expect(ids).toContain("Vector_2"); // the generated one
	});
});

describe("nextFreeId", () => {
	const taken =
		(...ids: string[]) =>
		(id: string) =>
			ids.includes(id);

	test("keeps a free id and suffixes a taken one", () => {
		expect(nextFreeId("a", taken())).toBe("a");
		expect(nextFreeId("a", taken("a"))).toBe("a_2");
		expect(nextFreeId("a", taken("a", "a_2"))).toBe("a_3");
		expect(nextFreeId("a", taken("a"), { separator: "-" })).toBe("a-2");
		expect(nextFreeId("logo_4", taken("logo_4"))).toBe("logo_4_2");
	});

	test("counts on from a numbered id's stem with fromStem", () => {
		const fromStem = true;
		expect(
			nextFreeId("title-2", taken("title-2"), { separator: "-", fromStem }),
		).toBe("title-3");
		expect(nextFreeId("logo_4", taken("logo_4"), { fromStem })).toBe("logo_5");
		expect(nextFreeId("title-2", taken("title-2"), { fromStem })).toBe(
			"title-2_2",
		);
	});
});

const node = (id: string, children?: object[]) =>
	children
		? { id, type: "frame", properties: { children } }
		: { id, type: "rect", properties: {} };

describe("uniquifyElementIdsDeep", () => {
	test("renames repeats anywhere in the tree, depth first", () => {
		const out = uniquifyElementIdsDeep([
			node("text"),
			node("group", [node("text"), node("group", [node("text")])]),
		]);
		expect(JSON.stringify(out)).toBe(
			JSON.stringify([
				node("text"),
				node("group", [node("text_2"), node("group_2", [node("text_3")])]),
			]),
		);
	});

	test("visits a mask's shape before its content", () => {
		const mask = {
			id: "m",
			type: "mask",
			properties: { mask: node("shape"), children: [node("shape")] },
		};
		const [out] = uniquifyElementIdsDeep([mask]);
		expect(out?.properties).toEqual({
			mask: node("shape"),
			children: [node("shape_2")],
		});
	});

	test("shares what it does not change", () => {
		const inner = node("inner", [node("leaf")]);
		const els = [node("a"), node("b", [inner]), node("a")];
		const out = uniquifyElementIdsDeep(els);
		expect(out[0]).toBe(els[0]);
		expect(out[1]).toBe(els[1]);
		expect(out[2]).toEqual(node("a_2"));
		expect(els[2]?.id).toBe("a");
	});

	test("gives the same tree the same ids every time", () => {
		const tree = () => [
			node("v", [node("v"), node("v")]),
			node("v", [node("v")]),
		];
		expect(uniquifyElementIdsDeep(tree())).toEqual(
			uniquifyElementIdsDeep(tree()),
		);
	});

	test("takes a separator and ids already in use, and adds to them", () => {
		const used = new Set(["title"]);
		const out = uniquifyElementIdsDeep([node("title"), node("title-2")], {
			separator: "-",
			fromStem: true,
			used,
		});
		expect(out.map((e) => e.id)).toEqual(["title-2", "title-3"]);
		expect([...used].sort()).toEqual(["title", "title-2", "title-3"]);
	});

	test("renames in place when asked, keeping every object", () => {
		const child = node("x");
		const els = [node("x"), node("f", [child])];
		const out = uniquifyElementIdsDeep(els, { inPlace: true });
		expect(out[1]).toBe(els[1]);
		expect(child.id).toBe("x_2");
	});

	test("reads nested elements where nested says, in place", () => {
		const shape = [node("x"), node("x")];
		const els = [{ id: "m", type: "mask", properties: { mask: shape } }];
		uniquifyElementIdsDeep(els, {
			inPlace: true,
			nested: (el) =>
				[(el.properties as { mask?: unknown }).mask].filter(Array.isArray),
		});
		expect(shape.map((e) => e.id)).toEqual(["x", "x_2"]);
	});

	test("dedupes 10k same-named elements in linear time", () => {
		const els = Array.from({ length: 10_000 }, () => node("r"));
		const start = performance.now();
		const out = uniquifyElementIdsDeep(els);
		expect(out.at(-1)?.id).toBe("r_10000");
		expect(performance.now() - start).toBeLessThan(200);
	});

	test("stays on the top level without deep", () => {
		const els = [node("x"), node("f", [node("x")])];
		expect(uniquifyElementIdsDeep(els, { deep: false })).toEqual(els);
	});
});

describe("healElementIds", () => {
	function withElements(elements: object[]): Template {
		const t = structuredClone(fixtures.minimalCard);
		const front = t.template_data[0];
		if (!front) throw new Error("fixture has no side");
		front.elements = elements as Element[];
		return t;
	}

	const [text] = fixtures.minimalCard.template_data[0]?.elements ?? [];
	const frame = (id: string, children: object[]) => ({
		id,
		type: "frame",
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties: { children },
	});

	test("leaves a valid file as it is", () => {
		const t = withElements([text as Element, frame("box", [text as Element])]);
		expect(validate(t).ok).toBe(true);
		expect(healElementIds(t).template_data[0]).toBe(t.template_data[0]);
	});

	test("heals top-level repeats and, by default, only those", () => {
		const id = (text as Element).id;
		const t = withElements([
			text as Element,
			text as Element,
			frame("box", [text as Element]),
		]);
		expect(validate(t).ok).toBe(false);
		const healed = healElementIds(t);
		const result = validate(healed);
		expect(result.ok).toBe(true);
		const [first, second, box] = healed.template_data[0]?.elements ?? [];
		expect([first?.id, second?.id, box?.id]).toEqual([id, `${id}_2`, "box"]);
		expect(
			(box as Extract<Element, { type: "frame" }>).properties.children[0]?.id,
		).toBe(id);
	});

	test("heals the whole tree with deep", () => {
		const id = (text as Element).id;
		const t = withElements([text as Element, frame("box", [text as Element])]);
		const healed = healElementIds(t, { deep: true });
		const [, box] = healed.template_data[0]?.elements ?? [];
		expect(
			(box as Extract<Element, { type: "frame" }>).properties.children[0]?.id,
		).toBe(`${id}_2`);
		expect(validate(healed).ok).toBe(true);
		expect(healElementIds(healed, { deep: true })).toEqual(healed);
	});
});

describe("unwrapLegacyBundle", () => {
	const template = { id: "aurora", template_data: [] };

	test("lifts a v1 bundle's template and its side-car fields to the top level", () => {
		const out = unwrapLegacyBundle({
			schemaVersion: 1,
			template,
			source: { kind: "figma", fileKey: "abc" },
			assets: [{ sha256: "a", base64: "AAAA", contentType: "image/png" }],
			warnings: [{ severity: "warn", code: "x", message: "y" }],
		}) as Record<string, unknown>;

		expect(out.id).toBe("aurora");
		expect(out.source).toEqual({ kind: "figma", fileKey: "abc" });
		expect(out.assets).toHaveLength(1);
		expect(out.warnings).toHaveLength(1);
		expect(out.schemaVersion).toBeUndefined();
		expect(out.template).toBeUndefined();
	});

	test("omits empty side-car arrays rather than writing empty ones", () => {
		const out = unwrapLegacyBundle({
			schemaVersion: 1,
			template,
			assets: [],
			warnings: [],
		}) as Record<string, unknown>;
		expect(out.assets).toBeUndefined();
		expect(out.warnings).toBeUndefined();
	});

	test("passes a current-shape template through untouched", () => {
		const current = { id: "aurora", template_data: [], assets: [] };
		expect(unwrapLegacyBundle(current)).toBe(current);
	});

	test("leaves anything that is not a v1 bundle alone", () => {
		const other = { schemaVersion: 2, template };
		expect(unwrapLegacyBundle(other)).toBe(other);
		const noTemplate = { schemaVersion: 1 };
		expect(unwrapLegacyBundle(noTemplate)).toBe(noTemplate);
		expect(unwrapLegacyBundle(null)).toBe(null);
		expect(unwrapLegacyBundle("nope")).toBe("nope");
	});

	test("is idempotent", () => {
		const once = unwrapLegacyBundle({ schemaVersion: 1, template });
		expect(unwrapLegacyBundle(once)).toBe(once);
	});
});
