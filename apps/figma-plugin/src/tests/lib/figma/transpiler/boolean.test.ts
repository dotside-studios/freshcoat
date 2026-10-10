import { validate } from "@freshcoat-js/coatfile";
import { describe, expect, it, vi } from "vitest";
import { liveBoolean } from "~/lib/figma/transpiler/boolean";
import { classify } from "~/lib/figma/transpiler/classify";
import { type TranspileInput, transpile } from "~/lib/figma/transpiler/index";
import type {
	FigmaBooleanOperation,
	FigmaContainerNode,
	FigmaNode,
	FigmaTransform,
	FigmaVectorNode,
} from "~/lib/figma/types";
import { makeCustomProduct } from "~/main/product";

const at = (x: number, y: number): FigmaTransform => [
	[1, 0, x],
	[0, 1, y],
];

const SOLID = [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }] as const;

type Placed = { x: number; y: number; width: number; height: number };

const base = (id: string, name: string, box: Placed) => ({
	id,
	name,
	visible: true,
	opacity: 1,
	blendMode: "NORMAL" as const,
	absoluteBoundingBox: box,
	width: box.width,
	height: box.height,
	relativeTransform: at(box.x, box.y),
});

const rect = (id: string, box: Placed, extra: Partial<FigmaNode> = {}) =>
	({
		...base(id, `rect_${id}`, box),
		type: "RECTANGLE",
		fills: [...SOLID],
		...extra,
	}) as FigmaNode;

const ellipse = (id: string, box: Placed, extra: Partial<FigmaNode> = {}) =>
	({
		...base(id, `ellipse_${id}`, box),
		type: "ELLIPSE",
		fills: [...SOLID],
		fillGeometry: [
			{
				path: `M ${box.width / 2} 0 L ${box.width} ${box.height / 2} L ${box.width / 2} ${box.height} L 0 ${box.height / 2} Z`,
				windingRule: "NONZERO",
			},
		],
		...extra,
	}) as FigmaNode;

const boolean = (
	id: string,
	box: Placed,
	operation: FigmaBooleanOperation,
	children: FigmaNode[],
	extra: Partial<FigmaVectorNode> = {},
): FigmaVectorNode => ({
	...base(id, `bool_${id}`, box),
	type: "BOOLEAN_OPERATION",
	fills: [...SOLID],
	fillGeometry: [
		{ path: "M 0 0 L 60 0 L 60 50 L 0 50 Z", windingRule: "NONZERO" },
	],
	booleanOperation: operation,
	children,
	...extra,
});

const BOX: Placed = { x: 20, y: 30, width: 60, height: 50 };
const RECT_BOX: Placed = { x: 20, y: 30, width: 40, height: 40 };
const ELLIPSE_BOX: Placed = { x: 40, y: 40, width: 40, height: 40 };

async function run(child: FigmaNode) {
	const frame: FigmaContainerNode = {
		id: "f",
		name: "f",
		type: "FRAME",
		visible: true,
		opacity: 1,
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
		children: [child],
		fills: [],
	};
	const input: TranspileInput = {
		product: makeCustomProduct("f", 200, 200),
		sizeMode: "from-design",
		picks: {
			f: { fileKey: "FK", nodeId: "f", nodeName: "f", width: 200, height: 200 },
		},
		metadata: {
			id: "t",
			name: "T",
			version: "1.0.0",
			formatVersion: "1.6",
		},
		fetchNodeTree: async () => frame,
		renderImage: vi.fn(),
	};
	const out = await transpile(input);
	const template = out.template as {
		// biome-ignore lint/suspicious/noExplicitAny: the untyped template output
		template_data: { elements: Record<string, any>[] }[];
	};
	return { out, element: template.template_data[0].elements[0] };
}

