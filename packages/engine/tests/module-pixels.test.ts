import { describe, expect, test } from "vitest";
import { modulePixels } from "../src/module-pixels";

describe("modulePixels", () => {
	test("paints set modules opaque and leaves the rest transparent", () => {
		expect([...modulePixels([true, false, 1, 0], [10, 20, 30])]).toEqual([
			10, 20, 30, 255, 0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0,
		]);
	});
});
