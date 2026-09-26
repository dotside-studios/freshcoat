import { describe, expect, it } from "vitest";
import { classify } from "~/lib/figma/transpiler/classify";
import { transpileVector } from "~/lib/figma/transpiler/vector";
import type { FigmaVectorNode } from "~/lib/figma/types";
import { readVectorNode } from "~/main/read-scene-graph";

const FRAME = { x: 0, y: 0, width: 1000, height: 600 };

const baseVector = (
	overrides: Partial<FigmaVectorNode> = {},
): FigmaVectorNode => ({
	id: "1:5",
	name: "icon",
	type: "VECTOR",
	visible: true,
	opacity: 1,
	blendMode: "NORMAL",
	absoluteBoundingBox: { x: 10, y: 20, width: 30, height: 30 },
	relativeTransform: [
		[1, 0, 10],
		[0, 1, 20],
	],
	fillGeometry: [{ path: "M0,0 L10,10 Z" }],
	fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
	...overrides,
});

describe("transpileVector", () => {
	it("emits a vector element with d preserved at scale=1", () => {
		const el = transpileVector(baseVector(), { frame: FRAME, scale: 1 });
		expect(el).toMatchObject({
			type: "vector",
			pos: { x: 10, y: 20 },
			size: { width: 30, height: 30 },
			properties: { d: "M0,0 L10,10 Z", fill: "#000000" },
		});
	});

	it("carries effective rotation, re-centering the unrotated box", () => {
		const el = transpileVector(
			baseVector({
				absoluteBoundingBox: { x: 100, y: 100, width: 30, height: 60 },
				width: 60,
				height: 30,
				relativeTransform: [
					[0, 1, 100],
					[-1, 0, 160],
				],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.size).toEqual({ width: 60, height: 30 });
		// center (115, 130): pos = (115-30, 130-15) = (85, 115)
		expect(el.pos).toEqual({ x: 85, y: 115 });
		expect(el.rotation).toBe(-90);
	});

	it("scales path coordinates by ratio", () => {
		const el = transpileVector(baseVector(), { frame: FRAME, scale: 2 });
		expect(el.properties.d).toBe("M0,0 L20,20 Z");
		expect(el.size).toEqual({ width: 60, height: 60 });
	});

	it("emits a fills array when multiple visible fills", () => {
		const el = transpileVector(
			baseVector({
				fills: [
					{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
					{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } },
				],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.fill).toEqual(["#ff0000", "#00ff00"]);
	});

	it("emits stroke when present", () => {
		const el = transpileVector(
			baseVector({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#000000", width: 2 });
	});

	it("maps ROUND stroke cap/join to round", () => {
		const el = transpileVector(
			baseVector({
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
		const el = transpileVector(
			baseVector({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
				strokeCap: "NONE",
				strokeJoin: "MITER",
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#000000", width: 2 });
	});

	it("carries OUTSIDE stroke alignment", () => {
		const el = transpileVector(
			baseVector({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 4,
				strokeAlign: "OUTSIDE",
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({
			color: "#000000",
			width: 4,
			align: "outside",
		});
	});

	it("falls back gracefully when strokeCap is figma.mixed", () => {
		const el = transpileVector(
			baseVector({
				strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
				strokeWeight: 2,
				// figma.mixed reads as undefined post-serialization
				strokeCap: undefined,
				strokeJoin: undefined,
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect(el.properties.stroke).toEqual({ color: "#000000", width: 2 });
	});
});

describe("transpileVector (shapes without an authored path)", () => {
	it("emits an ELLIPSE natively from its fill outline", () => {
		// Read through readVectorNode, which is where an ellipse's geometry comes
		// from: it has no `vectorPaths`, only `fillGeometry`. Reading the wrong
		// one left it geometry-less, classify sent it down the flatten path, and
		// the circle in a logo shipped as a bitmap.
		const ellipse = readVectorNode({
			id: "5:1",
			name: "O",
			type: "ELLIPSE",
			visible: true,
			opacity: 1,
			blendMode: "NORMAL",
			absoluteBoundingBox: { x: 100, y: 50, width: 25, height: 26 },
			relativeTransform: [
				[1, 0, 100],
				[0, 1, 50],
			],
			width: 25,
			height: 26,
			effects: [],
			strokes: [],
			fills: [
				{
					type: "SOLID",
					color: { r: 0.658, g: 0.851, b: 0.082 },
					opacity: 1,
					visible: true,
				},
			],
			fillGeometry: [
				{ windingRule: "NONZERO", data: "M12.5 0 C19 0 25 6 25 13 Z" },
			],
		} as never);

		expect(classify(ellipse)).toEqual({ kind: "native-vector" });

		const el = transpileVector(ellipse, {
			frame: { x: 0, y: 0, width: 842, height: 595 },
			scale: 1,
		});
		expect(el.type).toBe("vector");
		expect(el.properties.d).toBe("M12.5 0 C19 0 25 6 25 13 Z");
		expect(el.properties.fill).toBe("#a8d915");
		expect(el.pos).toEqual({ x: 100, y: 50 });
		expect(el.size).toEqual({ width: 25, height: 26 });
	});
});

describe("transpileVector (several regions)", () => {
	it("joins every region into one d and keeps an even-odd hole", () => {
		const el = transpileVector(
			baseVector({
				fillGeometry: [
					{ path: "M0 0 H10 V10 H0 Z", windingRule: "EVENODD" },
					{ path: "M2 2 A3 3 0 0 1 8 8 Z", windingRule: "EVENODD" },
				],
			}),
			{ frame: FRAME, scale: 2 },
		);
		expect(el.properties.d).toBe("M0 0 H20 V20 H0 Z M4 4 A6 6 0 0 1 16 16 Z");
		expect(el.properties.fillRule).toBe("evenodd");
	});

	it("emits no fillRule for nonzero regions", () => {
		const el = transpileVector(
			baseVector({
				fillGeometry: [{ path: "M0 0 H10 V10 Z", windingRule: "NONZERO" }],
			}),
			{ frame: FRAME, scale: 1 },
		);
		expect("fillRule" in el.properties).toBe(false);
	});
});
