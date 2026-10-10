import type { Element, Template, VectorElement } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { type BooleanOperand, combineShapes } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { cleanup, render, screen } from "@testing-library/react";
import type { CanvasKit } from "canvaskit-wasm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { COMMAND_BY_ID, findCommand } from "~/app/commands";
import { EditorController } from "~/app/controller";
import type { BooleanOp } from "~/doc/boolean";
import { settleBooleans } from "~/doc/boolean";
import { applyRect } from "~/doc/geometry";
import {
	booleanElements,
	flattenBooleans,
	insertElements,
	moveElements,
	removeElements,
	renameElement,
	unwrap,
	updateElement,
} from "~/doc/ops";
import { childPaths, getElement, siblingsOf, walkLayers } from "~/doc/path";
import { BooleanSection } from "~/panels/design/BooleanSection";
import { fastUser } from "./aria";
import { doc, geometryOf } from "./doc-fixture";

let ck: CanvasKit;

beforeAll(async () => {
	ck = await loadCanvasKit();
});

afterEach(cleanup);

const STROKE = { color: "#123456", width: 3 };

function shapes(...elements: Element[]): Template {
	return {
		format_version: "1.1",
		id: "shapes",
		name: "Shapes",
		width: 400,
		height: 300,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					size: { width: 400, height: 300 },
					properties: { fill: "#ffffff" },
				},
				elements,
			},
		],
	};
}

const square = (id: string, x: number, y: number, extra = {}): Element => ({
	id,
	type: "rect",
	pos: { x, y },
	size: { width: 100, height: 100 },
	properties: { fill: `#${id.repeat(6).slice(0, 6)}` },
	...extra,
});

const circle = (id: string, x: number, y: number): Element => ({
	id,
	type: "vector",
	pos: { x, y },
	size: { width: 100, height: 100 },
	properties: {
		d: "M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z",
		fill: "#0000ff",
	},
});

function run(t: Template, keys: string[], op: BooleanOp) {
	const out = unwrap(booleanElements(t, keys, op, ck));
	const key = out.keys?.[0] as string;
	return {
		t: out.template,
		key,
		el: getElement(out.template, key) as VectorElement,
	};
}

/** Whether the result covers a point given in its parent's space. */
function covers(el: VectorElement, x: number, y: number): boolean {
	const path = ck.Path.MakeFromSVGString(el.properties.d);
	if (!path) throw new Error("no path");
	if (el.properties.fillRule === "evenodd")
		path.setFillType(ck.FillType.EvenOdd);
	const inside = path.contains(x - (el.pos?.x ?? 0), y - (el.pos?.y ?? 0));
	path.delete();
	return inside;
}

