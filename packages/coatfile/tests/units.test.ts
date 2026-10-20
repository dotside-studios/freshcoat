import { describe, expect, test } from "bun:test";
import {
	formatLength,
	parseLength,
	pxPerUnit,
	pxToUnit,
	resolveUnitSuffixes,
	roundForUnit,
	unitToPx,
} from "../src";

describe("length units", () => {
	test("a CR80 card at 300 dpi reads as about 85.6 × 54 mm", () => {
		expect(roundForUnit(pxToUnit(1012, "mm", 300), "mm")).toBe(85.68);
		expect(roundForUnit(pxToUnit(638, "mm", 300), "mm")).toBe(54.02);
		expect(formatLength(1012, "mm", 300)).toBe("85.68 mm");
	});

	test("converts at the template's DPI, not 72", () => {
		expect(pxPerUnit("in", 300)).toBe(300);
		expect(pxPerUnit("pt", 300)).toBeCloseTo(300 / 72, 12);
		expect(unitToPx(1, "in", 150)).toBe(150);
		expect(pxToUnit(72, "pt", 72)).toBe(72);
		expect(unitToPx(25.4, "mm", 300)).toBeCloseTo(300, 12);
	});

	test("px to unit and back keeps the px value", () => {
		for (const unit of ["px", "mm", "in", "pt"] as const)
			for (const px of [0, 1, 37.5, 1012, 1234.567])
				expect(unitToPx(pxToUnit(px, unit, 300), unit, 300)).toBeCloseTo(px, 9);
	});

	test("px stays exact", () => {
		expect(pxToUnit(1012, "px", 300)).toBe(1012);
		expect(unitToPx(40, "px", 300)).toBe(40);
	});

	test("rounds display values per unit", () => {
		expect(roundForUnit(3.14159, "mm")).toBe(3.14);
		expect(roundForUnit(0.12549, "in")).toBe(0.125);
		expect(roundForUnit(-0.0001, "px")).toBe(0);
		expect(formatLength(37.5, "in", 300, { suffix: false })).toBe("0.125");
	});

	test("parses lengths with or without a suffix", () => {
		expect(parseLength("3mm", "px", 300)).toBeCloseTo(35.433070866, 6);
		expect(parseLength("0.125in", "mm", 300)).toBe(37.5);
		expect(parseLength("12pt", "px", 300)).toBe(50);
		expect(parseLength("40px", "in", 300)).toBe(40);
		expect(parseLength("1 cm", "px", 254)).toBeCloseTo(100, 9);
		expect(parseLength("2", "in", 300)).toBe(600);
		expect(parseLength("-1.5mm", "mm", 300)).toBeCloseTo(-17.716535, 5);
		expect(parseLength("3mmm", "px", 300)).toBeNull();
		expect(parseLength("abc", "px", 300)).toBeNull();
	});

	test("rewrites suffixed numbers into the current unit", () => {
		expect(resolveUnitSuffixes("3mm", "mm", 300)).toBe("3");
		expect(Number(resolveUnitSuffixes("0.125in", "px", 300))).toBe(37.5);
		expect(Number(resolveUnitSuffixes("12pt", "in", 300))).toBeCloseTo(
			1 / 6,
			12,
		);
		expect(resolveUnitSuffixes("10 + 40PX", "px", 300)).toBe("10 + 40");
		expect(resolveUnitSuffixes("2*3", "mm", 300)).toBe("2*3");
		expect(resolveUnitSuffixes("1in/2", "in", 300)).toBe("1/2");
	});
});
