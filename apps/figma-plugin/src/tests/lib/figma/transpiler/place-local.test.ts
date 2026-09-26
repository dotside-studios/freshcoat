import { describe, expect, it } from "vitest";
import { placeLocal } from "~/lib/figma/transpiler/coordinates";
import type { FigmaNode } from "~/lib/figma/types";

function node(rt: number[][], w: number, h: number): FigmaNode {
	return {
		id: "1:1",
		name: "n",
		type: "RECTANGLE",
		absoluteBoundingBox: { x: 0, y: 0, width: w, height: h },
		relativeTransform: rt as never,
		width: w,
		height: h,
		fills: [],
	} as unknown as FigmaNode;
}

describe("placeLocal", () => {
	it("identity transform → pos = translation, rotation 0", () => {
		const p = placeLocal(
			node(
				[
					[1, 0, 30],
					[0, 1, 40],
				],
				100,
				20,
			),
			1,
		);
		expect(p).toEqual({
			pos: { x: 30, y: 40 },
			size: { width: 100, height: 20 },
			rotation: 0,
		});
	});
	it("scales pos and size by the author scale", () => {
		const p = placeLocal(
			node(
				[
					[1, 0, 30],
					[0, 1, 40],
				],
				100,
				20,
			),
			2,
		);
		expect(p).toEqual({
			pos: { x: 60, y: 80 },
			size: { width: 200, height: 40 },
			rotation: 0,
		});
	});
	it("90° rotation: unrotated box re-centered on its rotated center, rotation 90", () => {
		// 100×20 box, rt a=0,b=-1,c=1,d=0, local origin at parent (0,0).
		// local center (50,10) → parent (-10,50). unrotated top-left = center - (50,10) = (-60,40).
		const p = placeLocal(
			node(
				[
					[0, -1, 0],
					[1, 0, 0],
				],
				100,
				20,
			),
			1,
		);
		if ("fallback" in p) throw new Error("expected a placement, got fallback");
		expect(p.rotation).toBe(90);
		expect(p.size).toEqual({ width: 100, height: 20 });
		expect(p.pos.x).toBeCloseTo(-60, 4);
		expect(p.pos.y).toBeCloseTo(40, 4);
	});
	it("non-decomposable transform (non-uniform scale) → flatten fallback", () => {
		const p = placeLocal(
			node(
				[
					[2, 0, 0],
					[0, 1, 0],
				],
				100,
				20,
			),
			1,
		);
		expect(p).toEqual({ fallback: "flatten" });
	});
});
