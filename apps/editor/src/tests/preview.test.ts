import type { Element, Template } from "@freshcoat-js/coatfile";
import { compile, sampleValues } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { unwrap, updateElement } from "../doc/ops";
import { getElement, walkLayers } from "../doc/path";
import { buildPreview } from "../doc/preview";
import { booleanDoc, frozenDoc, PNG_BYTES, PNG_SHA } from "./doc-fixture";

const el = (t: Template, key: string) => getElement(t, key) as Element;

describe("buildPreview", () => {
	test("keeps one side and gives every layer a path id", () => {
		const t = frozenDoc();
		const p = buildPreview(t, { side: 0 });
		expect(p.template.template_data.map((f) => f.name)).toEqual(["front"]);
		expect(p.template.template_data[0].background.id).toBe("k:0/bg");
		expect(el(p.template, "0/1/2/0").id).toBe("k:0/1/2/0");
		expect(el(p.template, "0/2/-1").id).toBe("k:0/2/-1");
		const keys = [...walkLayers(t, 0)].map((e) => e.key);
		expect([...p.pathIds.values()].sort()).toEqual([...keys].sort());
		expect(p.pathIds.get("k:0/3/1")).toBe("0/3/1");
	});

	test("uses the real side index in keys", () => {
		const p = buildPreview(frozenDoc(), { side: 1 });
		expect(p.template.template_data.map((f) => f.name)).toEqual(["back"]);
		expect(p.template.template_data[0].elements[0].id).toBe("k:1/0");
		expect(p.pathIds.get("k:1/bg")).toBe("1/bg");
	});

	test("applies the variant, nested overrides included, then drops variants", () => {
		const t = frozenDoc();
		const p = buildPreview(t, { side: 0, variantId: "dark" });
		expect(p.template.variants).toBeUndefined();
		expect(p.template.template_data[0].background.properties).toEqual({
			fill: "#000000",
		});
		expect(p.template.template_data[0].background.id).toBe("k:0/bg");
		expect(el(p.template, "0/0").properties).toMatchObject({ fill: "#ff0000" });
		expect(el(p.template, "0/1/0").properties).toMatchObject({
			fill: "#00ff00",
		});
		const back = buildPreview(t, { side: 1, variantId: "dark" });
		expect(el(back.template, "0/0").properties).toMatchObject({
			fill: "#0000ff",
		});
		expect(buildPreview(t, { side: 0 }).template.variants).toBeUndefined();
	});

	test("a layer a variant hides is left out, and the rest keep their keys", () => {
		const t = frozenDoc();
		const withGone: Template = {
			...t,
			variants: [
				...(t.variants ?? []),
				{
					id: "gone",
					label: "Gone",
					overrides: [
						{
							name: "front",
							elements: [
								{ id: "a", properties: {}, hidden: true },
								{ id: "r1", properties: {}, hidden: true },
								{ id: "ms", properties: {}, hidden: true },
							],
						},
					],
				},
			],
		};
		const p = buildPreview(withGone, { side: 0, variantId: "gone" });
		const front = p.template.template_data[0];
		const base = t.template_data[0].elements.map((_, i) => `k:0/${i}`);
		expect(front.elements.map((e) => e.id)).toEqual(base.slice(1));
		const row = front.elements.find((e) => e.id === "k:0/3");
		expect(
			row?.type === "frame" && row.properties.children?.map((c) => c.id),
		).toEqual(["k:0/3/1", "k:0/3/2"]);
		// a mask keeps its shape
		const mask = front.elements.find((e) => e.id === "k:0/2");
		expect(mask?.type === "mask" && mask.properties.mask.id).toBe("k:0/2/-1");
	});

	test("an unknown variant renders the default", () => {
		const p = buildPreview(frozenDoc(), { side: 0, variantId: "nope" });
		expect(el(p.template, "0/0").properties).toMatchObject({ fill: "#111111" });
	});

	test("hidden layers get zero opacity", () => {
		const hidden = new Set(["0/0", "0/1/2/0", "0/bg"]);
		const p = buildPreview(frozenDoc(), { side: 0, hidden });
		expect(el(p.template, "0/0").opacity).toBe(0);
		expect(el(p.template, "0/1/2/0").opacity).toBe(0);
		expect(p.template.template_data[0].background.opacity).toBe(0);
		expect(el(p.template, "0/1").opacity).toBeUndefined();
	});

	test("strips assets and hands their bytes out by asset src", () => {
		const t = frozenDoc();
		const p = buildPreview(t, { side: 0 });
		expect(p.template.assets).toBeUndefined();
		expect(
			(el(p.template, "0/2/0") as { properties: { src: string } }).properties
				.src,
		).toBe(`asset:${PNG_SHA}`);
		expect([...p.images.keys()]).toEqual([`asset:${PNG_SHA}`]);
		expect(p.images.get(`asset:${PNG_SHA}`)).toEqual(PNG_BYTES);
	});

	test("decodes each asset once and keeps the images map while assets hold", () => {
		const t = frozenDoc();
		const a = buildPreview(t, { side: 0 });
		const edited = unwrap(updateElement(t, "0/0", { opacity: 0.5 })).template;
		const b = buildPreview(edited, { side: 0 });
		expect(b.images).toBe(a.images);
		expect(buildPreview(edited, { side: 1 }).images).toBe(a.images);
	});

	test("is memoised on the identity of its inputs", () => {
		const t = frozenDoc();
		const hidden = new Set<string>();
		const a = buildPreview(t, { side: 0, hidden });
		expect(buildPreview(t, { side: 0, hidden })).toBe(a);
		expect(buildPreview(t, { side: 0, hidden: new Set() })).not.toBe(a);
		expect(buildPreview(t, { side: 0, hidden, variantId: "dark" })).not.toBe(a);
	});

	test("does not mutate its input, and the result compiles", () => {
		const t = frozenDoc();
		const before = JSON.stringify(t);
		const p = buildPreview(t, {
			side: 0,
			variantId: "dark",
			hidden: new Set(["0/0"]),
		});
		expect(JSON.stringify(t)).toBe(before);
		const compiled = compile(p.template, sampleValues(t), {
			width: t.width,
			height: t.height,
		});
		expect(compiled.frames[0].root.children[1].id).toBe("k:0/0");
	});
});

