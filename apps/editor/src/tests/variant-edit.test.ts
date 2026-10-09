import type {
	Element,
	Template,
	VariantElementDelta,
} from "@freshcoat-js/coatfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EditorController } from "~/app/controller";
import type { LayerGeometry } from "~/doc/geometry";
import { align, applyRect, translateLayers } from "~/doc/geometry";
import {
	addFont,
	addVariant,
	attachImageAsset,
	changeVariantId,
	duplicateElements,
	fontReferences,
	groupElements,
	insertElements,
	moveElements,
	moveVariant,
	pruneUnusedAssets,
	removeElements,
	removeFont,
	removeVariant,
	renameVariant,
	resetOverride,
	setFrameProp,
	setHiddenInVariant,
	setTemplateMeta,
	setVariantSize,
	setVariantSwatch,
	suggestSwatch,
	ungroup,
	unwrap,
	updateElement,
	updateField,
} from "~/doc/ops";
import { getElement, keyOf, walkLayers } from "~/doc/path";
import { resizeWithConstraints } from "~/doc/resize";
import {
	changedLayerCount,
	changedLayerKeys,
	foldVariantEdit,
	geometryForBase,
	hiddenInVariant,
	isHiddenInVariant,
	isStructuralEdit,
	mergedDelta,
	overriddenKeys,
	sameJson,
	workingTemplate,
} from "~/doc/variant-edit";
import {
	createEditorStore,
	type EditorState,
	present,
	reduce,
	working,
} from "~/state/store";
import { doc, geometryOf, PNG_BYTES } from "./doc-fixture";

// front: 0 a · 1 f [f1, t1, inner [deep]] · 2 m · 3 row · 4 title · 5 rot ·
// 6 spin. The fixture's "dark" variant recolours the front background, a and
// f1, and the back's a.

afterEach(() => {
	vi.restoreAllMocks();
});

function opened(t: Template = doc(), variant: string | null = "dark") {
	const c = new EditorController();
	c.open(t, "doc.coat");
	c.dispatch({
		type: "rendered",
		geometry: geometryOf(t),
		timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
		stats: {} as never,
		warnings: [],
	});
	if (variant) c.setVariant(variant);
	return c;
}

const base = (c: EditorController) => c.base as Template;
const shown = (c: EditorController) => c.template as Template;
const el = (t: Template, key: string) => getElement(t, key) as Element;
const delta = (t: Template, id: string, side = "front", variant = "dark") =>
	mergedDelta(t, variant, side, id);

/** `t` with one more delta on a side of a variant. */
function withDelta(
	t: Template,
	d: VariantElementDelta,
	side = "front",
	variant = "dark",
): Template {
	return {
		...t,
		variants: t.variants?.map((v) =>
			v.id !== variant
				? v
				: {
						...v,
						overrides: v.overrides.some((ov) => ov.name === side)
							? v.overrides.map((ov) =>
									ov.name === side
										? { ...ov, elements: [...(ov.elements ?? []), d] }
										: ov,
								)
							: [...v.overrides, { name: side, elements: [d] }],
					},
		),
	};
}

describe("the working template", () => {
	test("is the base with the variant applied, hidden layers kept", () => {
		const t = withDelta(doc(), { id: "rot", properties: {}, hidden: true });
		const w = workingTemplate(t, "dark");
		expect(el(w, "0/0").properties).toMatchObject({ fill: "#ff0000" });
		expect(el(w, "0/5").id).toBe("rot");
		expect(w.variants).toBe(t.variants);
		expect(w.template_data[1]?.elements[0]?.properties).toMatchObject({
			fill: "#0000ff",
		});
	});

	test("is memoised on the base and the variant", () => {
		const t = doc();
		expect(workingTemplate(t, "dark")).toBe(workingTemplate(t, "dark"));
		expect(workingTemplate(t, undefined)).toBe(t);
		expect(workingTemplate(t, "nope")).toBe(t);
		const c = opened(t);
		expect(working(c.state)).toBe(working(c.state));
		expect(c.template).toBe(
			workingTemplate(present(c.state) as Template, "dark"),
		);
	});

	test("present stays the base", () => {
		const c = opened();
		expect(el(base(c), "0/0").properties).toMatchObject({ fill: "#111111" });
		expect(el(shown(c), "0/0").properties).toMatchObject({ fill: "#ff0000" });
	});
});

