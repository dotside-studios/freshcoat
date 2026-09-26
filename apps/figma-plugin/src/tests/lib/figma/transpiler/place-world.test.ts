import { describe, expect, it } from "vitest";
import { placeWorld } from "~/lib/figma/transpiler/coordinates";
import type { FigmaNode } from "~/lib/figma/types";

function node(
	at: number[][] | undefined,
	w: number,
	h: number,
	abb = { x: 0, y: 0, width: w, height: h },
): FigmaNode {
	return {
		id: "1:1",
		name: "n",
		type: "RECTANGLE",
		absoluteBoundingBox: abb,
		absoluteTransform: at as never,
		width: w,
		height: h,
		fills: [],
	} as unknown as FigmaNode;
}

describe("placeWorld", () => {
	it("identity transform → world AABB re-anchored to the anchor origin, rotation 0", () => {
		// world top-left at (130,140); anchor at (100,100) → re-anchored (30,40).
		const p = placeWorld(
			node(
				[
					[1, 0, 130],
					[0, 1, 140],
				],
				100,
				20,
				{ x: 130, y: 140, width: 100, height: 20 },
			),
			{ x: 100, y: 100 },
			1,
		);
		expect(p).toEqual({
			pos: { x: 30, y: 40 },
			size: { width: 100, height: 20 },
			rotation: 0,
		});
	});

	it("no absoluteTransform → falls back to world AABB re-anchored, rotation 0", () => {
		const p = placeWorld(
			node(undefined, 100, 20, { x: 130, y: 140, width: 100, height: 20 }),
			{ x: 100, y: 100 },
			1,
		);
		expect(p).toEqual({
			pos: { x: 30, y: 40 },
			size: { width: 100, height: 20 },
			rotation: 0,
		});
	});

	it("scales pos and size by the author scale", () => {
		const p = placeWorld(
			node(
				[
					[1, 0, 130],
					[0, 1, 140],
				],
				100,
				20,
				{ x: 130, y: 140, width: 100, height: 20 },
			),
			{ x: 100, y: 100 },
			2,
		);
		expect(p).toEqual({
			pos: { x: 60, y: 80 },
			size: { width: 200, height: 40 },
			rotation: 0,
		});
	});

	it("90° absoluteTransform: unrotated box re-centered on its world center, rotation 90", () => {
		// 100×20 box, at a=0,b=-1,c=1,d=0, world origin shifted so the center sits
		// at world (250,160). anchor (100,100). local center (50,10) → world
		// (250,160) given translation (260, 110): a*50+b*10+tx = 0*50 + -1*10 + 260
		// = 250; c*50+d*10+ty = 1*50 + 0*10 + 110 = 160.
		// re-anchored center = (250-100, 160-100) = (150,60).
		// unrotated top-left = center - (w/2,h/2) = (150-50, 60-10) = (100,50).
		const p = placeWorld(
			node(
				[
					[0, -1, 260],
					[1, 0, 110],
				],
				100,
				20,
				{ x: 0, y: 0, width: 20, height: 100 },
			),
			{ x: 100, y: 100 },
			1,
		);
		if ("fallback" in p) throw new Error("expected a placement, got fallback");
		expect(p.rotation).toBe(90);
		expect(p.size).toEqual({ width: 100, height: 20 });
		expect(p.pos.x).toBeCloseTo(100, 4);
		expect(p.pos.y).toBeCloseTo(50, 4);
	});

	it("non-decomposable transform (non-uniform scale) → flatten fallback", () => {
		const p = placeWorld(
			node(
				[
					[2, 0, 0],
					[0, 1, 0],
				],
				100,
				20,
			),
			{ x: 0, y: 0 },
			1,
		);
		expect(p).toEqual({ fallback: "flatten" });
	});
});