describe("boolean operations", () => {
	const a = square("a", 0, 0, {
		properties: { fill: "#aa0000", stroke: STROKE },
		opacity: 0.5,
	});
	const b = circle("b", 50, 0);
	const pair = () => shapes(a, b, square("c", 300, 200));

	test("union keeps the bottom-most shape's fill, stroke and place", () => {
		const { t, key, el } = run(pair(), ["0/1", "0/0"], "union");
		expect(key).toBe("0/0");
		expect(el).toMatchObject({
			id: "union",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 150, height: 100 },
			opacity: 0.5,
			properties: { fill: "#aa0000", stroke: STROKE },
		});
		expect(el.rotation).toBeUndefined();
		expect(t.template_data[0]?.elements.map((e) => e.id)).toEqual([
			"union",
			"c",
		]);
		expect(covers(el, 10, 10)).toBe(true);
		expect(covers(el, 140, 50)).toBe(true);
		expect(covers(el, 145, 5)).toBe(false);
		expect(el.properties.d).toMatch(/^M0 0L.*C.*Z$/);
		expect(el.properties.d).not.toMatch(/Q/);
		expect(validate(t).ok).toBe(true);
	});

	test("subtract takes the upper shapes from the bottom-most", () => {
		const { el } = run(pair(), ["0/0", "0/1"], "subtract");
		expect(el.pos).toEqual({ x: 0, y: 0 });
		expect(el.size?.width).toBeCloseTo(100, 1);
		expect(covers(el, 10, 50)).toBe(true);
		expect(covers(el, 90, 50)).toBe(false);
		expect(covers(el, 60, 5)).toBe(true);
	});

	test("intersect keeps what every shape covers", () => {
		const { el } = run(pair(), ["0/0", "0/1"], "intersect");
		expect(el.pos?.x).toBeCloseTo(50, 1);
		expect(el.size?.width).toBeCloseTo(50, 1);
		expect(covers(el, 90, 50)).toBe(true);
		expect(covers(el, 52, 3)).toBe(false);
	});

	test("exclude keeps what an odd number of shapes cover", () => {
		const { el } = run(pair(), ["0/0", "0/1"], "exclude");
		expect(el.size?.width).toBeCloseTo(150, 1);
		expect(covers(el, 10, 50)).toBe(true);
		expect(covers(el, 90, 50)).toBe(false);
		expect(covers(el, 130, 50)).toBe(true);
	});

	test("folds three or more shapes, bottom-most first", () => {
		const t = shapes(
			square("a", 0, 0, { size: { width: 300, height: 100 } }),
			square("b", 20, 0),
			square("c", 180, 0),
		);
		const { el } = run(t, ["0/0", "0/1", "0/2"], "subtract");
		expect(covers(el, 150, 50)).toBe(true);
		expect(covers(el, 50, 50)).toBe(false);
		expect(covers(el, 200, 50)).toBe(false);
		expect(covers(el, 10, 50)).toBe(true);
	});

	test("reads rotation, corner radius and the even-odd rule", () => {
		const turned = square("a", 100, 100, { rotation: 45 });
		const dot = square("b", 0, 0, { size: { width: 10, height: 10 } });
		const { el } = run(shapes(dot, turned), ["0/0", "0/1"], "union");
		expect(el.size?.width).toBeCloseTo(150 + 50 * Math.SQRT2, 0);
		expect(covers(el, 150, 150)).toBe(true);
		expect(covers(el, 105, 105)).toBe(false);

		const round = square("r", 0, 0, {
			properties: { fill: "#000000", cornerRadius: 50 },
		});
		const full = square("s", 0, 0);
		const clipped = run(shapes(round, full), ["0/0", "0/1"], "intersect").el;
		expect(covers(clipped, 3, 3)).toBe(false);
		expect(covers(clipped, 50, 50)).toBe(true);

		const ring: Element = {
			id: "ring",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			properties: {
				d: "M0 0H100V100H0ZM25 25H75V75H25Z",
				fillRule: "evenodd",
				fill: "#000000",
			},
		};
		const donut = run(
			shapes(ring, square("z", 200, 200, { size: { width: 5, height: 5 } })),
			["0/0", "0/1"],
			"union",
		).el;
		expect(covers(donut, 10, 10)).toBe(true);
		expect(covers(donut, 50, 50)).toBe(false);
	});

	test("refuses what it can't combine, leaving the template alone", () => {
		const t = pair();
		const code = (keys: string[], tpl = t, op: BooleanOp = "union") => {
			const r = booleanElements(tpl, keys, op, ck);
			return r.ok ? "ok" : r.code;
		};
		expect(code(["0/0"])).toBe("too_few");
		expect(code(["0/0", "0/2"], t, "intersect")).toBe("empty_result");
		const d = doc();
		expect(code(["0/0", "0/1/0"], d)).toBe("not_siblings");
		expect(code(["0/1/0", "0/1/1"], d)).toBe("not_a_shape");
		expect(code(["0/3/0", "0/3/1"], d)).toBe("auto_layout");
		expect(code(["0/bg", "0/0"], d)).toBe("background");
	});

	test("keeps the shapes as operands, placed in the result's box", () => {
		const t = shapes(square("a", 100, 100), circle("b", 150, 100));
		const { el } = run(t, ["0/0", "0/1"], "union");
		expect(el.pos).toEqual({ x: 100, y: 100 });
		expect(el.properties.boolean?.op).toBe("union");
		expect(
			el.properties.boolean?.operands.map((o) => [o.id, o.type, o.pos]),
		).toEqual([
			["a", "rect", { x: 0, y: 0 }],
			["b", "vector", { x: 50, y: 0 }],
		]);
	});

	test("nests a boolean selected with other shapes", () => {
		const first = run(
			shapes(square("a", 0, 0), circle("b", 50, 0), square("c", 120, 40)),
			["0/0", "0/1"],
			"union",
		);
		const second = run(first.t, ["0/0", "0/1"], "subtract");
		const el = second.el;
		const [inner, outer] = el.properties.boolean?.operands ?? [];
		expect(inner).toMatchObject({ id: "union", type: "vector" });
		expect((inner as VectorElement).properties.boolean?.operands).toHaveLength(
			2,
		);
		expect(outer?.id).toBe("c");
		expect(validate(second.t).ok).toBe(true);
	});

	test("moves the variant changes of a shape's position with it", () => {
		const t: Template = {
			...shapes(square("a", 100, 100), square("b", 150, 100)),
			variants: [
				{
					id: "dark",
					label: "Dark",
					overrides: [
						{
							name: "front",
							elements: [
								{ id: "a", properties: { fill: "#111111" } },
								{ id: "b", properties: {}, pos: { x: 160, y: 100 } },
							],
						},
					],
				},
			],
		};
		const { t: out } = run(t, ["0/0", "0/1"], "union");
		const deltas = out.variants?.[0]?.overrides?.[0]?.elements ?? [];
		expect(deltas.find((d) => d.id === "a")).toBeDefined();
		expect(deltas.find((d) => d.id === "b")?.pos).toEqual({ x: 60, y: 0 });
		expect(validate(out).ok).toBe(true);
	});
});

