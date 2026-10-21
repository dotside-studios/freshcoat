import { describe, expect, test } from "bun:test";
import { outlineGeometry, outlineSvg, rectShape } from "../src/outline";
import { normalizePath, pathBounds } from "../src/svg/path";

const svg = (
	cornerRadius: Parameters<typeof rectShape>[0],
	smoothing: number | undefined,
	w = 40,
	h = 30,
) =>
	outlineSvg(outlineGeometry(rectShape(cornerRadius, smoothing), 0, 0, w, h)!);

describe("outlineSvg", () => {
	test("a plain rect is its four sides", () => {
		expect(svg(undefined, undefined)).toBe("M 0 0 H 40 V 30 H 0 Z");
	});

	test("circular corners are arcs", () => {
		const d = svg(5, undefined);
		expect(d).toContain("A 5 5 0 0 1 40 5");
		expect(pathBounds(normalizePath(d))).toEqual({
			x: 0,
			y: 0,
			width: 40,
			height: 30,
		});
	});

	test("radii clamp together so neighbours do not overlap", () => {
		expect(svg(999, undefined)).toContain("A 15 15 0 0 1");
	});

	test("per-corner radii keep their corners", () => {
		const d = svg([10, 0, 0, 0], undefined);
		expect(d.startsWith("M 10 0")).toBe(true);
		expect(d.match(/A/g)).toHaveLength(1);
	});

	test("smoothed corners are the squircle path", () => {
		const d = svg(8, 0.6);
		const b = pathBounds(normalizePath(d));
		expect(b?.width).toBeCloseTo(40);
		expect(b?.height).toBeCloseTo(30);
		expect(d).not.toBe(svg(8, undefined));
	});
});
