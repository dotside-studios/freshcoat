// CSS→IR helpers: color string → hex, linear-gradient → ResolvedFill.
import { describe, expect, test } from "vitest";
import { oklchToHex, parseCssColor, parseLinearGradient } from "../src/css";

describe("oklchToHex / parseCssColor", () => {
	test("oklch endpoints", () => {
		expect(oklchToHex(0, 0, 0)).toBe("#000000");
		expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
	});

	test("oklch(0.684 0.186 0.3) is the accent-500 pink", () => {
		// styles.css annotates this token as #F05E94.
		expect(parseCssColor("oklch(0.684 0.186 0.3)")).toBe("#f05e94");
	});

	test("hex shorthand expands", () => {
		expect(parseCssColor("#abc")).toBe("#aabbcc");
		expect(parseCssColor("#F05E94")).toBe("#f05e94");
	});

	test("rgb() and named", () => {
		expect(parseCssColor("rgb(240, 94, 148)")).toBe("#f05e94");
		expect(parseCssColor("white")).toBe("#ffffff");
		expect(parseCssColor("black")).toBe("#000000");
	});

	test("unparseable → fallback", () => {
		expect(parseCssColor("var(--x)", "#123456")).toBe("#123456");
		expect(parseCssColor("")).toBe("#000000");
	});
});

describe("parseLinearGradient", () => {
	test("angle + hex stops → linear fill (180deg = top→bottom)", () => {
		const fill = parseLinearGradient(
			"linear-gradient(180deg, #000 0%, #fff 100%)",
		);
		if (fill?.kind !== "linear") throw new Error("expected linear");
		expect(fill.stops).toEqual([
			{ offset: 0, color: "#000000" },
			{ offset: 1, color: "#ffffff" },
		]);
		expect(fill.from.x).toBeCloseTo(0.5);
		expect(fill.from.y).toBeCloseTo(0);
		expect(fill.to.x).toBeCloseTo(0.5);
		expect(fill.to.y).toBeCloseTo(1);
	});

	test("90deg = left→right; stops default to even spacing", () => {
		const fill = parseLinearGradient(
			"linear-gradient(90deg, #000, #f00, #fff)",
		);
		expect(fill?.kind).toBe("linear");
		if (fill?.kind !== "linear") throw new Error("unreachable");
		expect(fill.from.x).toBeCloseTo(0);
		expect(fill.to.x).toBeCloseTo(1);
		expect(fill.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
	});

	test("resolver hook handles non-CSS tokens", () => {
		const fill = parseLinearGradient(
			"linear-gradient(180deg, var(--brand) 0%, #fff 100%)",
			(c) => (c === "var(--brand)" ? "#abcdef" : parseCssColor(c)),
		);
		expect(fill?.stops[0].color).toBe("#abcdef");
	});

	test("non-linear-gradient → null", () => {
		expect(parseLinearGradient("radial-gradient(#000, #fff)")).toBeNull();
		expect(parseLinearGradient("#000000")).toBeNull();
	});
});
