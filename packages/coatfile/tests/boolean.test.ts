// A vector's live boolean operation: validation, the walkers that reach its
// operands, and the path compile rebuilds from them.
import { type BooleanOperand, createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test, vi } from "vitest";
import {
	applyBooleans,
	cachePathOp,
	canvasKitPathOp,
	type PathOp,
} from "../src/boolean";
import { compile } from "../src/compile";
import { renderTemplate } from "../src/render";
import { resizeElements } from "../src/relayout";
import { childElements } from "../src/tree";
import type {
	BooleanOp,
	Element,
	GroupNode,
	PathNode,
	Template,
	VectorElement,
} from "../src/types";
import { validate } from "../src/validate";

const CACHED = "M0 0L5 0L5 5Z";

const rect = (
	id: string,
	x: number,
	y: number,
	size: number,
	extra: Partial<Element> = {},
): Element =>
	({
		id,
		type: "rect",
		pos: { x, y },
		size: { width: size, height: size },
		properties: { fill: "#000" },
		...extra,
	}) as Element;

function shape(
	op: BooleanOp,
	operands: Element[],
	extra: Partial<VectorElement> = {},
): VectorElement {
	return {
		id: "shape",
		type: "vector",
		pos: { x: 10, y: 10 },
		size: { width: 100, height: 100 },
		properties: {
			d: CACHED,
			fill: "#ff0000",
			boolean: { op, operands: operands as never },
		},
		...extra,
	};
}

function template(...elements: Element[]): Template {
	return {
		format_version: "1.7",
		version: "1.0.0",
		id: "t",
		name: "T",
		product: "test",
		width: 200,
		height: 200,
		fields: {
			type: "object",
			properties: { show: { type: "string", format: "boolean" } },
		},
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements,
			},
		],
	};
}

const pathOf = (tpl: Template, values = {}, opts = {}): PathNode => {
	const root = compile(tpl, values, {
		width: 200,
		height: 200,
		...opts,
	}).frames[0].root;
	const find = (node: GroupNode): PathNode | undefined => {
		for (const c of node.children) {
			if (c.kind === "path") return c;
			if (c.kind === "group") {
				const found = find(c);
				if (found) return found;
			}
		}
	};
	const node = find(root);
	if (!node) throw new Error("no path");
	return node;
};

let ck: Awaited<ReturnType<typeof loadCanvasKit>>;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const spy = (): PathOp & ReturnType<typeof vi.fn> =>
	vi.fn((_op, operands: BooleanOperand[]) =>
		operands.length
			? { d: `M0 0H${operands.length}`, box: { x: 0, y: 0, width: 1, height: 1 } }
			: null,
	);

describe("validation", () => {
	test("accepts rect and vector operands, nested booleans included", () => {
		const inner = shape("union", [rect("c", 0, 0, 10)], { id: "inner" });
		const result = validate(
			template(shape("subtract", [rect("a", 0, 0, 50), inner])),
		);
		expect(result.ok).toBe(true);
	});

	test("rejects an operand that is not a rect or vector", () => {
		const text = {
			id: "label",
			type: "text",
			size: { width: 10, height: 10 },
			properties: { value: "x", font: { family: "Inter", size: 8 } },
		} as Element;
		const result = validate(template(shape("union", [rect("a", 0, 0, 5), text])));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toContainEqual(
			expect.objectContaining({
				code: "invalid_boolean_operand",
				path: expect.stringContaining("/boolean/operands/1"),
			}),
		);
	});

	test("rejects an unknown operation", () => {
		const bad = shape("union", [rect("a", 0, 0, 5)]);
		(bad.properties.boolean as { op: string }).op = "merge";
		expect(validate(template(bad)).ok).toBe(false);
	});

	test("an operand's visibleWhen must name a field", () => {
		const gated = rect("a", 0, 0, 5, { visibleWhen: { field: "missing" } });
		const result = validate(template(shape("union", [gated])));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.map((e) => e.code)).toContain(
			"unknown_field_reference",
		);
	});
});

