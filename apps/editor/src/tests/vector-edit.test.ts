import type { Template, VectorElement } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { getElement } from "~/doc/path";
import type { PenPath } from "~/doc/pen";
import {
	frameToWorld,
	mapPath,
	moveHandle,
	movePoints,
	nearestSegment,
	parseVectorPath,
	removePoints,
	reversePath,
	setVectorPaths,
	splitSegment,
	toggleSmooth,
	vectorBounds,
	vectorPathData,
	withVectorPaths,
	worldToFrame,
} from "~/doc/vector-edit";
import { doc } from "./doc-fixture";

const vector = (
	d: string,
	box: Partial<VectorElement> = {},
): VectorElement => ({
	id: "v",
	type: "vector",
	pos: { x: 100, y: 50 },
	size: { width: 100, height: 60 },
	properties: { d, fill: "#000000" },
	...box,
});

const curve: PenPath = {
	closed: false,
	points: [
		{ x: 0, y: 0, out: { x: 0, y: 60 } },
		{ x: 100, y: 0, in: { x: 100, y: 60 } },
	],
};

const bezier = (
	[p0, c1, c2, p1]: [
		{ x: number; y: number },
		{ x: number; y: number },
		{ x: number; y: number },
		{ x: number; y: number },
	],
	t: number,
) => {
	const u = 1 - t;
	return {
		x:
			u ** 3 * p0.x +
			3 * u * u * t * c1.x +
			3 * u * t * t * c2.x +
			t ** 3 * p1.x,
		y:
			u ** 3 * p0.y +
			3 * u * u * t * c1.y +
			3 * u * t * t * c2.y +
			t ** 3 * p1.y,
	};
};

describe("vector path data", () => {
	test("lines stay lines and curves stay curves through a round trip", () => {
		for (const d of [
			"M0 0L100 0L50 60",
			"M0 0L100 0L50 60Z",
			"M0 100C0 100 50 200 100 100",
			"M0 0C10 20 30 40 50 60L70 80Z",
			"M0 0L10 0L10 10M20 20L30 20L30 30Z",
		])
			expect(vectorPathData(parseVectorPath(d))).toBe(d);
	});

	test("subpaths are separate, and a closed one drops its repeated start", () => {
		const paths = parseVectorPath("M0 0L10 0L10 10L0 0ZM20 20L30 20L30 30");
		expect(paths).toHaveLength(2);
		expect(paths[0]).toEqual({
			closed: true,
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
			],
		});
		expect(paths[1]?.closed).toBe(false);
		expect(vectorPathData(paths)).toBe("M0 0L10 0L10 10ZM20 20L30 20L30 30");
	});

	test("a closing curve gives the first point its incoming handle", () => {
		const [path] = parseVectorPath("M0 0L100 0C100 0 -10 10 0 0Z");
		expect(path?.points).toEqual([
			{ x: 0, y: 0, in: { x: -10, y: 10 } },
			{ x: 100, y: 0 },
		]);
		expect(vectorPathData([path as PenPath])).toBe(
			"M0 0L100 0C100 0 -10 10 0 0Z",
		);
	});

	test("relative commands, arcs and quadratics become absolute lines and cubics", () => {
		const [path] = parseVectorPath("m10 10l20 0q10 10 20 0a5 5 0 0 1 10 0z");
		expect(path?.closed).toBe(true);
		expect(path?.points[0]).toEqual({ x: 10, y: 10 });
		expect(path?.points[1]).toMatchObject({ x: 30, y: 10 });
		expect(path?.points.length).toBeGreaterThan(3);
	});

	test("a lone move is dropped, and a missing path has none", () => {
		expect(parseVectorPath("M5 5")).toEqual([]);
		expect(parseVectorPath("")).toEqual([]);
		expect(parseVectorPath("M5 5M0 0L1 1")).toHaveLength(1);
	});

	test("bounds cover every subpath", () => {
		const paths = parseVectorPath("M0 0L10 0L10 10M20 20L30 20L30 50");
		expect(vectorBounds(paths)).toEqual({
			x: 0,
			y: 0,
			width: 30,
			height: 50,
			rotation: 0,
		});
		expect(vectorBounds([])).toBeNull();
	});
});

