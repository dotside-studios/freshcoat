import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { minimumFormatVersion } from "../src/format";
import type {
	Element,
	GroupNode,
	RectNode,
	Template,
	Variant,
} from "../src/types";
import { validate } from "../src/validate";

const sides = { top: 1, right: 2, bottom: 3 };

function template(element: Element, variants?: Variant[]): Template {
	return {
		format_version: "1.7",
		id: "s",
		name: "S",
		width: 100,
		height: 60,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements: [element],
			},
		],
		...(variants ? { variants } : {}),
	};
}

const rect = (width: unknown): Element => ({
	id: "r",
	type: "rect",
	pos: { x: 10, y: 10 },
	size: { width: 80, height: 40 },
	properties: { stroke: { color: "#000", width, align: "inside" } as never },
});

const frame = (width: unknown, clipsContent?: boolean): Element => ({
	id: "f",
	type: "frame",
	pos: { x: 10, y: 10 },
	size: { width: 80, height: 40 },
	properties: {
		fill: "#eee",
		stroke: { color: "#000", width, align: "outside" } as never,
		...(clipsContent ? { clipsContent } : {}),
		children: [],
	},
});

const element = (type: "image" | "vector", width: unknown): Element =>
	({
		id: "e",
		type,
		pos: { x: 0, y: 0 },
		size: { width: 10, height: 10 },
		properties: {
			...(type === "image"
				? { src: "a.png", fit: "cover" }
				: { d: "M0 0 L10 10" }),
			stroke: { color: "#000", width },
		},
	}) as Element;

describe("per-side stroke validation", () => {
	test("a rect and a frame take a width per side", () => {
		expect(validate(template(rect(sides))).ok).toBe(true);
		expect(validate(template(rect({}))).ok).toBe(true);
		expect(validate(template(frame(sides))).ok).toBe(true);
	});

	test("rejects a negative side", () => {
		expect(validate(template(rect({ top: -1 }))).ok).toBe(false);
	});

	test("other elements keep one number, and say so", () => {
		for (const type of ["image", "vector"] as const) {
			const result = validate(template(element(type, sides)));
			expect(result.ok).toBe(false);
			if (result.ok) continue;
			expect(result.errors).toContainEqual(
				expect.objectContaining({
					path: "/template_data/0/elements/0/properties/stroke/width",
					message:
						"a width per side is only for a rect or frame stroke; use one number",
				}),
			);
		}
	});
});

describe("per-side stroke compile", () => {
	const root = (t: Template, width = 100) =>
		compile(t, {}, { width, height: width * 0.6 }).frames[0]?.root as GroupNode;

	test("a rect compiles to the engine's sides, scaled, widest as width", () => {
		const stroke = (root(template(rect(sides)), 200).children[1] as RectNode)
			.stroke;
		expect(stroke?.width).toBe(6);
		expect(stroke?.sides).toEqual({ top: 2, right: 4, bottom: 6, left: 0 });
	});

	test("four equal sides are one width", () => {
		const stroke = (
			root(template(rect({ top: 2, right: 2, bottom: 2, left: 2 })))
				.children[1] as RectNode
		).stroke;
		expect(stroke?.width).toBe(2);
		expect(stroke?.sides).toBeUndefined();
	});

	test("a frame's background and a clipping frame's outside stroke carry it", () => {
		const bg = (root(template(frame(sides))).children[1] as GroupNode)
			.children[0] as RectNode;
		expect(bg.stroke?.sides).toEqual({ top: 1, right: 2, bottom: 3, left: 0 });
		const clipped = root(template(frame(sides, true))).children[1] as GroupNode;
		const ring = clipped.children[1] as RectNode;
		expect(ring.kind).toBe("rect");
		expect(ring.stroke?.sides).toEqual({
			top: 1,
			right: 2,
			bottom: 3,
			left: 0,
		});
	});
});

describe("per-side stroke format version", () => {
	test("a number width stays at its old minor", () => {
		expect(minimumFormatVersion(template(rect(2)))).toBe("1.1");
		expect(minimumFormatVersion(template(frame(2)))).toBe("1.1");
	});

	test("a width per side needs 1.7, on an element or a variant", () => {
		expect(minimumFormatVersion(template(rect(sides)))).toBe("1.7");
		expect(minimumFormatVersion(template(frame(sides)))).toBe("1.7");
		expect(
			minimumFormatVersion(
				template(rect(2), [
					{
						id: "v",
						label: "V",
						overrides: [
							{
								name: "front",
								elements: [
									{
										id: "r",
										properties: { stroke: { color: "#000", width: sides } },
									},
								],
							},
						],
					},
				]),
			),
		).toBe("1.7");
	});
});
