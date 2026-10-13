import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { FORMAT_VERSION, minimumFormatVersion } from "../src/format";
import { resolveSlices } from "../src/slices";
import type { Element, Template } from "../src/types";
import { validate } from "../src/validate";

type Modifier = Record<string, unknown>;

// A rect at (10, 20), 40 by 30, carrying the slice modifier. Unpainted, so it
// is a pure split region unless `props` paints it.
const shape = (
	id: string,
	modifier: Modifier | null = {},
	extra: Record<string, unknown> = {},
	props: Record<string, unknown> = {},
): Element =>
	({
		id,
		type: "rect",
		pos: { x: 10, y: 20 },
		size: { width: 40, height: 30 },
		properties: { ...props, ...(modifier ? { slice: modifier } : {}) },
		...extra,
	}) as Element;

const vector = (
	id: string,
	modifier: Modifier | null = {},
	props: Record<string, unknown> = {},
	extra: Record<string, unknown> = {},
): Element =>
	({
		id,
		type: "vector",
		pos: { x: 10, y: 20 },
		size: { width: 40, height: 30 },
		properties: {
			d: "M0 0 L40 0 L0 30 Z",
			...props,
			...(modifier ? { slice: modifier } : {}),
		},
		...extra,
	}) as Element;

const rect = (id: string): Element =>
	({
		id,
		type: "rect",
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties: { fill: "#000000" },
	}) as Element;

function template(...elements: Element[]): Template {
	return {
		format_version: "1.7",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "test",
		width: 100,
		height: 80,
		fields: {
			type: "object",
			properties: { show: { type: "string", format: "boolean" } },
		},
		template_data: [
			{
				name: "front",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ffffff" },
				},
				elements,
			},
			{
				name: "back",
				background: {
					id: "bg",
					type: "rect",
					properties: { fill: "#ffffff" },
				},
				elements: [shape("other")],
			},
		],
	};
}

const codes = (t: Template): string[] => {
	const r = validate(t);
	return r.ok ? [] : r.errors.map((e) => e.code);
};

describe("slice validation", () => {
	test("accepts the modifier on a rect and a vector with every property", () => {
		const full = {
			name: "panel",
			output: "none",
			edge: "kiss",
			bleed: { top: 1, right: 2, bottom: 3, left: 4 },
			order: 2,
		};
		expect(
			codes(template(shape("s", full), vector("p", { edge: "through" }))),
		).toEqual([]);
	});

	test("rejects an unknown edge and the old slice element", () => {
		expect(validate(template(shape("s", { edge: "burn" }))).ok).toBe(false);
		expect(
			validate(
				template({
					id: "s",
					type: "slice",
					size: { width: 1, height: 1 },
					properties: {},
				} as unknown as Element),
			).ok,
		).toBe(false);
	});

	test("must be top-level", () => {
		const frame = {
			id: "f",
			type: "frame",
			properties: { children: [shape("a")] },
		} as Element;
		const mask = {
			id: "m",
			type: "mask",
			properties: { mask: shape("b"), children: [shape("c")] },
		} as Element;
		const boolean = {
			id: "v",
			type: "vector",
			size: { width: 10, height: 10 },
			properties: {
				d: "",
				boolean: { op: "union", operands: [shape("d"), rect("e")] },
			},
		} as Element;
		const found = codes(template(frame, mask, boolean));
		expect(found.filter((c) => c === "slice_not_top_level")).toHaveLength(4);
	});

	test("a background cannot carry it", () => {
		const t = template(rect("r"));
		t.template_data[0].background = {
			id: "bg",
			type: "rect",
			properties: { fill: "#ffffff", slice: {} },
		};
		expect(codes(t)).toContain("slice_not_top_level");
	});

	test("needs a positive size", () => {
		expect(codes(template(shape("s", {}, { size: undefined })))).toContain(
			"slice_size_required",
		);
		expect(
			codes(template(shape("s", {}, { size: { width: 0, height: 10 } }))),
		).toContain("slice_size_required");
	});

	test("may be rotated", () => {
		expect(codes(template(shape("s", {}, { rotation: 15 })))).toEqual([]);
	});

	test("names are unique per side, falling back to the id", () => {
		const t = template(shape("a", { name: "b" }), shape("b"));
		expect(codes(t)).toContain("slice_name_duplicate");
		const other = template(shape("a"), vector("b"));
		other.template_data[1].elements = [shape("a")];
		expect(codes(other)).toEqual([]);
	});

	test("a shape without the modifier takes no part", () => {
		expect(codes(template(shape("a", null), shape("a2", null)))).toEqual(
			[],
		);
	});

	test("bleed must not be negative", () => {
		expect(codes(template(shape("s", { bleed: -1 })))).toContain(
			"invalid_inset",
		);
		expect(
			codes(
				template(shape("s", { bleed: { top: 1, right: -2, bottom: 0, left: 0 } })),
			),
		).toContain("invalid_inset");
	});
});