describe("refitting a vector", () => {
	test("the box follows the new bounds and the layer stays in place", () => {
		const el = vector("M0 0L100 0L50 60Z");
		const paths = movePoints(
			parseVectorPath("M0 0L100 0L50 60Z"),
			[{ path: 0, index: 0 }],
			-20,
			-10,
		);
		const next = withVectorPaths(el, paths);
		expect(next.pos).toEqual({ x: 80, y: 40 });
		expect(next.size).toEqual({ width: 120, height: 70 });
		expect(next.properties.d).toBe("M0 0L120 10L70 70Z");
		// The unmoved anchors keep their template-space place.
		const world = (e: VectorElement, p: { x: number; y: number }) => ({
			x: (e.pos?.x ?? 0) + p.x,
			y: (e.pos?.y ?? 0) + p.y,
		});
		expect(world(next, { x: 120, y: 10 })).toEqual(world(el, { x: 100, y: 0 }));
		expect(world(next, { x: 70, y: 70 })).toEqual(world(el, { x: 50, y: 60 }));
	});

	test("a rotated layer keeps its painted place", () => {
		const el = vector("M0 0L100 0L50 60Z", { rotation: 30 });
		const frame = (e: VectorElement) => ({
			x: e.pos?.x ?? 0,
			y: e.pos?.y ?? 0,
			width: e.size?.width ?? 0,
			height: e.size?.height ?? 0,
			rotation: e.rotation ?? 0,
		});
		const before = parseVectorPath(el.properties.d);
		const edited = movePoints(before, [{ path: 0, index: 2 }], 40, 90);
		const next = withVectorPaths(el, edited);
		expect(next.rotation).toBe(30);
		const after = parseVectorPath(next.properties.d);
		// Anchors that did not move paint at the same world spot.
		for (const index of [0, 1]) {
			const a = frameToWorld(frame(el), before[0]?.points[index] as never);
			const b = frameToWorld(frame(next), after[0]?.points[index] as never);
			expect(b.x).toBeCloseTo(a.x, 1);
			expect(b.y).toBeCloseTo(a.y, 1);
		}
		const moved = frameToWorld(frame(next), after[0]?.points[2] as never);
		const expected = frameToWorld(frame(el), edited[0]?.points[2] as never);
		expect(moved.x).toBeCloseTo(expected.x, 1);
		expect(moved.y).toBeCloseTo(expected.y, 1);
	});

	test("points map into the layer's space and back", () => {
		const frame = { x: 100, y: 50, width: 100, height: 60, rotation: 40 };
		const p = { x: 12, y: 34 };
		const back = worldToFrame(frame, frameToWorld(frame, p));
		expect(back.x).toBeCloseTo(12, 8);
		expect(back.y).toBeCloseTo(34, 8);
		expect(frameToWorld({ ...frame, rotation: 0 }, p)).toEqual({
			x: 112,
			y: 84,
		});
		const mapped = mapPath(curve, (q) => ({ x: q.x + 1, y: q.y }));
		expect(mapped.points[0]).toEqual({ x: 1, y: 0, out: { x: 1, y: 60 } });
	});

	test("rewrites a vector in the template", () => {
		const t = doc();
		const base = t.template_data[0]?.elements ?? [];
		const withVector: Template = {
			...t,
			template_data: [
				{
					...(t.template_data[0] as NonNullable<(typeof t.template_data)[0]>),
					elements: [...base, vector("M0 0L100 0L50 60Z")],
				},
				...t.template_data.slice(1),
			],
		};
		const key = `0/${base.length}`;
		const out = setVectorPaths(
			withVector,
			key,
			parseVectorPath("M0 0L10 0L10 10Z"),
		);
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		const el = getElement(out.template, key) as VectorElement;
		expect(el.size).toEqual({ width: 10, height: 10 });
		expect(el.properties.d).toBe("M0 0L10 0L10 10Z");
		expect(el.properties.fill).toBe("#000000");
	});
});

