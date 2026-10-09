import { describe, expect, test } from "vitest";
import { compileScene } from "../src/compile-scene";
import { createEllipse } from "../src/node";
import { ellipsePath, isEllipsePath } from "../src/outline";

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

	test("matches the path an ellipse node draws", () => {
		const size = { width: 80, height: 40 };
		const commands = compileScene(createEllipse({ pos: { x: 0, y: 0 }, size }), size);
		const draw = commands.find((c) => c.op === "drawPath");
		expect(draw && isEllipsePath(draw.d, 80, 40)).toBe(true);
	});
});