describe("slice format version", () => {
	test("is 1.7 and a slice modifier needs it", () => {
		expect(FORMAT_VERSION).toBe("1.7");
		const plain = template(rect("r"));
		plain.template_data[1].elements = [];
		expect(minimumFormatVersion(plain)).toBe("1.0");
		expect(minimumFormatVersion(template(shape("s")))).toBe("1.7");
		expect(minimumFormatVersion(template(vector("v")))).toBe("1.7");
	});

	test("a variant delta that sets it needs it", () => {
		const t = template(rect("r"));
		t.template_data[1].elements = [];
		t.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						elements: [{ id: "r", properties: { slice: { edge: "kiss" } } }],
					},
				],
			},
		];
		expect(minimumFormatVersion(t)).toBe("1.7");
	});
});

describe("slice compile", () => {
	test("never changes a render", () => {
		const paint = { fill: "#ff0000", cornerRadius: 4 };
		const size = { width: 100, height: 80 };
		const plain = compile(
			template(shape("s", null, {}, paint), vector("v", null)),
			{},
			size,
		);
		const sliced = compile(
			template(
				shape("s", { edge: "through", bleed: 2 }, {}, paint),
				vector("v", { output: "none" }),
			),
			{},
			size,
		);
		expect(sliced.frames[0].root).toEqual(plain.frames[0].root);
	});

	test("an unpainted shape draws nothing", () => {
		const c = compile(template(shape("s")), {}, { width: 100, height: 80 });
		const [node] = c.frames[0].root.children.slice(-1);
		expect(node).toMatchObject({ kind: "rect", fills: undefined, stroke: undefined });
	});
});

const ids = (slices: { id: string }[]) => slices.map((s) => s.id);

