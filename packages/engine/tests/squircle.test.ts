import { describe, expect, test } from "vitest";
import { squircleSvg } from "../src/squircle";

// How far each corner's outline runs along its edges, read from the lines
// that join the corners: [topLeft, topRight, bottomRight, bottomLeft].
function extents(d: string, w: number, h: number): number[] {
	const nums = (cmd: string) =>
		[...d.matchAll(new RegExp(`${cmd} (\\S+) (\\S+)`, "g"))].map((m) => [
			Number(m[1]),
			Number(m[2]),
		]);
	const [start] = nums("M");
	const [right, bottom, left] = nums("L");
	return [left[1], w - start[0], h - right[1], bottom[0]];
}

describe("squircleSvg", () => {
	test("radii that are all the same draw the uniform outline", () => {
		expect(squircleSvg(5, 10, 120, 80, [24, 24, 24, 24], 0.6)).toBe(
			squircleSvg(5, 10, 120, 80, 24, 0.6),
		);
	});

	test("no radius is the plain rect", () => {
		expect(squircleSvg(0, 0, 40, 20, [0, 0, 0, 0], 1)).toBe(
			"M 0.0000 0.0000 H 40.0000 V 20.0000 H 0.0000 Z",
		);
	});

	test("each corner takes its own radius", () => {
		const d = squircleSvg(0, 0, 200, 200, [10, 0, 30, 20], 0.5);
		expect(extents(d, 200, 200)).toEqual([15, 0, 45, 30]);
		expect(d).toContain("L 200.0000 155.0000");
		expect(d.match(/ a /g)).toHaveLength(3);
	});

	test("a square corner keeps its point", () => {
		const d = squircleSvg(0, 0, 100, 100, [0, 20, 0, 0], 1);
		expect(d.startsWith("M 60.0000 0.0000")).toBe(true);
		expect(d).toContain("L 100.0000 100.0000");
		expect(d).toContain("L 0.0000 100.0000");
		expect(d).toContain("L 0.0000 0.0000");
	});

	test("corners on a short edge share it, smoothing included", () => {
		const d = squircleSvg(0, 0, 100, 40, [0, 30, 30, 0], 1);
		const [, tr, br] = extents(d, 100, 40);
		expect(tr).toBe(20);
		expect(br).toBe(20);
		const lone = squircleSvg(0, 0, 100, 40, [0, 10, 0, 0], 1);
		expect(extents(lone, 100, 40)[1]).toBe(20);
	});

	test("a corner takes what a larger one leaves of their edge", () => {
		const d = squircleSvg(0, 0, 100, 40, [60, 0, 0, 30], 0);
		const [tl, , , bl] = extents(d, 100, 40);
		expect(tl).toBeCloseTo(40 * (60 / 90), 3);
		expect(bl).toBeCloseTo(40 - tl, 3);
	});

	test("a lone corner may run past half the shorter side", () => {
		const d = squircleSvg(0, 0, 100, 100, [80, 0, 0, 0], 0);
		expect(extents(d, 100, 100)[0]).toBe(80);
	});
});
