import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { FORMAT_VERSION, minimumFormatVersion } from "../src/format";
import { resolveSlices } from "../src/slices";
import type { Element, Template } from "../src/types";
import { validate } from "../src/validate";

const slice = (
	id: string,
	extra: Record<string, unknown> = {},
	properties: Record<string, unknown> = {},
): Element =>
	({
		id,
		type: "slice",
		pos: { x: 10, y: 20 },
		size: { width: 40, height: 30 },
		properties,
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
				elements: [slice("other")],
			},
		],
	};
}

const codes = (t: Template): string[] => {
	const r = validate(t);
	return r.ok ? [] : r.errors.map((e) => e.code);
};

describe("slice validation", () => {
	test("accepts a top-level slice with every property", () => {
		const t = template(
			slice(
				"s",
				{},
				{
					name: "panel",
					shape: { kind: "rect", cornerRadius: [1, 2, 3, 4] },
					output: "none",
					edge: "kiss",
					bleed: { top: 1, right: 2, bottom: 3, left: 4 },
					order: 2,
				},
			),
			slice("p", {}, { shape: { kind: "path", d: "M0 0 L40 0 L0 30 Z" } }),
		);
		expect(codes(t)).toEqual([]);
	});

	test("rejects an unknown edge", () => {
		expect(validate(template(slice("s", {}, { edge: "burn" }))).ok).toBe(false);
	});

	test("must be top-level", () => {
		const frame = {
			id: "f",
			type: "frame",
			properties: { children: [slice("a")] },
		} as Element;
		const mask = {
			id: "m",
			type: "mask",
			properties: { mask: slice("b"), children: [slice("c")] },
		} as Element;
		const vector = {
			id: "v",
			type: "vector",
			size: { width: 10, height: 10 },
			properties: {
				d: "",
				boolean: { op: "union", operands: [slice("d"), rect("e")] },
			},
		} as Element;
		const found = codes(template(frame, mask, vector));
		expect(found.filter((c) => c === "slice_not_top_level")).toHaveLength(4);
	});

	test("needs a positive size", () => {
		expect(codes(template(slice("s", { size: undefined })))).toContain(
			"slice_size_required",
		);
		expect(
			codes(template(slice("s", { size: { width: 0, height: 10 } }))),
		).toContain("slice_size_required");
	});

	test("cannot be rotated", () => {
		expect(codes(template(slice("s", { rotation: 15 })))).toContain(
			"slice_rotated",
		);
		expect(codes(template(slice("s", { rotation: 0 })))).toEqual([]);
	});

	test("names are unique per side, falling back to the id", () => {
		const t = template(slice("a", {}, { name: "b" }), slice("b"));
		expect(codes(t)).toContain("slice_name_duplicate");
		const other = template(slice("a"), slice("b"));
		other.template_data[1].elements = [slice("a")];
		expect(codes(other)).toEqual([]);
	});

	test("bleed must not be negative", () => {
		expect(codes(template(slice("s", {}, { bleed: -1 })))).toContain(
			"invalid_inset",
		);
		expect(
			codes(
				template(
					slice("s", {}, { bleed: { top: 1, right: -2, bottom: 0, left: 0 } }),
				),
			),
		).toContain("invalid_inset");
	});

	test("ignores effects that mean nothing to it", () => {
		expect(
			codes(template(slice("s", { opacity: 0.5, blur: 4, blendMode: "multiply" }))),
		).toEqual([]);
	});
});

describe("slice format version", () => {
	test("is 1.7 and a slice needs it", () => {
		expect(FORMAT_VERSION).toBe("1.7");
		const plain = template(rect("r"));
		plain.template_data[1].elements = [];
		expect(minimumFormatVersion(plain)).toBe("1.0");
		expect(minimumFormatVersion(template(slice("s")))).toBe("1.7");
	});
});

