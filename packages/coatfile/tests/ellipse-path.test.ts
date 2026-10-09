import { describe, expect, test } from "vitest";
import { ellipsePath, isEllipsePath } from "../src/ellipse-path";

describe("ellipsePath", () => {
	test("is two arcs spanning the box", () => {
		expect(ellipsePath(200, 100)).toBe(
			"M0 50A100 50 0 1 0 200 50A100 50 0 1 0 0 50Z",
		);
		expect(ellipsePath(1 / 3, 1)).toBe(
			"M0 0.5A0.167 0.5 0 1 0 0.333 0.5A0.167 0.5 0 1 0 0 0.5Z",
		);
	});

	test("is detected by isEllipsePath at its own size only", () => {
		expect(isEllipsePath(ellipsePath(80, 40), 80, 40)).toBe(true);
		expect(isEllipsePath(ellipsePath(80, 40), 81, 40)).toBe(false);
		expect(
			isEllipsePath("M 0,20 A 40,20 0 1 0 80,20 A 40 20 0 1 0 0 20 z", 80, 40),
		).toBe(true);
	});
});