describe("buildPreview with a boolean", () => {
	test("tags the operands with their keys", () => {
		const p = buildPreview(booleanDoc(), { side: 0 });
		expect(el(p.template, "0/7/0").id).toBe("k:0/7/0");
		expect(p.pathIds.get("k:0/7/1")).toBe("0/7/1");
	});

	test("leaves an operand hidden in the editor out of the result", () => {
		const p = buildPreview(booleanDoc(), {
			side: 0,
			hidden: new Set(["0/7/0"]),
		});
		const shape = el(p.template, "0/7") as Extract<Element, { type: "vector" }>;
		expect(shape.properties.boolean?.operands.map((o) => o.id)).toEqual([
			"k:0/7/1",
		]);
		expect(shape.opacity).toBeUndefined();
	});

	test("leaves an operand a variant hides out of the result", () => {
		const t = booleanDoc();
		const withVariant: Template = {
			...t,
			variants: [
				{
					id: "bare",
					label: "Bare",
					overrides: [
						{
							name: "front",
							elements: [{ id: "dot", properties: {}, hidden: true }],
						},
					],
				},
			],
		};
		const p = buildPreview(withVariant, { side: 0, variantId: "bare" });
		const shape = el(p.template, "0/7") as Extract<Element, { type: "vector" }>;
		expect(shape.properties.boolean?.operands.map((o) => o.id)).toEqual([
			"k:0/7/0",
		]);
	});
});

describe("buildPreview tolerates a document mid-edit", () => {
	test("an unknown token and a cleared name still compile", async () => {
		const { compile } = await import("@freshcoat-js/coatfile");
		const { buildPreview } = await import("~/doc/preview");
		const { doc } = await import("./doc-fixture");
		const { updateElement, unwrap } = await import("~/doc/ops");
		const base = doc();
		const edited = unwrap(
			updateElement({ ...base, name: "" }, "0/4", (el) =>
				el.type === "text"
					? {
							...el,
							properties: { ...el.properties, value: "{{half_typ}}" },
							visibleWhen: { field: "gone" },
						}
					: el,
			),
		).template;
		const p = buildPreview(edited, { side: 0 });
		expect(() =>
			compile(p.template, {}, { width: base.width, height: base.height }),
		).not.toThrow();
		expect(edited.name).toBe("");
	});
});