describe("tree", () => {
	test("childElements reaches the operands", () => {
		const a = rect("a", 0, 0, 5);
		expect(childElements(shape("union", [a]))).toEqual([a]);
	});
});

describe("compile", () => {
	const operands = () => [rect("a", 0, 0, 60), rect("b", 30, 30, 60)];

	test("without a pathOp the cached d is drawn", () => {
		expect(pathOf(template(shape("intersect", operands()))).d).toBe(CACHED);
	});

	test("with a pathOp the path is rebuilt from the operands", () => {
		const tpl = template(shape("intersect", operands()));
		const rebuilt = pathOf(tpl, {}, { pathOp: canvasKitPathOp(ck) });
		expect(rebuilt.d).toBe("M30 30L60 30L60 60L30 60Z");
	});

	test("the vector keeps its authored box", () => {
		const tpl = template(shape("subtract", operands()));
		const node = pathOf(tpl, {}, { pathOp: canvasKitPathOp(ck) });
		expect(node.pos).toEqual({ x: 10, y: 10 });
		expect(node.size).toEqual({ width: 100, height: 100 });
	});

	test("an operation with no result draws nothing", () => {
		const tpl = template(
			shape("intersect", [rect("a", 0, 0, 10), rect("b", 50, 50, 10)]),
		);
		expect(pathOf(tpl, {}, { pathOp: canvasKitPathOp(ck) }).d).toBe("");
	});

	test("the cached fill rule gives way to the rebuilt one", () => {
		const base = shape("union", operands());
		const withRule = {
			...base,
			properties: { ...base.properties, fillRule: "evenodd" },
		} as VectorElement;
		const node = pathOf(template(withRule), {}, { pathOp: spy() });
		expect(node.fillRule).toBeUndefined();
	});

	test("an operand hidden by visibleWhen drops out", () => {
		const pathOp = spy();
		const gated = rect("b", 30, 30, 60, { visibleWhen: { field: "show" } });
		const tpl = template(shape("union", [rect("a", 0, 0, 60), gated]));
		expect(pathOf(tpl, {}, { pathOp }).d).toBe("M0 0H1");
		expect(pathOf(tpl, { show: "true" }, { pathOp }).d).toBe("M0 0H2");
	});

	test("a vector with every operand hidden draws nothing", () => {
		const gated = rect("a", 0, 0, 60, { visibleWhen: { field: "show" } });
		const tpl = template(shape("union", [gated]));
		expect(pathOf(tpl, {}, { pathOp: spy() }).d).toBe("");
	});

	test("a nested operation is combined before its parent", () => {
		const inner = shape("union", [rect("c", 0, 0, 10), rect("d", 5, 5, 10)], {
			id: "inner",
		});
		const pathOp = spy();
		const tpl = template(shape("subtract", [rect("a", 0, 0, 60), inner]));
		pathOf(tpl, {}, { pathOp });
		expect(pathOp).toHaveBeenCalledTimes(2);
		const [op, parent] = pathOp.mock.calls[1] as [BooleanOp, BooleanOperand[]];
		expect(op).toBe("subtract");
		expect(parent.map((o) => o.kind)).toEqual(["rect", "path"]);
		expect((parent[1] as { d: string }).d).toBe("M0 0H2");
	});

	test("a variant delta reaches an operand by id", () => {
		const pathOp = spy();
		const tpl = template(shape("union", operands()));
		tpl.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						elements: [{ id: "b", pos: { x: 70, y: 0 }, properties: {} }],
					},
				],
			},
		];
		pathOf(tpl, {}, { pathOp, variantId: "v" });
		const operandsSeen = pathOp.mock.calls[0][1] as BooleanOperand[];
		expect(operandsSeen[1].pos).toEqual({ x: 70, y: 0 });
	});

	test("a variant can hide an operand", () => {
		const pathOp = spy();
		const tpl = template(shape("union", operands()));
		tpl.variants = [
			{
				id: "v",
				label: "V",
				overrides: [
					{
						name: "front",
						elements: [{ id: "b", hidden: true, properties: {} }],
					},
				],
			},
		];
		pathOf(tpl, {}, { pathOp, variantId: "v" });
		expect(pathOp.mock.calls[0][1]).toHaveLength(1);
	});

	test("resize scales the operands with the vector", () => {
		const pathOp = spy();
		const vector = shape("union", operands(), {
			constraints: { horizontal: "scale", vertical: "scale" },
		});
		pathOf(template(vector), {}, { pathOp, resize: { width: 400, height: 400 } });
		const seen = pathOp.mock.calls[0][1] as BooleanOperand[];
		expect(seen[1].pos).toEqual({ x: 60, y: 60 });
		expect(seen[1].size).toEqual({ width: 120, height: 120 });
	});
});

