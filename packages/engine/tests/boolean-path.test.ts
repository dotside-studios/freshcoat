import { loadCanvasKit } from "@freshcoat-js/test-utils";
import type { CanvasKit } from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import { type BooleanOperand, combineShapes } from "../src/boolean-path";

let ck: CanvasKit;
beforeAll(async () => {
	ck = (await loadCanvasKit()) as CanvasKit;
});

const square = (x: number, y: number, size = 100): BooleanOperand => ({
	kind: "rect",
	pos: { x, y },
	size: { width: size, height: size },
});

const circle = (x: number, y: number): BooleanOperand => ({
	kind: "path",
	pos: { x, y },
	size: { width: 100, height: 100 },
	d: "M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z",
});

describe("combineShapes", () => {
	const a = square(0, 0);
	const b = square(60, 0);

	test.each([
		["union", { x: 0, y: 0, width: 160, height: 100 }],
		["subtract", { x: 0, y: 0, width: 60, height: 100 }],
		["intersect", { x: 60, y: 0, width: 40, height: 100 }],
		["exclude", { x: 0, y: 0, width: 160, height: 100 }],
	] as const)("%s of two overlapping squares", (op, box) => {
		const shape = combineShapes(ck, [a, b], op);
		expect(shape?.box).toEqual(box);
		expect(shape?.d.startsWith("M")).toBe(true);
	});

	test("path data is relative to the box, or to an origin", () => {
		const moved = square(30, 40);
		expect(combineShapes(ck, [moved], "union")?.d).toBe(
			"M0 100L0 0L100 0L100 100Z",
		);
		expect(combineShapes(ck, [moved], "union", { x: 0, y: 0 })?.d).toBe(
			"M30 140L30 40L130 40L130 140Z",
		);
	});

	test("rotation turns a shape about its centre", () => {
		const shape = combineShapes(ck, [{ ...square(0, 0), rotation: 90 }], "union");
		expect(shape?.box).toEqual({ x: 0, y: 0, width: 100, height: 100 });
		const tilted = combineShapes(ck, [{ ...square(0, 0), rotation: 45 }], "union");
		expect(tilted?.box.width).toBeCloseTo(141.42, 1);
	});

	test("a rounded rect and a curve keep their curves", () => {
		const shape = combineShapes(
			ck,
			[{ ...square(0, 0), cornerRadius: 20 }, circle(50, 50)],
			"union",
		);
		expect(shape?.d).toContain("C");
	});

	test("the even-odd fill rule of the result is kept", () => {
		const ring: BooleanOperand = {
			kind: "path",
			d: "M0 0H100V100H0ZM25 25H75V75H25Z",
			fillRule: "evenodd",
			size: { width: 100, height: 100 },
		};
		expect(combineShapes(ck, [ring], "union")?.fillRule).toBe("evenodd");
		expect(combineShapes(ck, [a], "union")?.fillRule).toBeUndefined();
	});

	test("nothing left is null", () => {
		expect(combineShapes(ck, [a, square(300, 300)], "intersect")).toBeNull();
		expect(combineShapes(ck, [a, a], "subtract")).toBeNull();
		expect(combineShapes(ck, [], "union")).toBeNull();
	});

	test("path data that does not parse is null", () => {
		const bad: BooleanOperand = { kind: "path", d: "not a path" };
		expect(combineShapes(ck, [a, bad], "union")).toBeNull();
	});

	test("the same input gives the same result", () => {
		const first = combineShapes(ck, [a, circle(40, 10), b], "exclude");
		const second = combineShapes(ck, [a, circle(40, 10), b], "exclude");
		expect(first).not.toBeNull();
		expect(second).toEqual(first);
	});
});