describe("boolean commands", () => {
	test("each is one undo step and selects the result", async () => {
		const c = new EditorController();
		c.open(
			shapes(square("a", 0, 0), circle("b", 50, 0), square("c", 300, 200)),
			"s.coat",
		);
		c.select(["0/0", "0/1"]);
		expect(await c.booleanSelection("union", ck)).toBe(true);
		expect(c.state.selection).toEqual(["0/0"]);
		expect(c.base?.template_data[0]?.elements).toHaveLength(2);
		expect(c.state.doc?.history.past).toHaveLength(1);
		c.undo();
		expect(c.base?.template_data[0]?.elements).toHaveLength(3);
		c.select(["0/0"]);
		expect(await c.booleanSelection("union", ck)).toBe(false);
	});

	test("have Figma's shortcuts", () => {
		const key = (code: string) => ({
			key: code.slice(-1).toLowerCase(),
			code,
			altKey: true,
			shiftKey: true,
			metaKey: false,
			ctrlKey: false,
		});
		expect(findCommand(key("KeyU"), true, false)?.id).toBe("object.union");
		expect(findCommand(key("KeyS"), true, false)?.id).toBe("object.subtract");
		expect(findCommand(key("KeyI"), true, false)?.id).toBe("object.intersect");
		expect(findCommand(key("KeyX"), true, false)?.id).toBe("object.exclude");
	});

	test("the inspector's toolbar names each operation", () => {
		render(
			<BooleanSection
				ins={
					{ controller: new EditorController(), keys: [], layers: [] } as never
				}
			/>,
		);
		const bar = screen.getByRole("toolbar", { name: "Boolean" });
		for (const name of [
			"Union selection",
			"Subtract selection",
			"Intersect selection",
			"Exclude selection",
		])
			expect(bar.querySelector(`[aria-label="${name}"]`)).toBeTruthy();
	});
});

const OPERANDS = "0/0";

/** A controller over two overlapping squares and a far one, combined by union
 *  into "0/0", whose operands are "0/0/0" and "0/0/1". */