describe("point edits", () => {
	const tri = (): PenPath[] => parseVectorPath("M0 0L100 0L50 60Z");

	test("moving an anchor carries its handles", () => {
		const out = movePoints([curve], [{ path: 0, index: 0 }], 5, 7);
		expect(out[0]?.points[0]).toEqual({ x: 5, y: 7, out: { x: 5, y: 67 } });
		expect(out[0]?.points[1]).toEqual(curve.points[1]);
	});

	test("a smooth point's handles stay opposite, a broken pair moves alone", () => {
		const smooth: PenPath = {
			closed: false,
			points: [
				{ x: 0, y: 0 },
				{ x: 50, y: 50, in: { x: 30, y: 50 }, out: { x: 70, y: 50 } },
				{ x: 100, y: 0 },
			],
		};
		const ref = { path: 0, index: 1 };
		const mirrored = moveHandle([smooth], ref, "out", { x: 50, y: 90 })[0]
			?.points[1];
		expect(mirrored?.out).toEqual({ x: 50, y: 90 });
		expect(mirrored?.in?.x).toBeCloseTo(50, 8);
		expect(mirrored?.in?.y).toBeCloseTo(10, 8);
		const broken = moveHandle([smooth], ref, "out", { x: 50, y: 90 }, true)[0]
			?.points[1];
		expect(broken?.in).toEqual({ x: 30, y: 50 });
		// Unequal lengths keep the other handle's length.
		const uneven: PenPath = {
			...smooth,
			points: [
				smooth.points[0] as never,
				{ x: 50, y: 50, in: { x: 40, y: 50 }, out: { x: 80, y: 50 } },
				smooth.points[2] as never,
			],
		};
		const turned = moveHandle([uneven], ref, "out", { x: 50, y: 100 })[0]
			?.points[1];
		expect(turned?.in?.x).toBeCloseTo(50, 8);
		expect(turned?.in?.y).toBeCloseTo(40, 8);
		// A corner with one handle is never mirrored.
		const lone = moveHandle([curve], { path: 0, index: 0 }, "out", {
			x: 9,
			y: 9,
		})[0];
		expect(lone?.points[0]).toEqual({ x: 0, y: 0, out: { x: 9, y: 9 } });
	});

	test("toggling turns a corner smooth along its neighbours, and back", () => {
		const ref = { path: 0, index: 1 };
		const smooth = toggleSmooth(
			[
				{
					closed: false,
					points: [
						{ x: 0, y: 0 },
						{ x: 90, y: 30 },
						{ x: 180, y: 0 },
					],
				},
			],
			ref,
		);
		const p = smooth[0]?.points[1];
		expect(p?.out?.x).toBeCloseTo(90 + Math.hypot(90, 30) / 3, 6);
		expect(p?.out?.y).toBeCloseTo(30, 6);
		expect(p?.in?.x).toBeCloseTo(90 - Math.hypot(90, 30) / 3, 6);
		const corner = toggleSmooth(smooth, ref);
		expect(corner[0]?.points[1]).toEqual({ x: 90, y: 30 });
	});

	test("an end point gets one handle towards its neighbour, a closed path wraps", () => {
		const open = toggleSmooth(parseVectorPath("M0 0L90 0L90 90"), {
			path: 0,
			index: 0,
		});
		expect(open[0]?.points[0]).toEqual({ x: 0, y: 0, out: { x: 30, y: 0 } });
		const closed = toggleSmooth(tri(), { path: 0, index: 0 });
		const p = closed[0]?.points[0];
		expect(p?.in).toBeDefined();
		expect(p?.out).toBeDefined();
	});

	test("removing anchors keeps the rest, and drops a subpath left short", () => {
		const paths = parseVectorPath("M0 0L10 0L10 10L0 10ZM50 50L60 50L60 60");
		const out = removePoints(paths, [{ path: 0, index: 1 }]);
		expect(vectorPathData(out)).toBe("M0 0L10 10L0 10ZM50 50L60 50L60 60");
		const dropped = removePoints(paths, [
			{ path: 1, index: 0 },
			{ path: 1, index: 2 },
		]);
		expect(dropped).toHaveLength(1);
		expect(
			removePoints(tri(), [
				{ path: 0, index: 0 },
				{ path: 0, index: 1 },
			]),
		).toEqual([]);
	});

	test("reversing a path swaps its handles and keeps the shape", () => {
		const out = reversePath(curve);
		expect(out.points[0]).toEqual({ x: 100, y: 0, out: { x: 100, y: 60 } });
		expect(out.points[1]).toEqual({ x: 0, y: 0, in: { x: 0, y: 60 } });
		const closed = reversePath(tri()[0] as PenPath);
		expect(closed.points[0]).toEqual({ x: 0, y: 0 });
		expect(closed.points[1]).toEqual({ x: 50, y: 60 });
	});
});