describe("slice compile", () => {
	test("paints nothing", () => {
		const base = compile(template(rect("r")), {}, { width: 100, height: 80 });
		const withSlice = compile(
			template(rect("r"), slice("s"), slice("t", { opacity: 0.5 })),
			{},
			{ width: 100, height: 80 },
		);
		expect(withSlice.frames[0].root.children).toHaveLength(
			base.frames[0].root.children.length,
		);
	});
});

describe("resolveSlices", () => {
	test("a rect slice becomes a closed outline in trim coordinates", () => {
		const [s] = resolveSlices(template(slice("s")), {});
		expect(s).toEqual({
			id: "s",
			name: "s",
			box: { x: 10, y: 20, width: 40, height: 30 },
			path: "M 10 20 H 50 V 50 H 10 Z",
			fillRule: "nonzero",
			output: "piece",
			edge: "none",
			bleed: { top: 0, right: 0, bottom: 0, left: 0 },
			order: 0,
		});
	});

	test("rounded corners are arcs, clamped to fit", () => {
		const [s] = resolveSlices(
			template(slice("s", {}, { shape: { kind: "rect", cornerRadius: 5 } })),
			{},
		);
		expect(s.path.startsWith("M 15 20")).toBe(true);
		expect(s.path).toContain("A 5 5 0 0 1 50 25");
		expect(s.path.endsWith("Z")).toBe(true);
		const [pill] = resolveSlices(
			template(slice("s", {}, { shape: { kind: "rect", cornerRadius: 999 } })),
			{},
		);
		expect(pill.path).toContain("A 15 15 0 0 1");
	});

	test("a path shape is moved to the box", () => {
		const [s] = resolveSlices(
			template(
				slice(
					"s",
					{},
					{
						shape: { kind: "path", d: "M0 0 L40 0 L0 30 Z", fillRule: "evenodd" },
					},
				),
			),
			{},
		);
		expect(s.fillRule).toBe("evenodd");
		expect(s.path).toBe("M 10 20 L 50 20 L 10 50 Z");
	});

	test("resolves name, output, edge and bleed", () => {
		const [s] = resolveSlices(
			template(
				slice(
					"s",
					{},
					{ name: "panel", output: "none", edge: "through", bleed: 3 },
				),
			),
			{},
		);
		expect(s).toMatchObject({
			name: "panel",
			output: "none",
			edge: "through",
			bleed: { top: 3, right: 3, bottom: 3, left: 3 },
		});
	});

	test("sorts by order, then document order", () => {
		const slices = resolveSlices(
			template(
				slice("a", {}, { order: 2 }),
				slice("b"),
				slice("c", {}, { order: 0 }),
				slice("d", {}, { order: -1 }),
			),
			{},
		);
		expect(slices.map((s) => s.id)).toEqual(["d", "c", "b", "a"]);
	});

	test("picks the side, defaulting to the first", () => {
		const t = template(slice("s"));
		expect(resolveSlices(t, {}).map((s) => s.id)).toEqual(["s"]);
		expect(resolveSlices(t, { frameName: "back" }).map((s) => s.id)).toEqual([
			"other",
		]);
		expect(() => resolveSlices(t, { frameName: "nope" })).toThrow();
	});

	test("drops slices a field hides", () => {
		const t = template(slice("s", { visibleWhen: { field: "show" } }));
		expect(resolveSlices(t, {})).toHaveLength(0);
		expect(resolveSlices(t, { values: { show: true } })).toHaveLength(1);
	});

	test("applies variant deltas and hidden", () => {
		const t = template(slice("a"), slice("b"));
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
		expect(slices.map((s) => s.id)).toEqual(["a"]);
		expect(slices[0].box).toMatchObject({ x: 0, y: 0 });
	});

	test("follows constraints when resized", () => {
		const t = template(
			slice("s", {
				pos: { x: 10, y: 20 },
				constraints: { horizontal: "end" },
			}),
		);
		const [s] = resolveSlices(t, { resize: { width: 200, height: 80 } });
		expect(s.box.x).toBe(110);
	});
});