describe("editing in a variant", () => {
	test("a value edit writes a delta and leaves the base unchanged", () => {
		const c = opened();
		const before = base(c);
		c.edit((t) => updateElement(t, "0/0", { pos: { x: 50, y: 60 } }));
		expect(base(c).template_data).toBe(before.template_data);
		expect(delta(base(c), "a")).toEqual({
			id: "a",
			properties: { fill: "#ff0000" },
			pos: { x: 50, y: 60 },
		});
		expect(el(shown(c), "0/0").pos).toEqual({ x: 50, y: 60 });
	});

	test("setting a value back to the base's drops it", () => {
		const c = opened();
		c.edit((t) =>
			updateElement(t, "0/1/0", { properties: { fill: "#222222" } }),
		);
		expect(delta(base(c), "f1")).toBeUndefined();
		expect(delta(base(c), "a")).toBeDefined();
		c.edit((t) => updateElement(t, "0/0", { properties: { fill: "#111111" } }));
		const front = base(c).variants?.[0]?.overrides.find(
			(o) => o.name === "front",
		);
		expect(front?.elements).toBeUndefined();
		expect(front?.background).toBeDefined();
	});

	test("background edits land on the override", () => {
		const c = opened();
		c.edit((t) =>
			updateElement(t, "0/bg", { properties: { fill: "#123456" } }),
		);
		expect(base(c).template_data[0]?.background.properties).toEqual({
			fill: "#ffffff",
		});
		const bg = base(c).variants?.[0]?.overrides[0]?.background;
		expect(bg?.properties).toEqual({ fill: "#123456" });
		const own = doc().template_data[0]?.background;
		c.edit((t) => setFrameProp(t, 0, { background: own }));
		expect(overriddenKeys(base(c), "dark", "front")).toEqual([]);
	});

	test("a drag through txPreview is one step folded into the variant", () => {
		const c = opened();
		const geometry = c.state.geometry;
		const past = c.state.doc?.history.past.length ?? 0;
		c.beginTx();
		const start = shown(c);
		c.previewTx(translateLayers(start, ["0/0"], 5, 5, geometry));
		expect(delta(base(c), "a")?.pos).toEqual({ x: 15, y: 25 });
		c.previewTx(translateLayers(start, ["0/0"], 10, 10, geometry));
		c.endTx();
		expect(c.state.doc?.history.past.length).toBe(past + 1);
		expect(delta(base(c), "a")?.pos).toEqual({ x: 20, y: 30 });
		expect(el(base(c), "0/0").pos).toEqual({ x: 10, y: 20 });
		c.undo();
		expect(delta(base(c), "a")?.pos).toBeUndefined();
		c.redo();
		expect(delta(base(c), "a")?.pos).toEqual({ x: 20, y: 30 });
	});

	test("undo and redo step through variant edits", () => {
		const c = opened();
		c.edit((t) => updateElement(t, "0/5", { opacity: 0.5 }));
		c.edit((t) => updateElement(t, "0/5", { rotation: 45 }));
		expect(delta(base(c), "rot")).toMatchObject({ opacity: 0.5, rotation: 45 });
		c.undo();
		expect(delta(base(c), "rot")).toEqual({
			id: "rot",
			properties: {},
			opacity: 0.5,
		});
		c.undo();
		expect(delta(base(c), "rot")).toBeUndefined();
		c.redo();
		c.redo();
		expect(delta(base(c), "rot")?.rotation).toBe(45);
	});

	test("an edit that changes nothing commits nothing", () => {
		const c = opened();
		const before = base(c);
		c.edit((t) => updateElement(t, "0/0", { properties: { fill: "#ff0000" } }));
		expect(base(c)).toBe(before);
	});

	test("hidden is carried and orphaned deltas are kept", () => {
		const t = withDelta(
			withDelta(doc(), { id: "rot", properties: {}, hidden: true }),
			{ id: "gone", properties: { fill: "#000" } },
		);
		const c = opened(t);
		c.edit((d) => updateElement(d, "0/5", { opacity: 0.2 }));
		expect(delta(base(c), "rot")).toEqual({
			id: "rot",
			properties: {},
			opacity: 0.2,
			hidden: true,
		});
		expect(delta(base(c), "gone")).toEqual({
			id: "gone",
			properties: { fill: "#000" },
		});
	});

	test("with no variant active an edit is the base's, as before", () => {
		const c = opened(doc(), null);
		c.edit((t) => updateElement(t, "0/0", { pos: { x: 1, y: 2 } }));
		expect(el(base(c), "0/0").pos).toEqual({ x: 1, y: 2 });
		expect(delta(base(c), "a")?.pos).toBeUndefined();
	});

	test("scope base edits the base while a variant is active", () => {
		const c = opened();
		c.edit((t) => updateElement(t, "0/0", { opacity: 0.4 }), {
			scope: "base",
		});
		expect(el(base(c), "0/0").opacity).toBe(0.4);
		expect(delta(base(c), "a")?.opacity).toBeUndefined();
	});

	test("fonts added with a variant edit join the template", () => {
		const c = opened();
		c.edit((t) => {
			const added = unwrap(
				addFont(t, { kind: "google", family: "Lora", url: "https://x" }),
			).template;
			return updateElement(added, "0/1/1", {
				properties: { font: { family: "Lora", size: 16 } },
			});
		});
		expect(base(c).fonts?.map((f) => f.family)).toEqual(["Inter", "Lora"]);
		expect(delta(base(c), "t1")?.properties).toEqual({
			font: { family: "Lora", size: 16 },
		});
		expect(fontReferences(base(c), "Lora")).toEqual(["variant:dark"]);
	});
});

