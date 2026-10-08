import type { Element, Template } from "@freshcoat-js/coatfile";
import { loadCanvasKit } from "@freshcoat-js/test-utils";
import type { CanvasKit } from "canvaskit-wasm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { hitLayer } from "~/app/controller";
import { ShapeHits } from "~/doc/hit-shape";
import { geometryOf } from "./doc-fixture";

let ck: CanvasKit;
let shapes: ShapeHits;

beforeAll(async () => {
	ck = await loadCanvasKit();
});

afterEach(() => shapes?.clear());

function scene(...elements: Element[]): Template {
	return {
		format_version: "1.1",
		id: "scene",
		name: "Scene",
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
	} as Template;
}

const under: Element = {
	id: "under",
	type: "rect",
	pos: { x: 0, y: 0 },
	size: { width: 200, height: 200 },
	properties: { fill: "#000000" },
};

function hitter(t: Template, tolerance = 0) {
	shapes = new ShapeHits(ck);
	const geometry = geometryOf(t);
	const none = new Set<string>();
	return (x: number, y: number) =>
		hitLayer(t, 0, geometry, none, none, { x, y }, { shapes, tolerance });
}

describe("hitLayer with shapes", () => {
	it("misses the hole of an even-odd vector", () => {
		const hit = hitter(
			scene(under, {
				id: "ring",
				type: "vector",
				pos: { x: 50, y: 50 },
				size: { width: 100, height: 100 },
				properties: {
					d: "M0 0H100V100H0Z M25 25H75V75H25Z",
					fillRule: "evenodd",
					fill: "#ff0000",
				},
			}),
		);
		expect(hit(60, 60)).toBe("0/1");
		expect(hit(100, 100)).toBe("0/0");
	});

	it("misses outside the curve of a circle and a rounded rect", () => {
		const hit = hitter(
			scene(
				under,
				{
					id: "dot",
					type: "vector",
					pos: { x: 0, y: 0 },
					size: { width: 100, height: 100 },
					properties: {
						d: "M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z",
						fill: "#ff0000",
					},
				},
				{
					id: "pill",
					type: "rect",
					pos: { x: 100, y: 100 },
					size: { width: 100, height: 100 },
					properties: { fill: "#00ff00", cornerRadius: 40 },
				},
			),
		);
		expect(hit(50, 50)).toBe("0/1");
		expect(hit(5, 5)).toBe("0/0");
		expect(hit(150, 150)).toBe("0/2");
		expect(hit(195, 195)).toBe("0/0");
		expect(hit(150, 101)).toBe("0/2");
	});

	it("picks the shape that paints where boxes overlap", () => {
		const triangle = (id: string, d: string): Element => ({
			id,
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			properties: { d, fill: "#0000ff" },
		});
		const hit = hitter(
			scene(
				triangle("lower", "M0 0L100 0L0 100Z"),
				triangle("upper", "M100 0L100 100L0 100Z"),
			),
		);
		expect(hit(10, 10)).toBe("0/0");
		expect(hit(90, 90)).toBe("0/1");
		expect(hit(300, 250)).toBe(null);
	});

	it("hits an unfilled vector only along its stroke, with tolerance", () => {
		const t = scene(under, {
			id: "line",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			properties: {
				d: "M0 0L100 100",
				stroke: { color: "#000000", width: 2 },
			},
		});
		expect(hitter(t)(50, 50)).toBe("0/1");
		expect(hitter(t)(50, 53)).toBe("0/0");
		expect(hitter(t, 3)(50, 53)).toBe("0/1");
	});

	it("follows inside and outside stroke alignment", () => {
		const ring = (align: "inside" | "outside"): Element => ({
			id: align,
			type: "vector",
			pos: { x: 50, y: 50 },
			size: { width: 100, height: 100 },
			properties: {
				d: "M0 0H100V100H0Z",
				stroke: { color: "#000000", width: 10, align },
			},
		});
		const inside = hitter(scene(under, ring("inside")));
		expect(inside(55, 100)).toBe("0/1");
		expect(inside(100, 100)).toBe("0/0");
		const rect = hitter(
			scene(under, {
				id: "frame",
				type: "rect",
				pos: { x: 50, y: 50 },
				size: { width: 100, height: 100 },
				properties: {
					cornerRadius: 20,
					stroke: { color: "#000000", width: 10, align: "inside" },
				},
			}),
		);
		expect(rect(55, 100)).toBe("0/1");
		expect(rect(100, 100)).toBe("0/0");
		expect(rect(51, 51)).toBe("0/0");
	});

	it("hits strokes painted outside the box", () => {
		const square = (
			align: "outside" | "center",
			rotation?: number,
		): Element => ({
			id: align,
			type: "rect",
			pos: { x: 50, y: 50 },
			size: { width: 100, height: 100 },
			rotation,
			properties: { stroke: { color: "#000000", width: 10, align } },
		});
		const outside = hitter(scene(under, square("outside")));
		expect(outside(47, 100)).toBe("0/1");
		expect(outside(100, 46)).toBe("0/1");
		expect(outside(42, 100)).toBe("0/1");
		expect(outside(39, 100)).toBe("0/0");
		const center = hitter(scene(under, square("center")));
		expect(center(47, 100)).toBe("0/1");
		expect(center(46, 100)).toBe("0/1");
		expect(center(44, 100)).toBe("0/0");
		const tolerant = hitter(scene(under, square("outside")), 3);
		expect(tolerant(38, 100)).toBe("0/1");
		expect(tolerant(36, 100)).toBe("0/0");
	});

	it("hits strokes outside a rotated box", () => {
		const hit = hitter(
			scene(under, {
				id: "tilted",
				type: "rect",
				pos: { x: 50, y: 50 },
				size: { width: 100, height: 100 },
				rotation: 45,
				properties: {
					stroke: { color: "#000000", width: 10, align: "outside" },
				},
			}),
		);
		const at = (d: number) => 100 - d * Math.SQRT1_2;
		expect(hit(at(53), at(53))).toBe("0/1");
		expect(hit(at(59), at(59))).toBe("0/1");
		expect(hit(at(62), at(62))).toBe("0/0");
	});

	it("hits thin lines within tolerance", () => {
		const line = (height: number, rotation?: number): Element => ({
			id: `line${height}`,
			type: "vector",
			pos: { x: 50, y: 100 - height / 2 },
			size: { width: 100, height },
			rotation,
			properties: {
				d: `M0 ${height / 2}H100`,
				stroke: { color: "#000000", width: 1 },
			},
		});
		for (const height of [0, 2]) {
			const hit = hitter(scene(under, line(height)), 3);
			expect(hit(100, 100)).toBe("0/1");
			expect(hit(100, 102.5)).toBe("0/1");
			expect(hit(100, 97.5)).toBe("0/1");
			expect(hit(100, 104)).toBe("0/0");
			const upright = hitter(scene(under, line(height, 90)), 3);
			expect(upright(102.5, 100)).toBe("0/1");
			expect(upright(104, 100)).toBe("0/0");
		}
	});

	it("tests a rotated shape in its own space", () => {
		const hit = hitter(
			scene(under, {
				id: "tri",
				type: "vector",
				pos: { x: 50, y: 50 },
				size: { width: 100, height: 100 },
				rotation: 180,
				properties: { d: "M0 0L100 0L0 100Z", fill: "#0000ff" },
			}),
		);
		expect(hit(140, 140)).toBe("0/1");
		expect(hit(60, 60)).toBe("0/0");
	});

	it("keeps box hits for text, images and frames", () => {
		const hit = hitter(
			scene({
				id: "f",
				type: "frame",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				properties: { children: [] },
			}),
		);
		expect(hit(99, 99)).toBe("0/0");
	});

	it("rebuilds cached paths when the element changes", () => {
		const t = scene(under, {
			id: "dot",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			properties: {
				d: "M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z",
				fill: "#ff0000",
			},
		});
		const geometry = geometryOf(t);
		const box = geometry.get("0/1");
		if (!box) throw new Error("no box");
		shapes = new ShapeHits(ck);
		const dot = t.template_data[0]?.elements[1] as Element;
		expect(shapes.hits("0/1", dot, box, { x: 5, y: 5 })).toBe(false);
		const square = {
			...dot,
			properties: { d: "M0 0H100V100H0Z", fill: "#ff0000" },
		} as Element;
		expect(shapes.hits("0/1", square, box, { x: 5, y: 5 })).toBe(true);
	});

	it("hits a trimmed stroke only where it paints", () => {
		const ring: Element = {
			id: "ring",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			properties: {
				d: "M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z",
				stroke: { color: "#000000", width: 10, trimEnd: 0.25 },
			},
		};
		const hit = hitter(scene(under, ring));
		expect(hit(85, 15)).toBe("0/1");
		expect(hit(15, 85)).toBe("0/0");
		expect(hit(85, 85)).toBe("0/0");
		expect(hit(15, 15)).toBe("0/0");
		const rect = hitter(
			scene(under, {
				id: "rect",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				properties: {
					stroke: {
						color: "#000000",
						width: 10,
						align: "inside",
						trimEnd: 0.25,
						trimOffset: 0.5,
					},
				},
			}),
		);
		expect(rect(50, 97)).toBe("0/1");
		expect(rect(50, 3)).toBe("0/0");
	});

	it("reads a field-bound trim from the preview values", () => {
		const t = scene(under, {
			id: "ring",
			type: "vector",
			pos: { x: 0, y: 0 },
			size: { width: 100, height: 100 },
			properties: {
				d: "M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z",
				stroke: { color: "#000000", width: 10, trimEnd: "{{progress}}" },
			},
		});
		shapes = new ShapeHits(ck);
		const geometry = geometryOf(t);
		const none = new Set<string>();
		const hit = (progress: string) =>
			hitLayer(
				t,
				0,
				geometry,
				none,
				none,
				{ x: 15, y: 85 },
				{
					shapes,
					values: { progress },
				},
			);
		expect(hit("0.25")).toBe("0/0");
		expect(hit("75%")).toBe("0/1");
		expect(hit("")).toBe("0/1");
	});
});