async function liveController(
	op: BooleanOp = "union",
	extra: Element[] = [],
): Promise<EditorController> {
	const c = new EditorController();
	c.open(
		shapes(square("a", 100, 100), square("b", 150, 100), ...extra),
		"s.coat",
	);
	c.select(["0/0", "0/1"]);
	await c.booleanSelection(op, ck);
	return c;
}

const vectorAt = (c: EditorController, key = OPERANDS) =>
	getElement(c.base as Template, key) as VectorElement;

/** The result the operands make, in the vector's own space. */
function resultOf(el: VectorElement) {
	const operands = (el.properties.boolean?.operands ?? []).map((o) => ({
		kind: o.type === "rect" ? "rect" : "path",
		...(o.pos ? { pos: o.pos } : {}),
		...(o.size ? { size: o.size } : {}),
		...(o.type === "vector" ? { d: o.properties.d } : {}),
	}));
	return combineShapes(ck, operands as BooleanOperand[], "union");
}

describe("a boolean's cached result", () => {
	test("matches its operands after the result is made", async () => {
		const el = vectorAt(await liveController());
		expect(el.size).toEqual({ width: 150, height: 100 });
		expect(resultOf(el)).toMatchObject({
			d: el.properties.d,
			box: { x: 0, y: 0, width: 150, height: 100 },
		});
	});

	test("follows an operand moved by any edit", async () => {
		const c = await liveController();
		c.edit((t) =>
			updateElement(t, "0/0/1", {
				pos: { x: 120, y: 0 },
				size: { width: 80, height: 100 },
			}),
		);
		const el = vectorAt(c);
		expect(el.size).toEqual({ width: 200, height: 100 });
		expect(el.properties.d).toBe(resultOf(el)?.d);
		expect(validate(c.base as Template).ok).toBe(true);
	});

	test("keeps operands in place when the box moves", async () => {
		const c = await liveController();
		c.edit((t) => updateElement(t, "0/0/0", { pos: { x: -30, y: -20 } }));
		const el = vectorAt(c);
		expect(el.pos).toEqual({ x: 70, y: 80 });
		const [a, b] = el.properties.boolean?.operands ?? [];
		expect(a?.pos).toEqual({ x: 0, y: 0 });
		expect(b?.pos).toEqual({ x: 80, y: 20 });
		expect(el.size).toEqual({ width: 180, height: 120 });
	});

	test("keeps operands in place when a turned vector's box moves", async () => {
		const c = await liveController();
		c.edit((t) => updateElement(t, OPERANDS, { rotation: 90 }));
		const centreOf = (el: VectorElement) => ({
			x: (el.pos?.x ?? 0) + (el.size?.width ?? 0) / 2,
			y: (el.pos?.y ?? 0) + (el.size?.height ?? 0) / 2,
		});
		// Where the second operand's centre lands once the vector is turned.
		const operandCentre = (el: VectorElement) => {
			const o = el.properties.boolean?.operands[1] as Element;
			const c0 = centreOf(el);
			const local = {
				x:
					(o.pos?.x ?? 0) +
					(o.size?.width ?? 0) / 2 -
					(el.size?.width ?? 0) / 2,
				y:
					(o.pos?.y ?? 0) +
					(o.size?.height ?? 0) / 2 -
					(el.size?.height ?? 0) / 2,
			};
			return { x: c0.x - local.y, y: c0.y + local.x };
		};
		const before = operandCentre(vectorAt(c));
		c.edit((t) => updateElement(t, "0/0/0", { pos: { x: -40, y: 0 } }));
		const after = vectorAt(c);
		expect(after.rotation).toBe(90);
		expect(after.size?.width).toBe(190);
		const now = operandCentre(after);
		expect(now.x).toBeCloseTo(before.x, 1);
		expect(now.y).toBeCloseTo(before.y, 1);
	});

	test("follows a deleted, resized, reordered or restyled operand", async () => {
		const c = await liveController("subtract", [square("z", 300, 200)]);
		c.select(["0/0/0"]);
		c.reorder("front");
		expect(vectorAt(c).properties.boolean?.operands.map((o) => o.id)).toEqual([
			"b",
			"a",
		]);
		expect(vectorAt(c).size).toEqual({ width: 50, height: 100 });
		c.edit((t) =>
			updateElement(t, "0/0/1", { properties: { cornerRadius: 50 } }),
		);
		expect(vectorAt(c).properties.d).not.toMatch(/^M0 0H/);
		c.select(["0/0/0"]);
		c.deleteSelection();
		const el = vectorAt(c);
		expect(el.properties.boolean?.operands.map((o) => o.id)).toEqual(["a"]);
		expect(el.size).toEqual({ width: 100, height: 100 });
	});

	test("follows the vector's own resize", async () => {
		const c = await liveController();
		const resized = applyRect(
			c.base as Template,
			OPERANDS,
			{ x: 100, y: 100, width: 300, height: 50, rotation: 0 },
			new Map(),
		);
		c.edit(() => resized);
		const el = vectorAt(c);
		expect(el.size).toEqual({ width: 300, height: 50 });
		expect(el.properties.boolean?.operands[1]?.size).toEqual({
			width: 200,
			height: 50,
		});
		expect(el.properties.d).toBe(resultOf(el)?.d);
	});

	test("is left alone by an edit in a variant, which draws from the operands", async () => {
		const c = await liveController();
		c.edit(
			(t) => ({
				ok: true,
				template: {
					...t,
					variants: [{ id: "wide", label: "Wide", overrides: [] }],
				},
			}),
			{ scope: "base" },
		);
		c.setVariant("wide");
		const before = vectorAt(c);
		c.edit((t) => updateElement(t, "0/0/1", { pos: { x: 120, y: 0 } }));
		const base = vectorAt(c);
		expect(base.properties.d).toBe(before.properties.d);
		expect(base.properties.boolean?.operands[1]?.pos).toEqual(
			before.properties.boolean?.operands[1]?.pos,
		);
		const delta = c.base?.variants?.[0]?.overrides?.[0]?.elements ?? [];
		expect(delta.map((d) => d.id)).toEqual(["b"]);
		expect(delta[0]?.pos).toEqual({ x: 120, y: 0 });
	});

	test("is rebuilt as one undo step with the edit", async () => {
		const c = await liveController();
		const before = vectorAt(c);
		c.edit((t) => updateElement(t, "0/0/1", { pos: { x: 120, y: 0 } }));
		c.undo();
		expect(vectorAt(c)).toBe(before);
	});

	test("an edit away from every boolean keeps the template as it was", async () => {
		const c = await liveController("union", [square("z", 300, 200)]);
		const el = vectorAt(c);
		c.edit((t) => updateElement(t, "0/1", { pos: { x: 10, y: 10 } }));
		expect(vectorAt(c)).toBe(el);
	});
});

