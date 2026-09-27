import { linearGradientAngle } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import {
	boxToWorld,
	dragHandle,
	frameOf,
	type GradientFrame,
	gradientHandles,
	type HandlePart,
	parseGradientHandle,
	stopOffsetAt,
	worldToBox,
	worldToLocal,
} from "../canvas/gradient-geometry";
import { type Point, type Rect, worldCorners } from "../doc/geometry";
import type { Gradient } from "../panels/design/fills";
import { doc, geometryOf } from "./doc-fixture";

const rect = (
	x: number,
	y: number,
	width: number,
	height: number,
	rotation = 0,
): Rect => ({ x, y, width, height, rotation });

const FRAMES: Record<string, GradientFrame> = {
	plain: { rect: rect(100, 50, 300, 200), ancestors: [] },
	rotated: { rect: rect(100, 50, 300, 200, 30), ancestors: [] },
	nested: {
		rect: rect(220, 140, 160, 90, 20),
		ancestors: [rect(200, 100, 300, 200, 15), rect(150, 60, 500, 400, -40)],
	},
	tall: {
		rect: rect(0, 0, 80, 240, -65),
		ancestors: [rect(-50, -20, 300, 300, 10)],
	},
};

const RING = 30;

const GRADIENTS: Gradient[] = [
	{
		kind: "linear",
		angle: 45,
		from: [0.1, 0.2],
		to: [0.8, 0.9],
		stops: [
			{ offset: 0, color: "#000000" },
			{ offset: 0.3, color: "#ff0000" },
			{ offset: 1, color: "#ffffff" },
		],
	},
	{
		kind: "radial",
		center: [0.4, 0.6],
		radius: 0.35,
		radiusY: 0.2,
		rotation: 25,
		stops: [
			{ offset: 0, color: "#000000" },
			{ offset: 0.6, color: "#ff0000" },
			{ offset: 1, color: "#ffffff" },
		],
	},
	{
		kind: "angular",
		center: [0.3, 0.7],
		rotation: 40,
		stops: [
			{ offset: 0, color: "#000000" },
			{ offset: 0.25, color: "#ff0000" },
			{ offset: 0.8, color: "#ffffff" },
		],
	},
];

const PARTS: Record<Gradient["kind"], HandlePart[]> = {
	linear: ["from", "to"],
	radial: ["center", "radius", "radiusY"],
	angular: ["center", "rotation"],
};

function expectPoint(a: Point | undefined, b: Point, digits = 6) {
	expect(a).toBeDefined();
	expect(a?.x).toBeCloseTo(b.x, digits);
	expect(a?.y).toBeCloseTo(b.y, digits);
}

/** Numeric fields that place the gradient, with defaults filled in. */
function placement(g: Gradient): number[] {
	if (g.kind === "linear") return [...(g.from ?? []), ...(g.to ?? []), g.angle];
	if (g.kind === "radial")
		return [
			...(g.center ?? [0.5, 0.5]),
			g.radius ?? 0.5,
			g.radiusY ?? g.radius ?? 0.5,
			((g.rotation ?? 0) + 360) % 360,
		];
	return [...(g.center ?? [0.5, 0.5]), ((g.rotation ?? 0) + 360) % 360];
}

function expectSame(a: Gradient, b: Gradient) {
	const pa = placement(a);
	const pb = placement(b);
	expect(pa).toHaveLength(pb.length);
	for (const [i, v] of pa.entries())
		expect(v, `field ${i}`).toBeCloseTo(pb[i] as number, 6);
}

