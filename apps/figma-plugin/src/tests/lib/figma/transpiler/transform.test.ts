import { describe, expect, it } from "vitest";
import {
	applyTransform,
	decomposeTransform,
	invertRigid,
	nodeExtent,
} from "~/lib/figma/transpiler/transform";
import type { FigmaTransform } from "~/lib/figma/types";

const EXTENT = 100;

describe("decomposeTransform", () => {
	it("identity matrix → 0 rotation", () => {
		const result = decomposeTransform(
			[
				[1, 0, 0],
				[0, 1, 0],
			],
			EXTENT,
		);
		expect(result).toEqual({ ok: true, rotation: 0 });
	});

	it("90 degree rotation", () => {
		const result = decomposeTransform(
			[
				[0, -1, 0],
				[1, 0, 0],
			],
			EXTENT,
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.rotation).toBe(90);
	});

	it("45 degree rotation", () => {
		const c = Math.cos(Math.PI / 4);
		const s = Math.sin(Math.PI / 4);
		const result = decomposeTransform(
			[
				[c, -s, 0],
				[s, c, 0],
			],
			EXTENT,
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.rotation).toBeCloseTo(45, 4);
	});

	it("non-uniform scale → force flatten", () => {
		const result = decomposeTransform(
			[
				[2, 0, 0],
				[0, 1, 0],
			],
			EXTENT,
		);
		expect(result).toEqual({ ok: false, reason: "non_uniform_scale" });
	});

	it("skew → force flatten", () => {
		const result = decomposeTransform(
			[
				[1, 0.5, 0],
				[0, 1, 0],
			],
			EXTENT,
		);
		expect(result).toEqual({ ok: false, reason: "skew" });
	});

	// Figma's own matrix for a 48px icon three groups deep: a pure rotation in
	// the file, re-multiplied through its ancestors in float32 until the two
	// columns disagree by 0.015°. That is 0.012px of shear across the icon —
	// under any pixel that will ever be painted, and it used to cost the layer
	// its vector.
	const figmaFloatNoise = (): FigmaTransform => [
		[0.033359663110880025, 0.9994347375251241, 6.567742717543329],
		[-0.9994433702605207, 0.033617302633198835, 190.60072218052855],
	];

	it("accepts a rotation Figma's float noise left slightly off-orthogonal", () => {
		const result = decomposeTransform(figmaFloatNoise(), 48.2);
		expect(result.ok).toBe(true);
		// Between what each column claims on its own (−88.088° and −88.073°).
		if (result.ok) expect(result.rotation).toBeCloseTo(-88.081, 2);
	});

	it("rejects that same matrix on a node large enough for it to show", () => {
		// 0.25px of shear needs ~970px of lever arm at this skew.
		const result = decomposeTransform(figmaFloatNoise(), 3000);
		expect(result).toEqual({ ok: false, reason: "skew" });
	});
});

describe("nodeExtent", () => {
	it("takes the longest side, preferring the node's own dimensions", () => {
		expect(
			nodeExtent({
				width: 10,
				height: 40,
				absoluteBoundingBox: { width: 500, height: 500 },
			}),
		).toBe(40);
	});

	it("falls back to the bounding box, and floors at 1", () => {
		expect(nodeExtent({ absoluteBoundingBox: { width: 7, height: 3 } })).toBe(
			7,
		);
		expect(nodeExtent({ width: 0, height: 0 })).toBe(1);
	});
});

describe("invertRigid", () => {
	it("round-trips a point through a rotation + translation", () => {
		const t: FigmaTransform = [
			[0, -1, 100],
			[1, 0, 20],
		];
		const world = applyTransform(t, 7, 3);
		expect(invertRigid(t, world.x, world.y).x).toBeCloseTo(7, 9);
		expect(invertRigid(t, world.x, world.y).y).toBeCloseTo(3, 9);
	});
});

describe("applyTransform", () => {
	it("applies translation", () => {
		expect(
			applyTransform(
				[
					[1, 0, 5],
					[0, 1, 7],
				],
				2,
				3,
			),
		).toEqual({ x: 7, y: 10 });
	});
	it("applies a 90° rotation matrix to a point", () => {
		expect(
			applyTransform(
				[
					[0, -1, 0],
					[1, 0, 0],
				],
				10,
				0,
			),
		).toEqual({ x: 0, y: 10 });
	});
});
