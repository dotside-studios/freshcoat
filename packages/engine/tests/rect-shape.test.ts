import { describe, expect, test } from "vitest";
import { outlineGeometry, outlineIsPath, rectShape } from "../src/outline";
import { squircleSvg } from "../src/squircle";

describe("rectShape", () => {
	test("keeps smoothing on per-corner radii", () => {
		const shape = rectShape([8, 0, 16, 4], 0.6);
		expect(shape).toEqual({
			kind: "rounded-rect",
			radius: [8, 0, 16, 4],
			smoothing: 0.6,
		});
		expect(outlineIsPath(shape)).toBe(true);
	});

	test("per-corner radii without smoothing stay an RRect", () => {
		const shape = rectShape([8, 0, 16, 4], undefined);
		expect(outlineIsPath(shape)).toBe(false);
		expect(outlineGeometry(shape, 0, 0, 100, 50)?.kind).toBe("rrect");
	});

	test("draws the per-corner squircle, inset corner by corner", () => {
		const shape = rectShape([8, 0, 16, 4], 0.6);
		expect(outlineGeometry(shape, 10, 20, 100, 50)).toEqual({
			kind: "path",
			d: squircleSvg(10, 20, 100, 50, [8, 0, 16, 4], 0.6),
		});
		expect(outlineGeometry(shape, 10, 20, 100, 50, 6)).toEqual({
			kind: "path",
			d: squircleSvg(16, 26, 88, 38, [2, 0, 10, 0], 0.6),
		});
	});
});