describe("operands as layers", () => {
	test("have paths under their vector, in paint order", async () => {
		const c = await liveController("union", [square("z", 300, 200)]);
		const t = c.base as Template;
		expect(getElement(t, "0/0/0")?.id).toBe("a");
		expect(getElement(t, "0/0/1")?.id).toBe("b");
		expect(getElement(t, "0/0/2")).toBeUndefined();
		expect(
			childPaths(t, "0/0").map((p) => (p as { path: number[] }).path),
		).toEqual([
			[0, 0],
			[0, 1],
		]);
		expect(
			siblingsOf(t, "0/0/1").map((p) => (p as { path: number[] }).path),
		).toEqual([
			[0, 0],
			[0, 1],
		]);
		expect(
			[...walkLayers(t, 0)].map((e) => [e.key, e.parentKey, e.depth]),
		).toEqual([
			["0/bg", null, 0],
			["0/0", null, 0],
			["0/0/0", "0/0", 1],
			["0/0/1", "0/0", 1],
			["0/1", null, 0],
		]);
	});

	test("rename like any layer", async () => {
		const c = await liveController();
		c.edit((t) => renameElement(t, "0/0/1", "bar"));
		expect(vectorAt(c).properties.boolean?.operands[1]?.id).toBe("bar");
	});

	test("duplicate inside the boolean and take the result with them", async () => {
		const c = await liveController();
		c.select(["0/0/0"]);
		c.duplicateSelection();
		const el = vectorAt(c);
		expect(el.properties.boolean?.operands.map((o) => o.id)).toEqual([
			"a",
			"a-2",
			"b",
		]);
		expect(validate(c.base as Template).ok).toBe(true);
	});

	test("leave the boolean when dragged out, keeping their place", async () => {
		const c = await liveController("union", [square("z", 300, 200)]);
		const t = c.base as Template;
		const out = unwrap(
			moveElements(t, ["0/0/1"], { side: 0 }, 0, geometryOf(t)),
		);
		expect(out.template.template_data[0]?.elements.map((e) => e.id)).toEqual([
			"b",
			"union",
			"z",
		]);
		const moved = out.template.template_data[0]?.elements[0];
		expect(moved?.pos).toEqual({ x: 150, y: 100 });
		const rest = settleBooleans(t, out.template, ck);
		const left = getElement(rest, "0/1") as VectorElement;
		expect(left.properties.boolean?.operands).toHaveLength(1);
		expect(left.size).toEqual({ width: 100, height: 100 });
	});

	test("join the boolean when dragged in, if they are rects or vectors", async () => {
		const c = await liveController("union", [
			square("z", 300, 200),
			{
				id: "label",
				type: "frame",
				pos: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				properties: { children: [] },
			},
		]);
		const t = c.base as Template;
		const into = unwrap(moveElements(t, ["0/1"], "0/0", 2, geometryOf(t)));
		const operands = (getElement(into.template, "0/0") as VectorElement)
			.properties.boolean?.operands;
		expect(operands?.map((o) => [o.id, o.pos])).toEqual([
			["a", { x: 0, y: 0 }],
			["b", { x: 50, y: 0 }],
			["z", { x: 200, y: 100 }],
		]);
		const refused = moveElements(t, ["0/2"], "0/0", 2, geometryOf(t));
		expect(refused).toMatchObject({ ok: false, code: "not_a_shape" });
		const inserted = insertElements(t, "0/0", 0, [
			{
				id: "t",
				type: "text",
				properties: { value: "x", font: { family: "Inter", size: 12 } },
			} as Element,
		]);
		expect(inserted).toMatchObject({ ok: false, code: "not_a_shape" });
	});

	test("can't all leave, and a deleted last operand takes the vector with it", async () => {
		const c = await liveController("union", [square("z", 300, 200)]);
		const t = c.base as Template;
		expect(
			moveElements(t, ["0/0/0", "0/0/1"], { side: 0 }, 0, geometryOf(t)),
		).toMatchObject({ ok: false, code: "last_operand" });
		const gone = unwrap(removeElements(t, ["0/0/0", "0/0/1"]));
		expect(gone.template.template_data[0]?.elements.map((e) => e.id)).toEqual([
			"z",
		]);
		const nested = await liveController("union");
		nested.select(["0/0", "0/0/0"]);
		nested.select(["0/0/0"]);
		nested.deleteSelection();
		nested.select(["0/0/0"]);
		nested.deleteSelection();
		expect(nested.base?.template_data[0]?.elements).toEqual([]);
	});

	test("can't be grouped", async () => {
		const c = await liveController();
		c.select(["0/0/0", "0/0/1"]);
		c.groupSelection();
		expect(vectorAt(c).properties.boolean?.operands.map((o) => o.type)).toEqual(
			["rect", "rect"],
		);
	});
});

