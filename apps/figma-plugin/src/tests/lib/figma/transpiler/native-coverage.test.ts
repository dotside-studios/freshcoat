import { describe, expect, it, vi } from "vitest";
import { classify } from "~/lib/figma/transpiler/classify";
import {
	type ProductRegistryEntry,
	transpile,
} from "~/lib/figma/transpiler/index";
import { transpileRect } from "~/lib/figma/transpiler/rect";
import { transpileText } from "~/lib/figma/transpiler/text";
import { transpileVector } from "~/lib/figma/transpiler/vector";
import type {
	FigmaContainerNode,
	FigmaGradientPaint,
	FigmaNode,
	FigmaPaint,
	FigmaRectangleNode,
	FigmaTextNode,
	FigmaVectorNode,
} from "~/lib/figma/types";

const FRAME = { x: 0, y: 0, width: 1000, height: 600 };
const CTX = { frame: FRAME, scale: 1 };

const solid = (
	r: number,
	g: number,
	b: number,
	opacity?: number,
): FigmaPaint => ({
	type: "SOLID",
	color: { r, g, b, a: 1 },
	...(opacity !== undefined ? { opacity } : {}),
});

const gradient = (
	type: FigmaGradientPaint["type"],
	handles: Array<{ x: number; y: number }>,
): FigmaPaint => ({
	type,
	gradientHandlePositions: handles,
	gradientStops: [
		{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
		{ position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
	],
});

const imagePaint: FigmaPaint = {
	type: "IMAGE",
	scaleMode: "FILL",
	imageRef: "ref",
};

const text = (overrides: Partial<FigmaTextNode> = {}): FigmaTextNode => ({
	id: "1:2",
	name: "copy",
	type: "TEXT",
	visible: true,
	opacity: 1,
	blendMode: "PASS_THROUGH",
	absoluteBoundingBox: { x: 10, y: 10, width: 300, height: 40 },
	relativeTransform: [
		[1, 0, 10],
		[0, 1, 10],
	],
	characters: "Hello world",
	style: {
		fontFamily: "Inter",
		fontSize: 20,
		fontWeight: 400,
		textAlignHorizontal: "LEFT",
		textAlignVertical: "TOP",
		textAutoResize: "NONE",
	},
	fills: [solid(0, 0, 0)],
	...overrides,
});

const rect = (
	overrides: Partial<FigmaRectangleNode> = {},
): FigmaRectangleNode => ({
	id: "1:3",
	name: "box",
	type: "RECTANGLE",
	visible: true,
	opacity: 1,
	blendMode: "PASS_THROUGH",
	absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
	relativeTransform: [
		[1, 0, 0],
		[0, 1, 0],
	],
	fills: [solid(0.5, 0.5, 0.5)],
	...overrides,
});

const vector = (overrides: Partial<FigmaVectorNode> = {}): FigmaVectorNode => ({
	id: "1:4",
	name: "icon",
	type: "VECTOR",
	visible: true,
	opacity: 1,
	blendMode: "PASS_THROUGH",
	absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
	relativeTransform: [
		[1, 0, 0],
		[0, 1, 0],
	],
	fillGeometry: [{ path: "M0 0L10 0L10 10Z" }],
	fills: [solid(0.5, 0.5, 0.5)],
	...overrides,
});

const frame = (
	children: FigmaNode[],
	overrides: Partial<FigmaContainerNode> = {},
): FigmaContainerNode => ({
	id: "1:5",
	name: "panel",
	type: "FRAME",
	visible: true,
	opacity: 1,
	blendMode: "PASS_THROUGH",
	absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
	relativeTransform: [
		[1, 0, 0],
		[0, 1, 0],
	],
	fills: [],
	children,
	...overrides,
});

const flattenReason = (n: FigmaNode) => {
	const c = classify(n);
	return c.kind === "flatten" ? c.reason : c.kind;
};

const SQUARE_SWEEP = [
	{ x: 0.5, y: 0.5 },
	{ x: 1, y: 0.5 },
	{ x: 0.5, y: 1 },
];

describe("mixed text styling", () => {
	const twoColor = () =>
		text({
			characters: "Hi there",
			characterStyleOverrides: [0, 0, 0, 1, 1, 1, 1, 1],
			styleOverrideTable: {
				"1": {
					fontFamily: "Inter",
					fontSize: 20,
					fontWeight: 400,
					fills: [solid(1, 0, 0)],
				},
			},
		});

	it("keeps runs that differ only in colour native, as coloured spans", () => {
		expect(classify(twoColor()).kind).toBe("native-text");
		const el = transpileText(twoColor(), CTX);
		expect(el.properties.color).toBe("#000000");
		expect(el.properties.spans).toEqual([
			{ text: "Hi " },
			{ text: "there", color: "#ff0000" },
		]);
	});

	it("carries only the font fields a run changes", () => {
		const el = transpileText(
			text({
				characters: "ab",
				characterStyleOverrides: [0, 1],
				styleOverrideTable: {
					"1": {
						fontFamily: "Inter",
						fontSize: 20,
						fontWeight: 700,
						italic: true,
						letterSpacing: 0,
					},
				},
			}),
			CTX,
		);
		const spans = el.properties.spans as Array<Record<string, unknown>>;
		expect(spans[1].font).toEqual({ weight: 700, style: "italic" });
	});

	it("folds a paint's opacity and a stack of solids into one colour", () => {
		const el = transpileText(
			text({ fills: [solid(1, 1, 1), solid(0, 0, 0, 0.5)] }),
			CTX,
		);
		expect(el.properties.color).toBe("#808080");
		const faded = transpileText(text({ fills: [solid(0, 0, 0, 0.5)] }), CTX);
		expect(faded.properties.color).toBe("#00000080");
	});

	it("sets a shared decoration on the element", () => {
		const el = transpileText(
			text({ style: { ...text().style, textDecoration: "UNDERLINE" } }),
			CTX,
		);
		expect((el.properties.font as Record<string, unknown>).decoration).toBe(
			"underline",
		);
	});

	it("moves a decoration onto the spans that have it when runs disagree", () => {
		const el = transpileText(
			text({
				characters: "ab",
				style: { ...text().style, textDecoration: "UNDERLINE" },
				characterStyleOverrides: [0, 1],
				styleOverrideTable: { "1": { textDecoration: "NONE" } },
			}),
			CTX,
		);
		expect(
			(el.properties.font as Record<string, unknown>).decoration,
		).toBeUndefined();
		expect(el.properties.spans).toEqual([
			{ text: "a", font: { decoration: "underline" } },
			{ text: "b" },
		]);
	});

	it("gives a text filled with one gradient an element fill", () => {
		const n = text({
			fills: [
				gradient("GRADIENT_LINEAR", [
					{ x: 0, y: 0.5 },
					{ x: 1, y: 0.5 },
					{ x: 0, y: 1 },
				]),
			],
		});
		expect(classify(n).kind).toBe("native-text");
		const el = transpileText(n, CTX);
		expect((el.properties.fill as { kind: string }).kind).toBe("linear");
		expect(el.properties.color).toBeUndefined();
	});

	it("still rasterizes a run painted with a gradient", () => {
		const n = text({
			characters: "ab",
			characterStyleOverrides: [0, 1],
			styleOverrideTable: {
				"1": {
					fills: [
						gradient("GRADIENT_LINEAR", [
							{ x: 0, y: 0.5 },
							{ x: 1, y: 0.5 },
						]),
					],
				},
			},
		});
		expect(flattenReason(n)).toBe("text_mixed_styling_flattened");
	});

	it("still rasterizes an image-filled text", () => {
		expect(flattenReason(text({ fills: [imagePaint] }))).toBe(
			"text_mixed_styling_flattened",
		);
	});
});

describe("fill stacks", () => {
	it("keeps each stacked solid's own alpha", () => {
		const el = transpileRect(
			rect({ fills: [solid(1, 1, 1), solid(0, 0, 0, 0.5)] }),
			CTX,
		);
		expect(el.properties.fill).toEqual(["#ffffff", "#00000080"]);
		expect(el.opacity).toBeUndefined();
	});

	it("stacks fills on a vector", () => {
		const n = vector({ fills: [solid(1, 0, 0), solid(0, 0, 1, 0.25)] });
		expect(classify(n).kind).toBe("native-vector");
		expect(transpileVector(n, CTX).properties.fill).toEqual([
			"#ff0000",
			"#0000ff40",
		]);
	});

	it("stacks fills on a frame", () => {
		const n = frame([], { fills: [solid(1, 0, 0), solid(0, 0, 1)] });
		expect(classify(n).kind).toBe("native-frame");
	});

	it("maps an evenly swept angular gradient", () => {
		const n = rect({ fills: [gradient("GRADIENT_ANGULAR", SQUARE_SWEEP)] });
		expect(classify(n).kind).toBe("native-rect");
		const fill = transpileRect(n, CTX).properties.fill as Record<
			string,
			unknown
		>;
		expect(fill.kind).toBe("angular");
		expect(fill.center).toEqual([0.5, 0.5]);
		expect(fill.rotation).toBe(90);
	});

	it("rasterizes an angular gradient stretched by its box", () => {
		const n = rect({
			width: 200,
			height: 100,
			absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
			fills: [gradient("GRADIENT_ANGULAR", SQUARE_SWEEP)],
		});
		expect(flattenReason(n)).toBe("paint_flattened");
	});

	it("rasterizes paints with no coatfile fill", () => {
		expect(
			flattenReason(
				rect({ fills: [gradient("GRADIENT_DIAMOND", SQUARE_SWEEP)] }),
			),
		).toBe("paint_flattened");
		expect(
			flattenReason(
				rect({ fills: [{ ...solid(1, 0, 0), blendMode: "MULTIPLY" }] }),
			),
		).toBe("paint_flattened");
		expect(flattenReason(vector({ fills: [imagePaint] }))).toBe(
			"paint_flattened",
		);
		expect(flattenReason(frame([], { fills: [imagePaint] }))).toBe(
			"paint_flattened",
		);
	});

	it("rasterizes an image fill inside a stack", () => {
		expect(flattenReason(rect({ fills: [solid(1, 0, 0), imagePaint] }))).toBe(
			"multi_fill_flattened",
		);
		expect(flattenReason(vector({ fills: [solid(1, 0, 0), imagePaint] }))).toBe(
			"multi_fill_flattened",
		);
	});
});

describe("blend modes", () => {
	it("keeps linear burn native on any layer", () => {
		expect(
			classify(text({ blendMode: "LINEAR_BURN", fills: [solid(0.5, 0.2, 0)] }))
				.kind,
		).toBe("native-text");
		expect(
			classify(
				rect({ blendMode: "LINEAR_BURN", fills: [solid(0.3, 0.3, 0.3)] }),
			).kind,
		).toBe("native-rect");
		expect(classify(frame([], { blendMode: "LINEAR_BURN" })).kind).toBe(
			"native-frame",
		);
	});

	it("keeps a pass-through frame with a blended child native", () => {
		const n = frame([rect({ blendMode: "MULTIPLY" })]);
		expect(classify(n).kind).toBe("native-frame");
	});

	it("keeps a Normal frame with a blended child native", () => {
		expect(
			classify(
				frame([rect({ blendMode: "MULTIPLY" })], { blendMode: "NORMAL" }),
			).kind,
		).toBe("native-frame");
		expect(
			classify(
				frame([frame([rect({ blendMode: "SCREEN" })])], {
					blendMode: "NORMAL",
				}),
			).kind,
		).toBe("native-frame");
	});
});

describe("effects", () => {
	it("rasterizes a progressive layer blur", () => {
		expect(
			flattenReason(
				rect({
					effects: [{ type: "LAYER_BLUR", radius: 4, blurType: "PROGRESSIVE" }],
				}),
			),
		).toBe("effect_flattened");
	});

	it("rasterizes a shadow with a blend mode of its own", () => {
		expect(
			flattenReason(
				rect({
					effects: [
						{
							type: "DROP_SHADOW",
							radius: 4,
							color: { r: 0, g: 0, b: 0, a: 0.5 },
							blendMode: "MULTIPLY",
						},
					],
				}),
			),
		).toBe("effect_flattened");
	});

	it("keeps stacked shadows and a layer blur native", () => {
		expect(
			classify(
				rect({
					effects: [
						{ type: "DROP_SHADOW", radius: 4, spread: 2 },
						{ type: "INNER_SHADOW", radius: 2 },
						{ type: "LAYER_BLUR", radius: 3 },
					],
				}),
			).kind,
		).toBe("native-rect");
	});
});

const PRODUCT: ProductRegistryEntry = {
	sku: "card",
	displayName: "Card",
	width: 1000,
	height: 600,
	frames: [{ name: "front", label: "Front", required: true }],
};
const META = { id: "t", name: "T", version: "1.0.0", formatVersion: "1.0" };

async function elementsOf(
	children: FigmaNode[],
): Promise<Array<Record<string, unknown>>> {
	const side = frame(children, {
		id: "1:1",
		name: "front",
		blendMode: "NORMAL",
		absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 600 },
	});
	const result = await transpile({
		product: PRODUCT,
		picks: {
			front: {
				fileKey: "FK",
				nodeId: "1:1",
				nodeName: "F",
				width: 1000,
				height: 600,
			},
		},
		metadata: META,
		fetchNodeTree: vi.fn(async () => side),
		renderImage: vi.fn(),
	});
	const t = result.template as {
		template_data: Array<{ elements: Array<Record<string, unknown>> }>;
	};
	return t.template_data[0].elements;
}

describe("in a transpiled card", () => {
	it("gives a blended group a layer of its own", async () => {
		const group = frame([rect()], {
			type: "GROUP",
			name: "tint",
			blendMode: "MULTIPLY",
		});
		const [el] = await elementsOf([group]);
		expect(el.type).toBe("frame");
		expect(el.blendMode).toBe("multiply");
	});

	it("isolates a Normal frame and leaves a pass-through one open", async () => {
		const [normal, passThrough] = await elementsOf([
			frame([rect({ blendMode: "MULTIPLY" })], {
				id: "1:6",
				name: "normal",
				blendMode: "NORMAL",
			}),
			frame([rect({ blendMode: "MULTIPLY" })], {
				id: "1:7",
				name: "open",
			}),
		]);
		expect(normal.type).toBe("frame");
		expect((normal.properties as Record<string, unknown>).isolate).toBe(true);
		expect(normal.blendMode).toBeUndefined();
		expect(passThrough.type).toBe("frame");
		expect(
			(passThrough.properties as Record<string, unknown>).isolate,
		).toBeUndefined();
	});

	it("gives a Normal group with a blended child an isolated layer", async () => {
		const [el] = await elementsOf([
			frame([rect({ blendMode: "MULTIPLY" })], {
				type: "GROUP",
				name: "tinted",
				blendMode: "NORMAL",
			}),
		]);
		expect(el.type).toBe("frame");
		expect((el.properties as Record<string, unknown>).isolate).toBe(true);
		const [child] = (el.properties as { children: Record<string, unknown>[] })
			.children;
		expect(child?.blendMode).toBe("multiply");
	});

	it("flattens a Normal group when nothing in it blends", async () => {
		const [el] = await elementsOf([
			frame([rect()], { type: "GROUP", name: "plain", blendMode: "NORMAL" }),
		]);
		expect(el.type).toBe("rect");
	});

	it("keeps a field's runs when they spell out its template", async () => {
		const [el] = await elementsOf([
			text({
				characters: "Hi {{name}}",
				characterStyleOverrides: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
				styleOverrideTable: { "1": { fontWeight: 700 } },
			}),
		]);
		const props = el.properties as Record<string, unknown>;
		expect(props.value).toBeUndefined();
		expect(props.spans).toEqual([
			{ text: "Hi " },
			{ text: "{{name}}", font: { weight: 700 } },
		]);
	});

	it("drops the runs when a token straddles two of them", async () => {
		const [el] = await elementsOf([
			text({
				characters: "Hi {{name}}",
				characterStyleOverrides: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
				styleOverrideTable: { "1": { fontWeight: 700 } },
			}),
		]);
		const props = el.properties as Record<string, unknown>;
		expect(props.value).toBe("Hi {{name}}");
		expect(props.spans).toBeUndefined();
	});

	it("lets a bound colour win over the runs' own", async () => {
		const [el] = await elementsOf([
			text({
				name: "color:{{brand}}",
				characters: "ab",
				characterStyleOverrides: [0, 1],
				styleOverrideTable: { "1": { fills: [solid(1, 0, 0)] } },
			}),
		]);
		const props = el.properties as Record<string, unknown>;
		expect(props.color).toBe("{{brand}}");
		expect(props.spans).toEqual([{ text: "a" }, { text: "b" }]);
	});
});
