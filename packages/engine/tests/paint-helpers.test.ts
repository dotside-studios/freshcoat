import { describe, expect, test } from "vitest";
import { decorationLine, fitRect, insetCorner, strokeInset } from "../src";

describe("paint-helpers", () => {
	test("fitRect cover centers the crop", () => {
		const r = fitRect(200, 100, 0, 0, 100, 100, "cover");
		expect(r).toEqual({
			sx: 50,
			sy: 0,
			sw: 100,
			sh: 100,
			dx: 0,
			dy: 0,
			dw: 100,
			dh: 100,
		});
	});
	test("fitRect fill stretches", () => {
		const r = fitRect(200, 100, 5, 5, 40, 40, "fill");
		expect(r).toMatchObject({
			sx: 0,
			sy: 0,
			sw: 200,
			sh: 100,
			dx: 5,
			dy: 5,
			dw: 40,
			dh: 40,
		});
	});
	test("strokeInset aligns inside/outside/center", () => {
		expect(strokeInset({ color: "#000", width: 4, align: "inside" })).toBe(2);
		expect(strokeInset({ color: "#000", width: 4, align: "outside" })).toBe(-2);
		expect(strokeInset({ color: "#000", width: 4 })).toBe(0);
	});
	test("insetCorner shrinks radii, clamps at 0", () => {
		expect(insetCorner(10, 3)).toBe(7);
		expect(insetCorner([10, 2, 0, 5], 3)).toEqual([7, 0, 0, 2]);
		expect(insetCorner(undefined, 3)).toBe(0);
	});
	test("decorationLine underline sits below baseline", () => {
		const d = decorationLine(50, "underline", 100);
		expect(d.thickness).toBeCloseTo(3);
		expect(d.top).toBeGreaterThan(100);
	});
});