describe("live boolean operations", () => {
	it("keeps a union of a rect and an ellipse live", async () => {
		const node = boolean("1:1", BOX, "UNION", [
			rect("1:2", RECT_BOX),
			ellipse("1:3", ELLIPSE_BOX),
		]);
		const { out, element } = await run(node);
		expect(element.type).toBe("vector");
		expect(element.properties.boolean).toEqual({
			op: "union",
			operands: [
				{
					id: "rect_1_2",
					type: "rect",
					pos: { x: 0, y: 0 },
					size: { width: 40, height: 40 },
					properties: {},
				},
				{
					id: "ellipse_1_3",
					type: "vector",
					pos: { x: 20, y: 10 },
					size: { width: 40, height: 40 },
					properties: {
						d: "M 20 0 L 40 20 L 20 40 L 0 20 Z",
					},
				},
			],
		});
		expect(validate(out.template).ok).toBe(true);
		expect(out.warnings.map((w) => w.code)).not.toContain("boolean_flattened");
	});

	it("caches Figma's own result as d", async () => {
		const node = boolean(
			"1:1",
			BOX,
			"UNION",
			[rect("1:2", RECT_BOX), ellipse("1:3", ELLIPSE_BOX)],
			{
				fillGeometry: [{ path: "M 0 0 L 9 0 L 9 9 Z", windingRule: "EVENODD" }],
			},
		);
		const { element } = await run(node);
		expect(element.properties.d).toBe("M 0 0 L 9 0 L 9 9 Z");
		expect(element.properties.fillRule).toBe("evenodd");
	});

	it("paints the boolean's fill and stroke, not the operands'", async () => {
		const node = boolean("1:1", BOX, "UNION", [
			rect("1:2", RECT_BOX, {
				fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
			}),
			ellipse("1:3", ELLIPSE_BOX),
		]);
		const { element } = await run(node);
		expect(element.properties.fill).toBe("#ff0000");
		for (const operand of element.properties.boolean.operands)
			expect(operand.properties.fill).toBeUndefined();
	});

	it.each([
		["SUBTRACT", "subtract"],
		["INTERSECT", "intersect"],
		["EXCLUDE", "exclude"],
	] as const)("maps %s", async (figma, op) => {
		const { element } = await run(
			boolean("1:1", BOX, figma, [rect("1:2", RECT_BOX)]),
		);
		expect(element.properties.boolean.op).toBe(op);
	});

	it("orders operands bottom-most first, as Figma lists children", async () => {
		const { element } = await run(
			boolean("1:1", BOX, "SUBTRACT", [
				rect("1:2", RECT_BOX),
				ellipse("1:3", ELLIPSE_BOX),
			]),
		);
		expect(
			element.properties.boolean.operands.map((o: { id: string }) => o.id),
		).toEqual(["rect_1_2", "ellipse_1_3"]);
	});

	it("keeps per-corner radii on a rect operand", async () => {
		const { element } = await run(
			boolean("1:1", BOX, "UNION", [
				rect("1:2", RECT_BOX, { cornerRadius: [4, 0, 4, 0] } as never),
			]),
		);
		expect(element.properties.boolean.operands[0].properties).toEqual({
			cornerRadius: [4, 0, 4, 0],
		});
	});

	it("nests a boolean operand with its own boolean", async () => {
		const inner = boolean(
			"1:4",
			{ x: 20, y: 30, width: 60, height: 50 },
			"INTERSECT",
			[rect("1:5", RECT_BOX), ellipse("1:6", ELLIPSE_BOX)],
		);
		const { out, element } = await run(
			boolean("1:1", BOX, "SUBTRACT", [rect("1:2", RECT_BOX), inner]),
		);
		const nested = element.properties.boolean.operands[1];
		expect(nested).toMatchObject({
			id: "bool_1_4",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 60, height: 50 },
			properties: {
				d: "M 0 0 L 60 0 L 60 50 L 0 50 Z",
				boolean: { op: "intersect" },
			},
		});
		expect(nested.properties.boolean.operands).toHaveLength(2);
		expect(validate(out.template).ok).toBe(true);
	});

	it("leaves out a hidden child", async () => {
		const { element } = await run(
			boolean("1:1", BOX, "UNION", [
				rect("1:2", RECT_BOX),
				ellipse("1:3", ELLIPSE_BOX, { visible: false }),
			]),
		);
		expect(element.properties.boolean.operands).toHaveLength(1);
		expect(element.properties.boolean.operands[0].id).toBe("rect_1_2");
	});

	it("turns a rotated child about its centre in the boolean's box", async () => {
		// 90 degrees about the centre (60, 60) of a 40x40 child.
		const turned = rect(
			"1:2",
			{ x: 40, y: 40, width: 40, height: 40 },
			{
				relativeTransform: [
					[0, -1, 80],
					[1, 0, 40],
				],
			},
		);
		const { out, element } = await run(boolean("1:1", BOX, "UNION", [turned]));
		expect(element.properties.boolean.operands[0]).toMatchObject({
			pos: { x: 20, y: 10 },
			size: { width: 40, height: 40 },
			rotation: 90,
		});
		expect(validate(out.template).ok).toBe(true);
	});

	it("places operands relative to a rotated boolean", async () => {
		const quarter: FigmaTransform = [
			[0, -1, 100],
			[1, 0, 20],
		];
		// The boolean and its child share one 90 degree turn, so the child is
		// upright and at the origin of the boolean's own space.
		const { element } = await run(
			boolean(
				"1:1",
				BOX,
				"UNION",
				[rect("1:2", RECT_BOX, { relativeTransform: quarter })],
				{ relativeTransform: quarter },
			),
		);
		const [operand] = element.properties.boolean.operands;
		expect(operand.pos).toEqual({ x: 0, y: 0 });
		expect(operand.rotation).toBeUndefined();
	});

	it("scales operand boxes and paths with the export", () => {
		const live = liveBoolean(
			boolean("1:1", BOX, "UNION", [
				rect("1:2", RECT_BOX, { cornerRadius: 4 } as never),
				ellipse("1:3", ELLIPSE_BOX),
			]),
			2,
		);
		if (!live || !("boolean" in live)) throw new Error("not live");
		expect(live.boolean.operands[0]).toMatchObject({
			size: { width: 80, height: 80 },
			properties: { cornerRadius: 8 },
		});
		expect(live.boolean.operands[1]).toMatchObject({
			pos: { x: 40, y: 20 },
			properties: { d: "M 40 0 L 80 40 L 40 80 L 0 40 Z" },
		});
	});

	describe("falls back to a flat vector", () => {
		const flat = async (node: FigmaVectorNode) => {
			const { out, element } = await run(node);
			expect(element.type).toBe("vector");
			expect(element.properties.boolean).toBeUndefined();
			expect(element.properties.d).toBe("M 0 0 L 60 0 L 60 50 L 0 50 Z");
			expect(validate(out.template).ok).toBe(true);
			return out;
		};

		it("for a text child", async () => {
			const text = {
				...base("1:3", "label", ELLIPSE_BOX),
				type: "TEXT",
				characters: "A",
				style: {},
				fills: [...SOLID],
			} as unknown as FigmaNode;
			const out = await flat(
				boolean("1:1", BOX, "UNION", [rect("1:2", RECT_BOX), text]),
			);
			const warning = out.warnings.find((w) => w.code === "boolean_flattened");
			expect(warning).toMatchObject({ severity: "info", nodeId: "1:1" });
			expect(warning?.message).toContain('"label" is a text');
		});

		it("for a group child", async () => {
			const group = {
				...base("1:3", "group", ELLIPSE_BOX),
				type: "GROUP",
				children: [],
			} as unknown as FigmaNode;
			const out = await flat(boolean("1:1", BOX, "UNION", [group]));
			expect(out.warnings.map((w) => w.code)).toContain("boolean_flattened");
		});

		it("for a skewed child", async () => {
			const skewed = rect("1:2", RECT_BOX, {
				relativeTransform: [
					[1, 0.5, 20],
					[0, 1, 30],
				],
			});
			const out = await flat(boolean("1:1", BOX, "UNION", [skewed]));
			expect(out.warnings.map((w) => w.code)).toContain("boolean_flattened");
		});

		it("for a flipped child", async () => {
			const flipped = rect("1:2", RECT_BOX, {
				relativeTransform: [
					[-1, 0, 60],
					[0, 1, 30],
				],
			});
			await flat(boolean("1:1", BOX, "UNION", [flipped]));
		});

		it("for a child with no fill region", async () => {
			const open = ellipse("1:3", ELLIPSE_BOX, { fillGeometry: [] } as never);
			await flat(boolean("1:1", BOX, "UNION", [rect("1:2", RECT_BOX), open]));
		});

		it("for a rect with corner smoothing", async () => {
			const smooth = rect("1:2", RECT_BOX, {
				cornerRadius: 8,
				cornerSmoothing: 0.6,
			} as never);
			await flat(boolean("1:1", BOX, "UNION", [smooth]));
		});

		it("for a mask child", async () => {
			await flat(
				boolean("1:1", BOX, "UNION", [rect("1:2", RECT_BOX, { isMask: true })]),
			);
		});

		it("for a nested boolean that cannot stay live", async () => {
			const text = {
				...base("1:5", "label", ELLIPSE_BOX),
				type: "TEXT",
				characters: "A",
				style: {},
				fills: [...SOLID],
			} as unknown as FigmaNode;
			const inner = boolean("1:4", BOX, "UNION", [text]);
			await flat(boolean("1:1", BOX, "UNION", [rect("1:2", RECT_BOX), inner]));
		});

		it("when every child is hidden", async () => {
			await flat(
				boolean("1:1", BOX, "UNION", [
					rect("1:2", RECT_BOX, { visible: false }),
				]),
			);
		});
	});

	it("is a plain vector when the children were not read", async () => {
		const node = boolean("1:1", BOX, "UNION", []);
		delete node.children;
		const { out, element } = await run(node);
		expect(element.properties.boolean).toBeUndefined();
		expect(out.warnings.map((w) => w.code)).not.toContain("boolean_flattened");
	});

	it("still classifies as a native vector", () => {
		expect(
			classify(boolean("1:1", BOX, "UNION", [rect("1:2", RECT_BOX)])).kind,
		).toBe("native-vector");
	});

	it("gives operands ids unique across the template", async () => {
		const { out, element } = await run(
			boolean("1:1", BOX, "UNION", [
				rect("1:2", RECT_BOX, { name: "bool_1_1" }),
			]),
		);
		expect(element.id).not.toBe(element.properties.boolean.operands[0].id);
		expect(validate(out.template).ok).toBe(true);
	});
});
