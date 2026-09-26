import { describe, expect, it } from "bun:test";
import { scalePathData } from "../src/path-data";

describe("scalePathData", () => {
	it("returns the input untouched at 1x", () => {
		expect(scalePathData("M0 0L10 10Z", 1)).toBe("M0 0L10 10Z");
	});

	it("scales every coordinate of the line and curve commands", () => {
		expect(scalePathData("M1 2 L3 4 C5 6 7 8 9 10 Z", 2)).toBe(
			"M2 4 L6 8 C10 12 14 16 18 20 Z",
		);
	});

	it("scales H and V on their own axis", () => {
		expect(scalePathData("M0 0 H10 V20", 2, 3)).toBe("M0 0 H20 V60");
	});

	it("leaves an arc's rotation and flags alone", () => {
		expect(scalePathData("M0 0 A10 20 45 1 0 30 40", 2)).toBe(
			"M0 0 A20 40 45 1 0 60 80",
		);
	});

	it("reads flags written without separators", () => {
		expect(scalePathData("m0 0a1 1 0 01 5 5", 2)).toBe("m0 0a2 2 0 01 10 10");
		expect(scalePathData("a1 1 0 015 5", 2)).toBe("a2 2 0 01 10 10");
	});

	it("reads implicit repeats, signs and packed decimals", () => {
		expect(scalePathData("M0,0 L1-1 2.5.5", 2)).toBe("M0,0 L2-2 5 1");
	});

	it("keeps multiple subpaths", () => {
		expect(scalePathData("M0 0L1 0Z M2 2L3 2Z", 10)).toBe(
			"M0 0L10 0Z M20 20L30 20Z",
		);
	});

	it("throws on data it cannot read", () => {
		expect(() => scalePathData("M0 0 X5", 2)).toThrow();
		expect(() => scalePathData("M0 0 A1 1 0 2 0 5 5", 2)).toThrow();
	});
});