describe("resolveSlices", () => {
	test("a rect becomes a closed outline in trim coordinates", () => {
		const [s] = resolveSlices(template(shape("s")), {});
		expect(s).toEqual({
			id: "s",
			name: "s",
			box: { x: 10, y: 20, width: 40, height: 30 },
			path: "M10 20L50 20L50 50L10 50Z",
			fillRule: "nonzero",
			output: "piece",
			edge: "none",
			bleed: { top: 0, right: 0, bottom: 0, left: 0 },
			order: 0,
		});
	});

	test("a rect keeps its corner radius, clamped as it paints", () => {
		const [s] = resolveSlices(template(shape("s", {}, {}, { cornerRadius: 5 })), {});
		expect(s.path.startsWith("M15 20")).toBe(true);
		expect(s.path.endsWith("Z")).toBe(true);
		expect(s.box).toEqual({ x: 10, y: 20, width: 40, height: 30 });
		const [pill] = resolveSlices(
			template(shape("s", {}, {}, { cornerRadius: 999 })),
			{},
		);
		expect(pill.path.startsWith("M25 20")).toBe(true);
		const [one] = resolveSlices(
			template(shape("s", {}, {}, { cornerRadius: [10, 0, 0, 0] })),
			{},
		);
		expect(one.path.startsWith("M20 20")).toBe(true);
	});

	test("a smoothed rect follows the squircle", () => {
		const round = resolveSlices(template(shape("s", {}, {}, { cornerRadius: 10 })))[0];
		const smooth = resolveSlices(
			template(shape("s", {}, {}, { cornerRadius: 10, cornerSmoothing: 0.8 })),
		)[0];
		expect(smooth.path).not.toBe(round.path);
		expect(smooth.box.width).toBeCloseTo(40);
	});

	test("a vector is its path moved to the box, with its fill rule", () => {
		const [s] = resolveSlices(
			template(vector("v", {}, { fillRule: "evenodd" })),
			{},
		);
		expect(s.fillRule).toBe("evenodd");
		expect(s.path).toBe("M10 20L50 20L10 50Z");
		expect(s.box).toEqual({ x: 10, y: 20, width: 40, height: 30 });
	});

	test("a vector rounds its corners as it paints", () => {
		const [s] = resolveSlices(
			template(vector("v", {}, { cornerRadius: 4 })),
			{},
		);
		expect(s.path).toContain("C");
		expect(s.box.width).toBeLessThan(40);
	});

	test("a rotated shape turns about its centre", () => {
		const [s] = resolveSlices(
			template(shape("s", {}, { rotation: 90 })),
			{},
		);
		expect(s.box.x).toBeCloseTo(15);
		expect(s.box.y).toBeCloseTo(15);
		expect(s.box.width).toBeCloseTo(30);
		expect(s.box.height).toBeCloseTo(40);
		expect(s.path.startsWith("M45 15")).toBe(true);
	});

	test("a live boolean uses pathOp, and falls back to the cached path", () => {
		const boolean = {
			op: "union",
			operands: [rect("a"), rect("b")],
		};
		const el = vector("v", {}, { boolean, d: "M0 0 L40 0 L0 30 Z" });
		const pathOp = () => ({
			d: "M0 0 L20 0 L20 10 Z",
			box: { x: 0, y: 0, width: 20, height: 10 },
		});
		const [live] = resolveSlices(template(el), { pathOp });
		expect(live.path).toBe("M10 20L30 20L30 30Z");
		const [cached] = resolveSlices(template(el), {});
		expect(cached.path).toBe("M10 20L50 20L10 50Z");
	});

	test("resolves name, output, edge and bleed", () => {
		const [s] = resolveSlices(
			template(shape("s", { name: "panel", output: "none", edge: "through", bleed: 3 })),
			{},
		);
		expect(s).toMatchObject({
			name: "panel",
			output: "none",
			edge: "through",
			bleed: { top: 3, right: 3, bottom: 3, left: 3 },
		});
	});

	test("shapes without the modifier are ignored", () => {
		expect(ids(resolveSlices(template(rect("r"), shape("s"), vector("v", null))))).toEqual(
			["s"],
		);
	});

	test("sorts by order, then document order", () => {
		const slices = resolveSlices(
			template(
				shape("a", { order: 2 }),
				shape("b"),
				shape("c", { order: 0 }),
				shape("d", { order: -1 }),
			),
			{},
		);
		expect(ids(slices)).toEqual(["d", "c", "b", "a"]);
	});

	test("picks the side, defaulting to the first", () => {
		const t = template(shape("s"));
		expect(ids(resolveSlices(t, {}))).toEqual(["s"]);
		expect(ids(resolveSlices(t, { frameName: "back" }))).toEqual(["other"]);
		expect(() => resolveSlices(t, { frameName: "nope" })).toThrow();
	});

	test("drops slices a field hides", () => {
		const t = template(shape("s", {}, { visibleWhen: { field: "show" } }));
		expect(resolveSlices(t, {})).toHaveLength(0);
		expect(resolveSlices(t, { values: { show: true } })).toHaveLength(1);
	});

	test("applies variant deltas and hidden", () => {
		const t = template(shape("a"), shape("b"));
		t.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						elements: [
							{ id: "a", properties: {}, pos: { x: 0, y: 0 } },
							{ id: "b", properties: {}, hidden: true },
						],
					},
				],
			},
		];
		const slices = resolveSlices(t, { variantId: "v" });
		expect(ids(slices)).toEqual(["a"]);
		expect(slices[0].box).toMatchObject({ x: 0, y: 0 });
	});

	test("a variant delta can set or change the modifier", () => {
		const t = template(rect("r"), shape("b", { edge: "kiss", bleed: 1 }));
		t.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						elements: [
							{ id: "r", properties: { slice: { name: "card" } } },
							{ id: "b", properties: { slice: { edge: "through" } } },
						],
					},
				],
			},
		];
		expect(ids(resolveSlices(t, {}))).toEqual(["b"]);
		const slices = resolveSlices(t, { variantId: "v" });
		expect(ids(slices)).toEqual(["r", "b"]);
		expect(slices[0].name).toBe("card");
		expect(slices[1]).toMatchObject({
			edge: "through",
			bleed: { top: 0, right: 0, bottom: 0, left: 0 },
		});
	});

	test("follows constraints when resized", () => {
		const t = template(
			shape("s", {}, { constraints: { horizontal: "end" } }),
		);
		const [s] = resolveSlices(t, { resize: { width: 200, height: 80 } });
		expect(s.box.x).toBe(110);
	});

	test("a resized vector keeps its path in its box", () => {
		const t = template(
			vector("v", {}, {}, { constraints: { horizontal: "scale" } }),
		);
		const [s] = resolveSlices(t, { resize: { width: 200, height: 80 } });
		expect(s.box.width).toBeGreaterThan(40);
	});
});