describe("applyBooleans", () => {
	test("reaches vectors inside frames and masks", () => {
		const frame = {
			id: "f",
			type: "frame",
			size: { width: 100, height: 100 },
			properties: { children: [shape("union", [rect("a", 0, 0, 5)])] },
		} as Element;
		const out = applyBooleans([frame], spy());
		const inner = (out[0] as { properties: { children: VectorElement[] } })
			.properties.children[0];
		expect(inner.properties.d).toBe("M0 0H1");
	});

	test("elements without a boolean are returned as they were", () => {
		const plain = rect("a", 0, 0, 5);
		expect(applyBooleans([plain], spy())[0]).toBe(plain);
	});
});

describe("resizeElements", () => {
	test("scales operand positions, sizes and vector paths", () => {
		const inner = {
			id: "c",
			type: "vector",
			pos: { x: 10, y: 10 },
			size: { width: 20, height: 20 },
			properties: { d: "M0 0L20 20" },
		} as Element;
		const vector = shape("union", [rect("a", 10, 20, 30), inner], {
			constraints: { horizontal: "scale", vertical: "scale" },
		});
		const [out] = resizeElements(
			[{ ...vector, pos: { x: 0, y: 0 } }],
			{ width: 200, height: 200 },
			{ width: 400, height: 100 },
		) as VectorElement[];
		const [a, c] = out.properties.boolean?.operands as [Element, VectorElement];
		expect(a.pos).toEqual({ x: 20, y: 10 });
		expect(a.size).toEqual({ width: 60, height: 15 });
		expect(c.properties.d).toBe("M0 0L40 10");
	});
});

describe("cachePathOp", () => {
	test("computes one operation and its geometry once", () => {
		const inner = spy();
		const cached = cachePathOp(inner);
		const operands: BooleanOperand[] = [
			{ kind: "rect", size: { width: 5, height: 5 } },
		];
		const first = cached("union", operands);
		expect(cached("union", structuredClone(operands))).toBe(first);
		cached("subtract", operands);
		expect(inner).toHaveBeenCalledTimes(2);
	});

	test("remembers an empty result", () => {
		const inner = vi.fn(() => null);
		const cached = cachePathOp(inner);
		expect(cached("union", [])).toBeNull();
		expect(cached("union", [])).toBeNull();
		expect(inner).toHaveBeenCalledTimes(1);
	});

	test("forgets the oldest result past its limit", () => {
		const inner = spy();
		const cached = cachePathOp(inner, 1);
		cached("union", [{ kind: "rect" }]);
		cached("subtract", [{ kind: "rect" }]);
		cached("union", [{ kind: "rect" }]);
		expect(inner).toHaveBeenCalledTimes(3);
	});
});

describe("renderTemplate", () => {
	test("paints the rebuilt path", async () => {
		const renderer = await createRenderer({ ck });
		const tpl = template(
			shape("subtract", [rect("a", 0, 0, 100), rect("b", 0, 0, 50)]),
		);
		const [frame] = await renderTemplate(renderer, tpl, {});
		expect(frame.warnings).toEqual([]);
		renderer.dispose();
	});
});