describe("the structural branch", () => {
	test("keeps the new structure with the base's values", () => {
		const t = doc();
		const w = workingTemplate(t, "dark");
		const next = unwrap(removeElements(w, ["0/0"])).template;
		expect(isStructuralEdit(w, next)).toBe(true);
		const out = foldVariantEdit(t, "dark", next);
		expect(out.template_data[0]?.elements.map((e) => e.id)).toEqual(
			t.template_data[0]?.elements.slice(1).map((e) => e.id),
		);
		expect(el(out, "0/0/0").properties).toMatchObject({ fill: "#222222" });
		expect(out.template_data[0]?.background).toBe(
			t.template_data[0]?.background,
		);
		expect(delta(out, "a")).toBeUndefined();
		expect(delta(out, "f1")).toBeDefined();
		expect(delta(out, "a", "back")).toBeDefined();
	});

	test("the controller names the op in development", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const c = opened();
		c.edit((t) => removeElements(t, ["0/5"]));
		expect(warn).toHaveBeenCalledOnce();
		expect(el(base(c), "0/0").properties).toMatchObject({ fill: "#111111" });
	});

	test("no op that edits values reaches it", async () => {
		const t = doc();
		const w = workingTemplate(t, "dark");
		const geometry = geometryOf(w);
		const extra = unwrap(
			addFont(w, { kind: "google", family: "Lora", url: "https://x" }),
		).template;
		const attached = await attachImageAsset(w, PNG_BYTES, "image/png");
		const results: Record<string, Template> = {
			updateElement: unwrap(updateElement(w, "0/1/1", { opacity: 0.3 }))
				.template,
			updateBackground: unwrap(
				updateElement(w, "0/bg", { properties: { fill: "#abcdef" } }),
			).template,
			setFrameProp: unwrap(
				setFrameProp(w, 1, {
					background: { id: "bg", type: "rect", properties: {} },
				}),
			).template,
			setTemplateMeta: unwrap(setTemplateMeta(w, { name: "Other" })).template,
			updateField: unwrap(
				updateField(w, "name", { type: "string", title: "Full name" }),
			).template,
			addFont: extra,
			removeFont: unwrap(removeFont(extra, "Lora")).template,
			attachImageAsset: attached.template,
			pruneUnusedAssets: pruneUnusedAssets(w),
			translateLayers: translateLayers(w, ["0/0", "0/1/0"], 4, 4, geometry),
			applyRect: unwrap(
				applyRect(
					w,
					"0/5",
					{ x: 10, y: 10, width: 20, height: 20, rotation: 5 },
					geometry,
				),
			).template,
			align: unwrap(align(w, ["0/0", "0/5"], geometry, "left")).template,
		};
		for (const [name, next] of Object.entries(results)) {
			expect(isStructuralEdit(w, next), name).toBe(false);
			expect(foldVariantEdit(t, "dark", next).template_data, name).toBe(
				t.template_data,
			);
		}
	});
});

