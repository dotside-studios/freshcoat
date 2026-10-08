import { describe, expect, test } from "vitest";
import {
	decorationLine,
	fitRect,
	insetCorner,
	skipInkSegments,
	strokeInset,
} from "../src";

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
	test("decorationLine uses font metrics as stroke centres", () => {
		const m = {
			underlinePosition: 10,
			underlineThickness: 5,
			strikeoutPosition: -31.8,
			strikeoutThickness: 4,
		};
		const u = decorationLine(100, "underline", 200, m);
		expect(u.thickness).toBe(5);
		expect(u.top + u.thickness / 2).toBeCloseTo(210);
		const s = decorationLine(100, "line-through", 200, m);
		expect(s.thickness).toBe(4);
		expect(s.top + s.thickness / 2).toBeCloseTo(168.2);
	});
	test("decorationLine falls back per field when metrics are missing or zero", () => {
		const plain = decorationLine(100, "line-through", 200);
		expect(plain.thickness).toBeCloseTo(6);
		expect(plain.top + plain.thickness / 2).toBeCloseTo(172);
		expect(decorationLine(100, "line-through", 200, {})).toEqual(plain);
		expect(
			decorationLine(100, "line-through", 200, {
				strikeoutPosition: 0,
				strikeoutThickness: 0,
			}),
		).toEqual(plain);
		const mixed = decorationLine(100, "underline", 200, {
			underlinePosition: Number.NaN,
			underlineThickness: 3,
		});
		expect(mixed.thickness).toBe(3);
		expect(mixed.top + mixed.thickness / 2).toBeCloseTo(210);
	});
	test("skipInkSegments cuts padded gaps out of the line", () => {
		expect(skipInkSegments(0, 100, [], 2)).toEqual([[0, 100]]);
		expect(skipInkSegments(0, 100, [40, 50, 10, 20], 2)).toEqual([
			[0, 8],
			[22, 38],
			[52, 100],
		]);
		expect(
			skipInkSegments(0, 100, [-10, 5, 30, 40, 38, 45, 95, 120], 1),
		).toEqual([
			[6, 29],
			[46, 94],
		]);
	});
});
