import { describe, expect, it } from "vitest";
import { transpileRect } from "~/lib/figma/transpiler/rect";
import type { FigmaRectangleNode } from "~/lib/figma/types";

const FRAME = { x: 0, y: 0, width: 1000, height: 600 };

const baseRect = (
	overrides: Partial<FigmaRectangleNode> = {},
): FigmaRectangleNode => ({
	id: "1:3",
	name: "card",
	type: "RECTANGLE",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
	fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
	...overrides,
});

describe("transpileRect", () => {
	it("maps a solid-fill rectangle", () => {
		const el = transpileRect(baseRect(), { frame: FRAME, scale: 1 });
		expect(el).toEqual({
			id: "card",
			type: "rect",
			pos: { x: 0, y: 0 },
			size: { width: 200, height: 100 },
			properties: { fill: "#ff0000" },
		});
	});

	it("carries effective rotation, re-centering the unrotated box", () => {
		// AABB is the rotated box (60×120); unrotated layout is 120×60.
		const el = transpileRect(
			baseRect({
				absoluteBoundingBox: { x: 100, y: 100, width: 60, height: 120 },
				width: 120,
				height: 60,
				relativeTransform: [
					[0, 1, 100],
					[-1, 0, 220],
				],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.size).toEqual({ width: 120, height: 60 });
		// center (130, 160): pos = (130-60, 160-30) = (70, 130)
		expect(el.pos).toEqual({ x: 70, y: 130 });
		expect(el.rotation).toBe(-90);
	});

	it("omits rotation for an unrotated rectangle", () => {
		const el = transpileRect(baseRect(), { frame: FRAME, scale: 1 });
		expect("rotation" in el).toBe(false);
	});

	it("hoists translucent solid alpha to opacity", () => {
		const el = transpileRect(
			baseRect({
				fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 0.5 } }],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.fill).toBe("#ff0000");
		expect(el.opacity).toBe(0.5);
	});

	it("includes cornerRadius when present", () => {
		const el = transpileRect(baseRect({ cornerRadius: 12 }), {
			frame: FRAME,
			scale: 1,
		});
		expect(el.properties.cornerRadius).toBe(12);
	});

	it("scales cornerRadius with the frame", () => {
		const el = transpileRect(baseRect({ cornerRadius: 10 }), {
			frame: FRAME,
			scale: 2,
		});
		expect(el.properties.cornerRadius).toBe(20);
	});

	it("maps a linear gradient", () => {
		const el = transpileRect(
			baseRect({
				fills: [
					{
						type: "GRADIENT_LINEAR",
						gradientHandlePositions: [
							{ x: 0, y: 0.5 },
							{ x: 1, y: 0.5 },
							{ x: 0, y: 1 },
						],
						gradientStops: [
							{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
							{ position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
						],
					},
				],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.fill).toEqual({
			kind: "linear",
			angle: 0,
			from: [0, 0.5],
			to: [1, 0.5],
			stops: [
				{ offset: 0, color: "#ff0000" },
				{ offset: 1, color: "#0000ff" },
			],
		});
	});

	it("emits stroke when present", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#000000", width: 2 });
	});

	it("omits a stroke whose scaled width rounds to zero", () => {
		for (const [strokeWeight, scale] of [
			[0, 1],
			[0.2, 1],
			[1, 0.2],
		]) {
			const el = transpileRect(
				baseRect({
					strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
					strokeWeight,
				}),
				{ frame: FRAME, scale },
			);
			expect(el.properties.stroke).toBeUndefined();
		}
	});

	it("maps ROUND stroke cap/join to round", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
				strokeCap: "ROUND",
				strokeJoin: "ROUND",
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({
			color: "#000000",
			width: 2,
			cap: "round",
			join: "round",
		});
	});

	it("omits cap/join for default (NONE/MITER) strokes", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
				strokeCap: "NONE",
				strokeJoin: "MITER",
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#000000", width: 2 });
	});

	// Figma's default for a closed shape, and the case that moves paint: an
	// INSIDE stroke drawn centred hangs half its weight outside the box.
	it("carries INSIDE stroke alignment", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 4,
				strokeAlign: "INSIDE",
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({
			color: "#000000",
			width: 4,
			align: "inside",
		});
	});

	it("omits alignment for a CENTER stroke (the painter's own default)", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 4,
				strokeAlign: "CENTER",
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#000000", width: 4 });
	});

	it("places a rotated rect from relativeTransform", () => {
		const el = transpileRect(
			{
				id: "1:1",
				name: "r",
				type: "RECTANGLE",
				absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 100 },
				relativeTransform: [
					[0, -1, 0],
					[1, 0, 0],
				],
				width: 100,
				height: 20,
				fills: [
					{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: true },
				],
			} as never,
			{ frame: { x: 0, y: 0, width: 1000, height: 1000 }, scale: 1 },
		);
		expect(el.rotation).toBe(90);
		expect(el.size).toEqual({ width: 100, height: 20 });
	});

	it("emits an array of fills when there are multiple visible fills", () => {
		const el = transpileRect(
			baseRect({
				fills: [
					{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
					{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } },
				],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.fill).toEqual(["#ff0000", "#00ff00"]);
	});
});

describe("transpileRect strokes and corners", () => {
	const black = { r: 0, g: 0, b: 0, a: 1 };
	const gradient = {
		type: "GRADIENT_LINEAR" as const,
		gradientHandlePositions: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
		],
		gradientStops: [
			{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
			{ position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
		],
	};

	it("keeps a translucent stroke's opacity as 8-digit hex", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: black, opacity: 0.5 }],
				strokeWeight: 2,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#00000080", width: 2 });
	});

	it("draws no stroke when every stroke paint is hidden", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: black, visible: false }],
				strokeWeight: 2,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toBeUndefined();
	});

	it("skips a hidden stroke paint for the visible one", () => {
		const el = transpileRect(
			baseRect({
				strokes: [
					{ type: "SOLID", color: black, visible: false },
					{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } },
				],
				strokeWeight: 2,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#0000ff", width: 2 });
	});

	it("maps a gradient stroke to a gradient colour", () => {
		const el = transpileRect(
			baseRect({ strokes: [gradient], strokeWeight: 2, dashPattern: [4, 2] }),
			{ frame: FRAME, scale: 2 },
		);
		expect(el.properties.stroke).toEqual({
			color: {
				kind: "linear",
				angle: 0,
				from: [0, 0],
				to: [1, 0],
				stops: [
					{ offset: 0, color: "#ff0000" },
					{ offset: 1, color: "#0000ff" },
				],
			},
			width: 4,
			dash: [8, 4],
		});
	});

	it("maps an angular gradient stroke on the rect's own box", () => {
		const el = transpileRect(
			baseRect({
				strokes: [
					{
						type: "GRADIENT_ANGULAR",
						gradientHandlePositions: [
							{ x: 0.5, y: 0.5 },
							{ x: 0.75, y: 0.5 },
							{ x: 0.5, y: 1 },
						],
						gradientStops: gradient.gradientStops,
					},
				],
				strokeWeight: 2,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke?.color).toMatchObject({
			kind: "angular",
			center: [0.5, 0.5],
		});
	});

	it("leaves out a stroke stack mixing a gradient and a solid", () => {
		const el = transpileRect(
			baseRect({
				strokes: [gradient, { type: "SOLID", color: black }],
				strokeWeight: 2,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toBeUndefined();
	});

	it("emits a scaled dash pattern", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: black }],
				strokeWeight: 2,
				dashPattern: [4, 2],
			}),
			{ frame: FRAME, scale: 2 },
		);
		expect(el.properties.stroke).toEqual({
			color: "#000000",
			width: 4,
			dash: [8, 4],
		});
	});

	it("repeats an odd dash pattern to even length", () => {
		const el = transpileRect(
			baseRect({
				strokes: [{ type: "SOLID", color: black }],
				strokeWeight: 1,
				dashPattern: [3],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke?.dash).toEqual([3, 3]);
	});

	it("emits corner smoothing with a corner radius", () => {
		const el = transpileRect(
			baseRect({ cornerRadius: 12, cornerSmoothing: 0.6 }),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.cornerRadius).toBe(12);
		expect(el.properties.cornerSmoothing).toBe(0.6);
	});

	it("omits corner smoothing without a corner radius", () => {
		const el = transpileRect(baseRect({ cornerSmoothing: 0.6 }), {
			frame: FRAME,
			scale: 1,
		});
		expect("cornerSmoothing" in el.properties).toBe(false);
	});
});