describe("box to template space", () => {
	for (const [name, f] of Object.entries(FRAMES)) {
		test(`${name}: corners land where worldCorners puts them`, () => {
			const corners = worldCorners(f.rect, f.ancestors);
			const unit: [number, number][] = [
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 1],
			];
			for (const [i, u] of unit.entries())
				expectPoint(boxToWorld(f, u), corners[i] as Point);
		});

		test(`${name}: forward and inverse agree`, () => {
			for (const u of [
				[0.5, 0.5],
				[0.13, 0.87],
				[-0.4, 1.7],
				[2, -1],
			] as [number, number][]) {
				const back = worldToBox(f, boxToWorld(f, u));
				expect(back[0]).toBeCloseTo(u[0], 9);
				expect(back[1]).toBeCloseTo(u[1], 9);
			}
		});
	}

	test("follows a real compile's nested rotated frame", () => {
		const g = geometryOf(doc());
		const f = frameOf("0/6/0", g) as GradientFrame;
		expect(f.ancestors.length).toBeGreaterThan(0);
		expect(f.ancestors[0]?.rotation).toBe(15);
		const box = g.get("0/6/0");
		expect(box).toBeDefined();
		const corners = worldCorners(f.rect, f.ancestors);
		expectPoint(boxToWorld(f, [1, 1]), corners[2] as Point);
	});
});

describe("handles and drags", () => {
	for (const [name, f] of Object.entries(FRAMES))
		for (const g of GRADIENTS) {
			const h = gradientHandles(g, f, { ring: RING });

			test(`${name} ${g.kind}: dragging a handle onto itself changes nothing`, () => {
				for (const part of PARTS[g.kind])
					expectSame(dragHandle(g, f, part, h.points[part] as Point), g);
			});

			test(`${name} ${g.kind}: a dragged handle is drawn under the pointer`, () => {
				const target = boxToWorld(f, [0.72, 0.18]);
				for (const part of PARTS[g.kind]) {
					if (part === "radiusY" || part === "rotation") continue;
					const moved = dragHandle(g, f, part, target);
					const again = gradientHandles(moved, f, { ring: RING });
					expectPoint(again.points[part], target);
				}
			});

			test(`${name} ${g.kind}: stops project back to their offsets`, () => {
				for (const s of h.stops) {
					const offset = g.stops[s.index]?.offset as number;
					const got = stopOffsetAt(g, f, s.at);
					// Around a circle, 0 and 1 are the same place.
					const diff = Math.abs(got - offset);
					expect(
						g.kind === "angular" ? Math.min(diff, 1 - diff) : diff,
					).toBeLessThan(1e-6);
				}
			});
		}

	test("the secondary radius follows its axis only", () => {
		const f = FRAMES.nested as GradientFrame;
		const g = GRADIENTS[1] as Gradient;
		const h = gradientHandles(g, f, { ring: RING });
		const c = h.points.center as Point;
		const end = h.points.radiusY as Point;
		// Twice as far along the axis, plus a sideways offset along the primary.
		const primary = h.points.radius as Point;
		const p = {
			x: c.x + (end.x - c.x) * 2 + (primary.x - c.x) * 0.5,
			y: c.y + (end.y - c.y) * 2 + (primary.y - c.y) * 0.5,
		};
		const moved = dragHandle(g, f, "radiusY", p);
		expect(moved.kind === "radial" && moved.radiusY).toBeCloseTo(0.4, 6);
	});

	test("the angular rotation handle points where it is dragged", () => {
		const f = FRAMES.rotated as GradientFrame;
		const g = GRADIENTS[2] as Gradient;
		const h = gradientHandles(g, f, { ring: RING });
		const c = h.points.center as Point;
		const p = { x: c.x + 5, y: c.y - 200 };
		const moved = dragHandle(g, f, "rotation", p);
		const again = gradientHandles(moved, f, { ring: RING }).points
			.rotation as Point;
		const dir = (a: Point) => Math.atan2(a.y - c.y, a.x - c.x);
		expect(dir(again)).toBeCloseTo(dir(p), 6);
	});
});