describe("structural ops keep variants in step", () => {
	test("commands scoped to the base edit every variant's layers", () => {
		const c = opened();
		c.select(["0/5"]);
		c.duplicateSelection();
		expect(base(c).template_data[0]?.elements[6]?.id).toBe("rot-2");
		c.select(["0/0"]);
		c.deleteSelection();
		expect(delta(base(c), "a")).toBeUndefined();
		expect(delta(base(c), "a", "back")).toBeDefined();
		expect(c.state.variantId).toBe("dark");
	});

	test("removeElements drops the deltas of what it removes, nested ones too", () => {
		const out = unwrap(removeElements(doc(), ["0/1"])).template;
		expect(delta(out, "f1")).toBeUndefined();
		expect(delta(out, "a")).toBeDefined();
		const all = unwrap(removeElements(out, ["0/0"])).template;
		const front = all.variants?.[0]?.overrides.find((o) => o.name === "front");
		expect(front?.elements).toBeUndefined();
		expect(front?.background).toBeDefined();
	});

	test("moveElements keeps deltas and re-expresses a moved pos", () => {
		const t = withDelta(doc(), {
			id: "f1",
			properties: {},
			pos: { x: 1, y: 1 },
		});
		const geometry = geometryOf(t);
		const out = unwrap(
			moveElements(t, ["0/1/0"], { side: 0 }, 0, geometry),
		).template;
		expect(el(out, "0/0").id).toBe("f1");
		expect(el(out, "0/0").pos).toEqual({ x: 210, y: 110 });
		expect(delta(out, "f1")?.pos).toEqual({ x: 201, y: 101 });
		expect(delta(out, "f1")?.properties).toEqual({ fill: "#00ff00" });
	});

	test("duplicateElements copies deltas, offsetting a copied pos", () => {
		const t = withDelta(doc(), {
			id: "a",
			properties: {},
			pos: { x: 50, y: 60 },
		});
		const out = unwrap(duplicateElements(t, ["0/0"])).template;
		expect(el(out, "0/1").id).toBe("a-2");
		expect(el(out, "0/1").pos).toEqual({ x: 20, y: 30 });
		expect(delta(out, "a-2")).toEqual({
			id: "a-2",
			properties: { fill: "#ff0000" },
			pos: { x: 60, y: 70 },
		});
		const frame = unwrap(duplicateElements(t, ["0/1"])).template;
		expect(el(frame, "0/2/0").id).toBe("f1-2");
		expect(delta(frame, "f1-2")).toEqual({
			id: "f1-2",
			properties: { fill: "#00ff00" },
		});
		const still = unwrap(duplicateElements(t, ["0/0"], { offset: 0 })).template;
		expect(delta(still, "a-2")?.pos).toEqual({ x: 50, y: 60 });
	});

	test("groupElements keeps deltas and shifts pos into the group", () => {
		const t = withDelta(doc(), {
			id: "a",
			properties: {},
			pos: { x: 50, y: 60 },
		});
		const out = unwrap(groupElements(t, ["0/0"], geometryOf(t))).template;
		expect(el(out, "0/0").id).toBe("group");
		expect(el(out, "0/0/0").pos).toEqual({ x: 0, y: 0 });
		expect(delta(out, "a")?.pos).toEqual({ x: 40, y: 40 });
	});

	test("ungroup drops the group's deltas and shifts its children's", () => {
		const t = withDelta(
			withDelta(doc(), { id: "f1", properties: {}, pos: { x: 0, y: 0 } }),
			{ id: "f", properties: { fill: "#000" } },
		);
		const out = unwrap(ungroup(t, "0/1", geometryOf(t))).template;
		expect(el(out, "0/1").id).toBe("f1");
		expect(delta(out, "f")).toBeUndefined();
		expect(delta(out, "f1")?.pos).toEqual({ x: 200, y: 100 });
	});

	test("a new layer never picks up an orphaned delta", () => {
		const t = withDelta(doc(), { id: "new", properties: { fill: "#f00" } });
		const r = unwrap(
			insertElements(t, { side: 0 }, 0, [
				{ id: "new", type: "rect", properties: {} },
			]),
		);
		expect(el(r.template, "0/0").id).toBe("new-2");
	});

	test("resizing with constraints carries the variants", () => {
		const t = doc();
		const sized = {
			...t,
			variants: t.variants?.map((v) => ({
				...v,
				overrides: v.overrides.map((ov) =>
					ov.background
						? {
								...ov,
								background: {
									...ov.background,
									size: { width: 1000, height: 600 },
								},
							}
						: ov,
				),
			})),
		};
		const out = unwrap(resizeWithConstraints(sized, 1200, 800)).template;
		expect(out.variants?.[0]?.overrides[0]?.background?.size).toEqual({
			width: 1200,
			height: 800,
		});
		expect(out.template_data[0]?.background.size).toEqual({
			width: 1200,
			height: 800,
		});
	});

	test("geometry for the base leaves out layers the variant moves", () => {
		const t = withDelta(doc(), {
			id: "f",
			properties: {},
			pos: { x: 0, y: 0 },
		});
		const g = geometryOf(workingTemplate(t, "dark"));
		const out = geometryForBase(t, "dark", g);
		expect(out.has("0/1")).toBe(false);
		expect(out.has("0/1/0")).toBe(false);
		expect(out.has("0/0")).toBe(true);
		expect(geometryForBase(t, undefined, g)).toBe(g);
	});
});

