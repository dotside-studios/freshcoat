import { describe, expect, it } from "vitest";
import { classify } from "~/lib/figma/transpiler/classify";
import { transpileFrame } from "~/lib/figma/transpiler/frame";
import type { FigmaContainerNode } from "~/lib/figma/types";

const OUTER_FRAME = { x: 0, y: 0, width: 1000, height: 600 };

const baseFrame = (
	overrides: Partial<FigmaContainerNode> = {},
): FigmaContainerNode => ({
	id: "1:9",
	name: "card-frame",
	type: "FRAME",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 50, y: 100, width: 200, height: 150 },
	relativeTransform: [
		[1, 0, 50],
		[0, 1, 100],
	],
	width: 200,
	height: 150,
	children: [],
	...overrides,
});

describe("transpileFrame", () => {
	it("emits frame element with pos in localFrame coords", () => {
		const el = transpileFrame(baseFrame(), {
			outerFrame: OUTER_FRAME,
			scale: 1,
		});
		expect(el).toMatchObject({
			type: "frame",
			pos: { x: 50, y: 100 },
			size: { width: 200, height: 150 },
			properties: { children: [] },
		});
	});

	it("solid fill emits as a hex string", () => {
		const el = transpileFrame(
			baseFrame({
				fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
			}),
			{ outerFrame: OUTER_FRAME, scale: 1 },
		);
		expect(el.properties.fill).toBe("#ff0000");
	});

	it("multiple fills emit as an array", () => {
		const el = transpileFrame(
			baseFrame({
				fills: [
					{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
					{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } },
				],
			}),
			{ outerFrame: OUTER_FRAME, scale: 1 },
		);
		expect(el.properties.fill).toEqual(["#ff0000", "#00ff00"]);
	});

	it("clipsContent: true → clipsContent: true in properties", () => {
		const el = transpileFrame(baseFrame({ clipsContent: true }), {
			outerFrame: OUTER_FRAME,
			scale: 1,
		});
		expect(el.properties.clipsContent).toBe(true);
	});

	it("clipsContent absent → no clipsContent in properties", () => {
		const el = transpileFrame(baseFrame(), {
			outerFrame: OUTER_FRAME,
			scale: 1,
		});
		expect("clipsContent" in el.properties).toBe(false);
	});

	const rotatedStack = {
		id: "1:1",
		name: "stack",
		type: "FRAME",
		absoluteBoundingBox: { x: 0, y: 0, width: 81, height: 520 },
		relativeTransform: [
			[0, -1, 0],
			[1, 0, 0],
		],
		width: 520,
		height: 81,
		layoutMode: "VERTICAL",
		fills: [],
		strokes: [],
		children: [],
	};
	const uprightStack = {
		...rotatedStack,
		relativeTransform: [
			[1, 0, 0],
			[0, 1, 0],
		],
		absoluteBoundingBox: { x: 0, y: 0, width: 520, height: 81 },
	};
	const outer = { x: 0, y: 0, width: 1108, height: 696 };

	it("a rotated auto-layout frame carries rotation, unrotated size and live layout", () => {
		const out = transpileFrame(rotatedStack as never, {
			outerFrame: outer,
			scale: 1,
		});
		expect(out.rotation).toBe(90);
		expect(out.size).toEqual({ width: 520, height: 81 });
		expect(out.properties.layout).toEqual({ direction: "column" });
	});

	it("an unrotated auto-layout frame keeps its live layout block", () => {
		const out = transpileFrame(uprightStack as never, {
			outerFrame: outer,
			scale: 1,
		});
		expect(out.properties.layout).toBeDefined();
	});

	it("scales pos + size + cornerRadius + stroke width by ratio", () => {
		const el = transpileFrame(
			baseFrame({
				cornerRadius: 8,
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
			}),
			{ outerFrame: OUTER_FRAME, scale: 2 },
		);
		expect(el.pos).toEqual({ x: 100, y: 200 });
		expect(el.size).toEqual({ width: 400, height: 300 });
		expect(el.properties.cornerRadius).toBe(16);
		expect(el.properties.stroke).toEqual({ color: "#000000", width: 4 });
	});

	it("carries per-corner radii, scaled", () => {
		const el = transpileFrame(baseFrame({ cornerRadius: [8, 0, 4, 0] }), {
			outerFrame: OUTER_FRAME,
			scale: 2,
		});
		expect(el.properties.cornerRadius).toEqual([16, 0, 8, 0]);
	});

	it("carries an OUTSIDE frame stroke", () => {
		const el = transpileFrame(
			baseFrame({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
				strokeAlign: "OUTSIDE",
				clipsContent: true,
			}),
			{ outerFrame: OUTER_FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({
			color: "#000000",
			width: 2,
			align: "outside",
		});
	});

	it("carries the frame border's stroke alignment", () => {
		const el = transpileFrame(
			baseFrame({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 4,
				strokeAlign: "INSIDE",
			}),
			{ outerFrame: OUTER_FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({
			color: "#000000",
			width: 4,
			align: "inside",
		});
	});
});

describe("transpileFrame strokes", () => {
	const black = { r: 0, g: 0, b: 0, a: 1 };

	it("keeps stroke opacity and a scaled dash pattern", () => {
		const el = transpileFrame(
			baseFrame({
				strokes: [{ type: "SOLID", color: black, opacity: 0.25 }],
				strokeWeight: 1,
				strokeAlign: "INSIDE",
				dashPattern: [2, 2],
			}),
			{ outerFrame: OUTER_FRAME, scale: 2 },
		);
		expect(el.properties.stroke).toEqual({
			color: "#00000040",
			width: 2,
			dash: [4, 4],
			align: "inside",
		});
	});

	it("ignores a hidden stroke", () => {
		const el = transpileFrame(
			baseFrame({
				strokes: [{ type: "SOLID", color: black, visible: false }],
				strokeWeight: 1,
			}),
			{ outerFrame: OUTER_FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toBeUndefined();
	});

	it("rasterizes a frame with a gradient stroke", () => {
		const node = baseFrame({
			strokes: [
				{
					type: "GRADIENT_RADIAL",
					gradientHandlePositions: [
						{ x: 0.5, y: 0.5 },
						{ x: 1, y: 0.5 },
						{ x: 0.5, y: 1 },
					],
					gradientStops: [
						{ position: 0, color: black },
						{ position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
					],
				},
			],
			strokeWeight: 1,
		});
		expect(classify(node)).toEqual({
			kind: "flatten",
			reason: "stroke_flattened",
		});
		expect(() =>
			transpileFrame(node, { outerFrame: OUTER_FRAME, scale: 1 }),
		).not.toThrow();
	});
});