describe("flatten and switching the operation", () => {
	test("flatten drops the operands and keeps the result", async () => {
		const c = await liveController();
		const before = vectorAt(c);
		c.select(["0/0"]);
		c.flattenSelection();
		const el = vectorAt(c);
		expect(el.properties.boolean).toBeUndefined();
		expect(el.properties.d).toBe(before.properties.d);
		expect(el.pos).toEqual(before.pos);
		expect(getElement(c.base as Template, "0/0/0")).toBeUndefined();
		expect(validate(c.base as Template).ok).toBe(true);
		c.undo();
		expect(vectorAt(c).properties.boolean).toBeDefined();
	});

	test("flatten refuses what is not a boolean", () => {
		const t = shapes(square("a", 0, 0));
		expect(flattenBooleans(t, ["0/0"])).toMatchObject({
			ok: false,
			code: "not_a_shape",
		});
	});

	test("switching the operation rebuilds the result", async () => {
		const c = await liveController();
		c.select(["0/0"]);
		c.setBooleanOp("intersect");
		const el = vectorAt(c);
		expect(el.properties.boolean?.op).toBe("intersect");
		expect(el.size).toEqual({ width: 50, height: 100 });
		expect(el.pos).toEqual({ x: 150, y: 100 });
		expect(el.properties.boolean?.operands[0]?.pos).toEqual({ x: -50, y: 0 });
		c.setBooleanOp("union");
		const back = vectorAt(c);
		expect(back.size).toEqual({ width: 150, height: 100 });
		expect(back.pos).toEqual({ x: 100, y: 100 });
	});
});