describe("variant management", () => {
	test("addVariant derives a unique id from the label", () => {
		const t = doc();
		const r = addVariant(t, { label: "Dark" });
		expect(r.ok && r.variantId).toBe("dark-2");
		expect(addVariant(t, { label: " " }).ok).toBe(false);
	});

	test("addVariant starts empty with the suggested swatch, or copies", () => {
		const t = doc();
		const fresh = unwrap(addVariant(t, { label: "Light" })).template;
		expect(fresh.variants?.[1]).toEqual({
			id: "light",
			label: "Light",
			swatch: "#ffffff",
			overrides: [],
		});
		const withSwatch = unwrap(setVariantSwatch(t, "dark", "#101010")).template;
		const copy = unwrap(
			addVariant(withSwatch, { label: "Dark copy", from: "dark" }),
		).template;
		const v = copy.variants?.[1];
		expect(v?.swatch).toBe("#101010");
		expect(v?.overrides).toEqual(t.variants?.[0]?.overrides);
		expect(v?.overrides).not.toBe(t.variants?.[0]?.overrides);
		expect(addVariant(t, { label: "X", from: "nope" }).ok).toBe(false);
	});

	test("suggestSwatch reads the first side's background", () => {
		const t = doc();
		expect(suggestSwatch(t)).toBe("#ffffff");
		expect(suggestSwatch(t, "dark")).toBe("#000000");
		const gradient = unwrap(
			updateElement(t, "0/bg", {
				properties: {
					fill: [
						{
							kind: "linear",
							angle: 0,
							stops: [
								{ offset: 0, color: "#aa0000" },
								{ offset: 1, color: "#00aa00" },
							],
						},
					],
				},
			}),
		).template;
		expect(suggestSwatch(gradient)).toBe("#aa0000");
		const field = unwrap(
			updateElement(t, "0/bg", { properties: { fill: "{{colour}}" } }),
		).template;
		expect(suggestSwatch(field)).toBeUndefined();
	});

	test("renameVariant changes the label only", () => {
		const t = doc();
		const out = unwrap(renameVariant(t, "dark", " Night ")).template;
		expect(out.variants?.[0]).toMatchObject({ id: "dark", label: "Night" });
		expect(renameVariant(t, "dark", "").ok).toBe(false);
		expect(renameVariant(t, "nope", "X").ok).toBe(false);
	});

	test("setVariantSwatch sets and clears", () => {
		const t = unwrap(setVariantSwatch(doc(), "dark", "#222")).template;
		expect(t.variants?.[0]?.swatch).toBe("#222");
		const cleared = unwrap(setVariantSwatch(t, "dark")).template;
		expect(cleared.variants?.[0]).not.toHaveProperty("swatch");
	});

	test("moveVariant reorders and removeVariant removes", () => {
		const t = unwrap(addVariant(doc(), { label: "Light" })).template;
		const moved = unwrap(moveVariant(t, "light", 0)).template;
		expect(moved.variants?.map((v) => v.id)).toEqual(["light", "dark"]);
		expect(moveVariant(t, "light", 2).ok).toBe(false);
		const one = unwrap(removeVariant(moved, "light")).template;
		expect(one.variants?.map((v) => v.id)).toEqual(["dark"]);
		expect(unwrap(removeVariant(one, "dark")).template).not.toHaveProperty(
			"variants",
		);
	});

	test("changeVariantId refuses empty, non-slug, reserved and taken ids", () => {
		const t = unwrap(addVariant(doc(), { label: "Light" })).template;
		const code = (next: string) => {
			const r = changeVariantId(t, "dark", next);
			return r.ok ? "ok" : r.code;
		};
		expect(code("")).toBe("invalid_variant_id");
		expect(code("Night")).toBe("invalid_variant_id");
		expect(code("default")).toBe("invalid_variant_id");
		expect(code("light")).toBe("duplicate_variant_id");
		expect(code("night")).toBe("ok");
		expect(
			unwrap(changeVariantId(t, "dark", "night")).template.variants?.map(
				(v) => v.id,
			),
		).toEqual(["night", "light"]);
	});

	test("resetOverride drops keys, a delta, a background or a side", () => {
		const t = withDelta(doc(), {
			id: "a",
			properties: { stroke: { color: "#000", width: 1 } },
			pos: { x: 1, y: 1 },
		});
		const keys = unwrap(
			resetOverride(t, "dark", "front", "a", ["fill", "pos"]),
		).template;
		expect(overriddenKeys(keys, "dark", "front", "a")).toEqual(["stroke"]);
		const whole = unwrap(resetOverride(t, "dark", "front", "a")).template;
		expect(delta(whole, "a")).toBeUndefined();
		expect(delta(whole, "f1")).toBeDefined();
		const bg = unwrap(
			resetOverride(t, "dark", "front", undefined, ["background"]),
		).template;
		expect(overriddenKeys(bg, "dark", "front")).toEqual([]);
		expect(delta(bg, "f1")).toBeDefined();
		const side = unwrap(resetOverride(t, "dark", "front")).template;
		expect(side.variants?.[0]?.overrides.map((o) => o.name)).toEqual(["back"]);
		expect(resetOverride(t, "nope", "front").ok).toBe(false);
	});

	test("setHiddenInVariant adds and drops the change", () => {
		const t = doc();
		const hidden = unwrap(
			setHiddenInVariant(t, "dark", "front", "rot", true),
		).template;
		expect(isHiddenInVariant(hidden, "dark", "front", "rot")).toBe(true);
		expect(delta(hidden, "rot")).toEqual({
			id: "rot",
			properties: {},
			hidden: true,
		});
		const shownAgain = unwrap(
			setHiddenInVariant(hidden, "dark", "front", "rot", false),
		).template;
		expect(delta(shownAgain, "rot")).toBeUndefined();
		const onA = unwrap(
			setHiddenInVariant(t, "dark", "front", "a", true),
		).template;
		expect(delta(onA, "a")).toEqual({
			id: "a",
			properties: { fill: "#ff0000" },
			hidden: true,
		});
		const back = unwrap(
			setHiddenInVariant(t, "dark", "back", "a", true),
		).template;
		expect(hiddenInVariant(back, "dark", "back")).toEqual(new Set(["a"]));
		expect(setHiddenInVariant(t, "dark", "front", "zzz", true).ok).toBe(false);
	});

	test("overridden keys and changed layers", () => {
		const t = withDelta(doc(), { id: "rot", properties: {}, hidden: true });
		expect(overriddenKeys(t, "dark", "front", "a")).toEqual(["fill"]);
		expect(overriddenKeys(t, "dark", "front")).toEqual(["background"]);
		expect(overriddenKeys(t, "dark", "front", "rot")).toEqual([]);
		expect(changedLayerKeys(t, "dark", 0)).toEqual([
			"0/bg",
			"0/0",
			"0/1/0",
			"0/5",
		]);
		expect(changedLayerCount(t, "dark")).toBe(5);
	});

	test("the controller repoints a fixed binding and follows the active id", () => {
		const c = opened();
		const id = c.state.workspace?.activeTemplateId as string;
		c.dispatch({
			type: "setBinding",
			id,
			binding: {
				datasetId: "d",
				fields: {},
				variant: { kind: "fixed", id: "dark" },
			},
		});
		const binding = () =>
			c.state.workspace?.templates.find((s) => s.id === id)?.binding;
		expect(c.changeVariantId("dark", "night")).toBe(true);
		expect(binding()?.variant).toEqual({ kind: "fixed", id: "night" });
		expect(c.state.variantId).toBe("night");
		expect(c.removeVariant("night")).toBe(true);
		expect(binding()?.variant).toEqual({ kind: "fixed" });
		expect(c.state.variantId).toBeUndefined();
	});

	test("the controller adds a variant as one step", () => {
		const c = opened();
		expect(c.addVariant("Light")).toBe("light");
		expect(base(c).variants?.map((v) => v.id)).toEqual(["dark", "light"]);
		expect(c.state.variantId).toBe("dark");
		c.undo();
		expect(base(c).variants?.map((v) => v.id)).toEqual(["dark"]);
	});
});

