import { describe, expect, test } from "vitest";
import { mixColor } from "../src/color";

describe("mixColor", () => {
	test("blends every channel, alpha included", () => {
		expect(mixColor([0, 0, 0, 0], [255, 100, 50, 1], 0.5)).toEqual([
			127.5, 50, 25, 0.5,
		]);
	});

	test("is either end at 0 and 1", () => {
		expect(mixColor([10, 20, 30, 1], [40, 50, 60, 0], 0)).toEqual([10, 20, 30, 1]);
		expect(mixColor([10, 20, 30, 1], [40, 50, 60, 0], 1)).toEqual([40, 50, 60, 0]);
	});
});