describe("the toolbar over a boolean layer", () => {
	async function mount() {
		const c = await liveController();
		c.select(["0/0"]);
		const view = () => (
			<BooleanSection
				ins={{ controller: c, keys: ["0/0"], layers: [vectorAt(c)] } as never}
			/>
		);
		render(view());
		return { c, view };
	}

	test("presses the current operation", async () => {
		await mount();
		const pressed = (name: string) =>
			screen.getByRole("button", { name }).getAttribute("aria-pressed");
		expect(pressed("Union selection")).toBe("true");
		expect(pressed("Subtract selection")).toBe("false");
	});

	test("switches the operation and flattens", async () => {
		const { c } = await mount();
		const user = fastUser();
		await user.click(
			screen.getByRole("button", { name: "Subtract selection" }),
		);
		expect(vectorAt(c).properties.boolean?.op).toBe("subtract");
		expect(c.state.doc?.history.past).toHaveLength(2);
		await user.click(screen.getByRole("button", { name: "Flatten" }));
		expect(vectorAt(c).properties.boolean).toBeUndefined();
	});

	test("offers no Flatten over plain shapes", () => {
		render(
			<BooleanSection
				ins={
					{
						controller: new EditorController(),
						keys: ["0/0", "0/1"],
						layers: [],
					} as never
				}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Flatten" })).toBeNull();
	});
});

describe("flatten command", () => {
	test("is enabled over a boolean layer only, and has no shortcut", async () => {
		const flatten = COMMAND_BY_ID.get("object.flatten");
		expect(flatten?.keys).toBeUndefined();
		const c = await liveController("union", [square("z", 300, 200)]);
		c.select(["0/1"]);
		expect(flatten?.enabled?.(c.state)).toBe(false);
		c.select(["0/0"]);
		expect(flatten?.enabled?.(c.state)).toBe(true);
	});
});

describe("canvas", () => {
	function rendered(c: EditorController) {
		c.dispatch({
			type: "rendered",
			geometry: geometryOf(c.template as Template),
			timings: { compile: 0, layout: 0, lower: 0, paint: 0, total: 0 },
			stats: {} as never,
			warnings: [],
		});
	}

	test("hit-testing a boolean finds the result, then an operand deeper", async () => {
		const c = await liveController();
		rendered(c);
		const inA = { x: 120, y: 130 };
		const inB = { x: 230, y: 130 };
		expect(c.hitTest(inA)).toBe("0/0");
		expect(c.hitTest(inA, { deep: true })).toBe("0/0/0");
		expect(c.hitTest(inB, { deep: true })).toBe("0/0/1");
		c.select(["0/0/0"]);
		expect(c.hitTest(inB)).toBe("0/0/1");
		expect(c.hitTest(inA)).toBe("0/0/0");
	});

	test("points are not edited on a boolean", async () => {
		const c = await liveController();
		c.select(["0/0"]);
		expect(c.beginPathEdit("0/0")).toBe(false);
		expect(c.state.pathEdit).toBeNull();
	});
});
