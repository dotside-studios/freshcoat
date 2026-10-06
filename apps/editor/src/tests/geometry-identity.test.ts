import { describe, expect, it } from "vitest";
import { EditorController } from "~/app/controller";
import {
	type LayerBox,
	type LayerGeometry,
	sameGeometry,
} from "~/doc/geometry";
import { doc, geometryOf } from "./doc-fixture";

const box = (): LayerBox => ({
	rect: { x: 1, y: 2, width: 3, height: 4, rotation: 5 },
	worldRotation: 6,
	parentKey: "p",
	autoLayoutChild: false,
});

const geometry = (): LayerGeometry =>
	new Map([
		["p", { ...box(), parentKey: null }],
		["c", box()],
	]);

describe("sameGeometry", () => {
	it("is true for equal maps", () => {
		expect(sameGeometry(geometry(), geometry())).toBe(true);
	});

	it.each([
		["x", (b: LayerBox) => (b.rect.x += 0.5)],
		["y", (b: LayerBox) => (b.rect.y += 0.5)],
		["width", (b: LayerBox) => (b.rect.width += 0.5)],
		["height", (b: LayerBox) => (b.rect.height += 0.5)],
		["rotation", (b: LayerBox) => (b.rect.rotation += 0.5)],
		["worldRotation", (b: LayerBox) => (b.worldRotation += 0.5)],
		["parentKey", (b: LayerBox) => (b.parentKey = "q")],
		["autoLayoutChild", (b: LayerBox) => (b.autoLayoutChild = true)],
	])("is false when %s changes", (_, change) => {
		const next = geometry();
		change(next.get("c") as LayerBox);
		expect(sameGeometry(geometry(), next)).toBe(false);
	});

	it("is false when a key is added or removed", () => {
		const added = geometry().set("d", box());
		const removed = geometry();
		removed.delete("c");
		expect(sameGeometry(geometry(), added)).toBe(false);
		expect(sameGeometry(geometry(), removed)).toBe(false);
	});

	it("is false when a key is swapped", () => {
		const swapped = geometry();
		swapped.delete("c");
		swapped.set("d", box());
		expect(sameGeometry(geometry(), swapped)).toBe(false);
	});
});

describe("rendered", () => {
	const render = (c: EditorController, g: LayerGeometry, warnings: string[]) =>
		c.dispatch({
			type: "rendered",
			geometry: g,
			timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
			stats: {} as never,
			warnings,
		});

	it("keeps geometry and warnings when nothing changed", () => {
		const t = doc();
		const c = new EditorController();
		c.open(t, "doc.coat");
		render(c, geometryOf(t), ["a"]);
		const before = c.store.getState();
		render(c, geometryOf(t), ["a"]);
		const after = c.store.getState();
		expect(after.geometry).toBe(before.geometry);
		expect(after.render.warnings).toBe(before.render.warnings);
		expect(after.render).not.toBe(before.render);
	});

	it("takes the new geometry when a box moved", () => {
		const t = doc();
		const c = new EditorController();
		c.open(t, "doc.coat");
		render(c, geometryOf(t), []);
		const moved = geometryOf(t);
		const [first] = moved.values();
		if (first) first.rect.x += 1;
		render(c, moved, []);
		expect(c.store.getState().geometry).toBe(moved);
	});
});