describe("view state", () => {
	test("setVariant with an id the base lacks is Default", () => {
		const c = opened();
		c.setVariant("nope");
		expect(c.state.variantId).toBeUndefined();
	});

	test("a variant that goes away with an edit, undo or redo is reset", () => {
		const c = opened();
		c.edit((t) => unwrap(addVariant(t, { label: "Light" })), {
			scope: "base",
		});
		c.setVariant("light");
		c.undo();
		expect(c.state.variantId).toBeUndefined();
		c.redo();
		c.setVariant("light");
		c.edit((t) => removeVariant(t, "light"), { scope: "base" });
		expect(c.state.variantId).toBeUndefined();
	});

	test("opening or switching to a template keeps only a variant it has", () => {
		const store = createEditorStore();
		store.dispatch({ type: "open", template: doc(), fileName: "a.coat" });
		store.dispatch({ type: "setVariant", variantId: "dark" });
		const { variants: _v, ...plain } = doc();
		store.dispatch({ type: "open", template: plain, fileName: "b.coat" });
		expect(store.getState().variantId).toBeUndefined();
		const first = store.getState().workspace?.templates[0]?.id as string;
		store.dispatch({ type: "switchTemplate", id: first });
		expect(store.getState().variantId).toBe("dark");
	});

	test("a record preview gives back the variant it replaced", () => {
		const store = createEditorStore();
		store.dispatch({ type: "open", template: doc(), fileName: "a.coat" });
		store.dispatch({ type: "setVariant", variantId: "dark" });
		const preview = (s: EditorState, id: string, variantId?: string) =>
			reduce(s, { type: "previewRecord", id, values: {}, variantId });
		let s = preview(store.getState(), "r1");
		expect(s.variantId).toBeUndefined();
		s = preview(s, "r2", "dark");
		expect(s.variantId).toBe("dark");
		s = reduce(s, { type: "resetValues" });
		expect(s.variantId).toBe("dark");
		expect(s.previewRecordId).toBeNull();

		// Choosing a variant by hand during the preview keeps it afterwards.
		s = preview(reduce(s, { type: "setVariant" }), "r1");
		s = reduce(s, { type: "setVariant", variantId: "dark" });
		s = reduce(s, { type: "resetValues" });
		expect(s.variantId).toBe("dark");
	});

	test("a record naming an unknown variant previews Default", () => {
		const store = createEditorStore();
		store.dispatch({ type: "open", template: doc(), fileName: "a.coat" });
		const s = reduce(store.getState(), {
			type: "previewRecord",
			id: "r1",
			values: {},
			variantId: "nope",
		});
		expect(s.variantId).toBeUndefined();
	});
});