describe("radial on a non-square box", () => {
	const f: GradientFrame = { rect: rect(0, 0, 200, 100), ancestors: [] };
	const g: Gradient = {
		kind: "radial",
		center: [0.5, 0.5],
		radius: 0.5,
		stops: [
			{ offset: 0, color: "#000000" },
			{ offset: 1, color: "#ffffff" },
		],
	};

	test("the radius is a fraction of the longest side", () => {
		const h = gradientHandles(g, f, { ring: RING });
		expectPoint(h.points.center, { x: 100, y: 50 });
		expectPoint(h.points.radius, { x: 200, y: 50 });
		// radiusY defaults to radius: a circle, so 100 units down, not 50.
		expectPoint(h.points.radiusY, { x: 100, y: 150 });
	});

	test("rotation turns the primary axis in template units", () => {
		const h = gradientHandles({ ...g, rotation: 90 }, f, { ring: RING });
		expectPoint(h.points.radius, { x: 100, y: 150 });
		expectPoint(h.points.radiusY, { x: 0, y: 50 });
	});

	test("a radius drag divides by the longest side", () => {
		const moved = dragHandle(g, f, "radius", { x: 100, y: 110 });
		expect(moved.kind === "radial" && moved.radius).toBeCloseTo(0.3, 9);
		expect(moved.kind === "radial" && moved.rotation).toBeCloseTo(90, 9);
		// A circle stays one: no second radius is written.
		expect(moved.kind === "radial" && moved.radiusY).toBeUndefined();
	});
});

describe("linear points", () => {
	const f = FRAMES.rotated as GradientFrame;
	const g: Gradient = {
		kind: "linear",
		angle: 90,
		stops: [
			{ offset: 0, color: "#000000" },
			{ offset: 1, color: "#ffffff" },
		],
	};

	test("an angle-only gradient gains points on its first drag", () => {
		const moved = dragHandle(g, f, "to", boxToWorld(f, [0.9, 0.6]));
		expect(moved.kind).toBe("linear");
		if (moved.kind !== "linear") return;
		expect(moved.from?.[0]).toBeCloseTo(0.5, 9);
		expect(moved.from?.[1]).toBeCloseTo(0, 9);
		expect(moved.to?.[0]).toBeCloseTo(0.9, 9);
		expect(moved.to?.[1]).toBeCloseTo(0.6, 9);
		expect(moved.angle).toBeCloseTo(
			linearGradientAngle(moved.from ?? [0, 0], moved.to ?? [0, 0]),
			9,
		);
	});

	test("shift snaps the direction to 15-degree steps in the layer", () => {
		for (const f2 of Object.values(FRAMES)) {
			const moved = dragHandle(g, f2, "to", boxToWorld(f2, [0.83, 0.71]), {
				snap: true,
			});
			if (moved.kind !== "linear" || !moved.from || !moved.to)
				throw new Error("expected points");
			const a = worldToLocal(f2, boxToWorld(f2, moved.from));
			const b = worldToLocal(f2, boxToWorld(f2, moved.to));
			const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
			const steps = deg / 15;
			expect(steps).toBeCloseTo(Math.round(steps), 6);
		}
	});

	test("shift snaps radial and angular rotation", () => {
		const f2 = FRAMES.nested as GradientFrame;
		const r = dragHandle(
			GRADIENTS[1] as Gradient,
			f2,
			"radius",
			boxToWorld(f2, [0.9, 0.1]),
			{
				snap: true,
			},
		);
		const a = dragHandle(
			GRADIENTS[2] as Gradient,
			f2,
			"rotation",
			boxToWorld(f2, [0.9, 0.1]),
			{
				snap: true,
			},
		);
		for (const moved of [r, a]) {
			const rot = moved.kind === "linear" ? 0 : (moved.rotation ?? 0);
			expect(rot / 15).toBeCloseTo(Math.round(rot / 15), 9);
		}
	});

	test("equal points are refused", () => {
		const withPoints = dragHandle(g, f, "to", boxToWorld(f, [0.9, 0.6]));
		const same = dragHandle(withPoints, f, "to", boxToWorld(f, [0.5, 0]));
		expect(same).toBe(withPoints);
	});
});

describe("handle names", () => {
	test("parse", () => {
		expect(parseGradientHandle("grad:2:to")).toEqual({ index: 2, part: "to" });
		expect(parseGradientHandle("grad:0:stop:3")).toEqual({
			index: 0,
			part: "stop",
			stop: 3,
		});
		expect(parseGradientHandle("grad:1:line")).toEqual({
			index: 1,
			part: "line",
		});
		expect(parseGradientHandle("grad:x:to")).toBeNull();
		expect(parseGradientHandle("grad:0:nope")).toBeNull();
		expect(parseGradientHandle("nw")).toBeNull();
	});
});