describe("adding a point", () => {
	test("splitting a curve leaves its shape unchanged", () => {
		const split = splitSegment([curve], 0, 0, 0.3);
		expect(split?.ref).toEqual({ path: 0, index: 1 });
		const [a, m, b] = split?.paths[0]?.points ?? [];
		const original: Parameters<typeof bezier>[0] = [
			{ x: 0, y: 0 },
			{ x: 0, y: 60 },
			{ x: 100, y: 60 },
			{ x: 100, y: 0 },
		];
		expect(m?.x).toBeCloseTo(bezier(original, 0.3).x, 8);
		expect(m?.y).toBeCloseTo(bezier(original, 0.3).y, 8);
		const left: Parameters<typeof bezier>[0] = [
			a as never,
			a?.out as never,
			m?.in as never,
			m as never,
		];
		const right: Parameters<typeof bezier>[0] = [
			m as never,
			m?.out as never,
			b?.in as never,
			b as never,
		];
		for (const t of [0.2, 0.5, 0.9]) {
			const l = bezier(left, t);
			const wantL = bezier(original, 0.3 * t);
			expect(l.x).toBeCloseTo(wantL.x, 8);
			expect(l.y).toBeCloseTo(wantL.y, 8);
			const r = bezier(right, t);
			const wantR = bezier(original, 0.3 + 0.7 * t);
			expect(r.x).toBeCloseTo(wantR.x, 8);
			expect(r.y).toBeCloseTo(wantR.y, 8);
		}
	});

	test("splitting a line keeps lines", () => {
		const split = splitSegment(parseVectorPath("M0 0L100 0L50 60"), 0, 0, 0.25);
		expect(vectorPathData(split?.paths ?? [])).toBe("M0 0L25 0L100 0L50 60");
	});

	test("splitting a closing segment appends the point", () => {
		const split = splitSegment(parseVectorPath("M0 0L100 0L50 60Z"), 0, 2, 0.5);
		expect(split?.ref).toEqual({ path: 0, index: 3 });
		expect(vectorPathData(split?.paths ?? [])).toBe("M0 0L100 0L50 60L25 30Z");
	});

	test("a segment half curved keeps its straight end straight", () => {
		const half: PenPath = {
			closed: false,
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0, in: { x: 100, y: 50 } },
			],
		};
		const split = splitSegment([half], 0, 0, 0.5);
		expect(split?.paths[0]?.points[0]?.out).toBeUndefined();
	});

	test("finds the nearest spot on a curve or line within reach", () => {
		const onCurve = bezier(
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 60 },
				{ x: 100, y: 60 },
				{ x: 100, y: 0 },
			],
			0.4,
		);
		const hit = nearestSegment(
			[curve],
			{ x: onCurve.x + 1, y: onCurve.y + 1 },
			5,
		);
		expect(hit?.t).toBeCloseTo(0.4, 1);
		expect(hit?.segment).toBe(0);
		expect(nearestSegment([curve], { x: 50, y: 200 }, 5)).toBeNull();
		const line = nearestSegment(
			parseVectorPath("M0 0L100 0L100 100"),
			{ x: 100, y: 40 },
			4,
		);
		expect(line).toMatchObject({
			path: 0,
			segment: 1,
			point: { x: 100, y: 40 },
		});
		expect(line?.t).toBeCloseTo(0.4, 6);
	});
});