describe("sameJson", () => {
	test("ignores key order and treats undefined as missing", () => {
		expect(sameJson({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
		expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
		expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(true);
		expect(sameJson([1, 2], [2, 1])).toBe(false);
		expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
	});
});

describe("variant change counts", () => {
	function manyVariants(): Template {
		const t = doc();
		return {
			...t,
			variants: [
				...(t.variants ?? []),
				{
					id: "nested",
					label: "Nested",
					overrides: [
						{
							name: "front",
							elements: [
								{ id: "deep", properties: { fill: "#111111" } },
								{ id: "inner", properties: {}, pos: { x: 4, y: 4 } },
								{ id: "t1", properties: {}, hidden: true },
								{ id: "ghost", properties: { fill: "#222222" } },
							],
						},
						{
							name: "front",
							elements: [
								{ id: "t1", properties: {}, hidden: false },
								{ id: "rot", properties: {}, rotation: 30 },
								{ id: "spin", properties: { fill: undefined } },
							],
						},
					],
				},
				{
					id: "split",
					label: "Split",
					overrides: [
						{
							name: "back",
							background: {
								id: "bg",
								type: "rect",
								properties: { fill: "#333333" },
							},
						},
						{
							name: "front",
							elements: [{ id: "f", properties: {}, opacity: 0.5 }],
						},
						{
							name: "front",
							elements: [{ id: "f1", properties: {}, hidden: true }],
						},
					],
				},
				{ id: "empty", label: "Empty", overrides: [] },
			],
		};
	}

	function countBefore(t: Template, variantId: string): number {
		let n = 0;
		t.template_data.forEach((frame, side) => {
			for (const e of walkLayers(t, side)) {
				const changed =
					e.key.endsWith("/bg") && "background" in e.path
						? overriddenKeys(t, variantId, frame.name).length > 0
						: overriddenKeys(t, variantId, frame.name, e.element.id).length >
								0 || isHiddenInVariant(t, variantId, frame.name, e.element.id);
				if (changed) n++;
			}
		});
		return n;
	}

	function geometryBefore(
		t: Template,
		variantId: string,
		geometry: LayerGeometry,
	): LayerGeometry {
		const moved: string[] = [];
		t.template_data.forEach((frame, side) => {
			for (const e of walkLayers(t, side)) {
				if ("background" in e.path) continue;
				const d = mergedDelta(t, variantId, frame.name, e.element.id);
				if (
					d &&
					(d.pos ||
						d.size ||
						d.rotation !== undefined ||
						d.opacity !== undefined)
				)
					moved.push(keyOf(e.path));
			}
		});
		if (moved.length === 0) return geometry;
		const out: LayerGeometry = new Map();
		for (const [key, box] of geometry)
			if (!moved.some((m) => key === m || key.startsWith(`${m}/`)))
				out.set(key, box);
		return out;
	}

	test("counts match a per-layer read of the overrides", () => {
		const t = manyVariants();
		for (const v of t.variants ?? [])
			expect(changedLayerCount(t, v.id)).toBe(countBefore(t, v.id));
		expect(changedLayerCount(t, "nested")).toBe(3);
		expect(changedLayerCount(t, "nope")).toBe(0);
	});

	test("a template's counts are computed once", () => {
		const t = manyVariants();
		const data = t.template_data;
		let reads = 0;
		Object.defineProperty(t, "template_data", {
			get: () => {
				reads++;
				return data;
			},
		});
		const first = changedLayerCount(t, "nested");
		const after = reads;
		expect(after).toBeGreaterThan(0);
		expect(changedLayerCount(t, "nested")).toBe(first);
		expect(reads).toBe(after);
	});

	test("geometry for the base matches a per-layer read of the overrides", () => {
		const t = manyVariants();
		for (const v of t.variants ?? []) {
			const g = geometryOf(workingTemplate(t, v.id));
			expect([...geometryForBase(t, v.id, g).keys()]).toEqual([
				...geometryBefore(t, v.id, g).keys(),
			]);
		}
		const g = geometryOf(workingTemplate(t, "nested"));
		const out = geometryForBase(t, "nested", g);
		expect(out.has("0/1/2")).toBe(false);
		expect(out.has("0/1/2/0")).toBe(false);
		expect(out.has("0/1/0")).toBe(true);
	});
});

describe("a variant with its own size", () => {
	const sized = () => {
		const t = doc();
		const front = t.template_data[0];
		if (front)
			front.elements = front.elements.map((e) =>
				e.id === "a"
					? { ...e, constraints: { horizontal: "end", vertical: "end" } }
					: e,
			);
		const out = setVariantSize(t, "dark", { width: 600, height: 1000 });
		if (!out.ok) throw new Error("refused");
		return out.template;
	};

	test("setVariantSize sets it, and Default's size clears it", () => {
		const t = sized();
		expect(t.variants?.[0]?.size).toEqual({ width: 600, height: 1000 });
		expect(t.width).toBe(1000);
		const back = setVariantSize(t, "dark", { width: 1000, height: 600 });
		expect(back.ok && back.template.variants?.[0]?.size).toBeUndefined();
		expect(setVariantSize(t, "dark", { width: 0, height: 10 }).ok).toBe(false);
		expect(setVariantSize(t, "nope", undefined).ok).toBe(false);
	});

	test("the canvas shows the base laid out at that size", () => {
		const c = opened(sized());
		expect(shown(c).width).toBe(600);
		expect(shown(c).height).toBe(1000);
		expect(el(shown(c), "0/0").pos).toEqual({ x: -390, y: 420 });
	});

	test("an edit lands as a delta in the variant's units, the base unchanged", () => {
		const c = opened(sized());
		c.edit((t) => updateElement(t, "0/0", { pos: { x: 40, y: 900 } }));
		expect(base(c).width).toBe(1000);
		expect(base(c).height).toBe(600);
		expect(el(base(c), "0/0").pos).toEqual({ x: 10, y: 20 });
		expect(delta(base(c), "a")?.pos).toEqual({ x: 40, y: 900 });
		c.edit((t) => updateElement(t, "0/0", { pos: { x: -390, y: 420 } }));
		expect(delta(base(c), "a")?.pos).toBeUndefined();
	});

	test("a structural op keeps the base's size", () => {
		const c = opened(sized());
		c.edit((t) => removeElements(t, ["0/4"]), { scope: "base" });
		expect(base(c).template_data[0]?.elements).toHaveLength(6);
		expect(base(c).width).toBe(1000);
		expect(base(c).variants?.[0]?.size).toEqual({ width: 600, height: 1000 });
	});

	test("no laid-out box is kept for an op on the base", () => {
		const t = sized();
		expect(geometryForBase(t, "dark", geometryOf(t)).size).toBe(0);
	});
});
