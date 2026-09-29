import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Element, Template, VectorElement } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { cleanup, render, screen } from "@testing-library/react";
import CanvasKitInit, { type CanvasKit } from "canvaskit-wasm";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { findCommand } from "~/app/commands";
import { EditorController } from "~/app/controller";
import type { BooleanOp } from "~/doc/boolean";
import { booleanElements, unwrap } from "~/doc/ops";
import { getElement } from "~/doc/path";
import { BooleanSection } from "~/panels/design/BooleanSection";
import { doc } from "./doc-fixture";

let ck: CanvasKit;

beforeAll(async () => {
	const bin = join(
		dirname(createRequire(import.meta.url).resolve("canvaskit-wasm")),
		"..",
		"bin",
	);
	ck = await (
		CanvasKitInit as unknown as (o: {
			locateFile(f: string): string;
		}) => Promise<CanvasKit>
	)({ locateFile: (f) => join(bin, f) });
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

	test("drops the variant changes of the layers it replaces", () => {
		const d = doc();
		const { t } = run(d, ["0/0", "0/5"], "union");
		const deltas = t.variants?.[0]?.overrides?.[0]?.elements ?? [];
		expect(deltas.map((e) => e.id)).not.toContain("a");
		expect(validate(t).ok).toBe(true);
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
			<BooleanSection ins={{ controller: new EditorController() } as never} />,
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
