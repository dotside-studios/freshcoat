import type { Element, Template } from "@freshcoat-js/coatfile";
import { validate } from "@freshcoat-js/coatfile";
import { describe, expect, test } from "vitest";
import { ellipsePath, isEllipseVector } from "../doc/factories";
import {
	align,
	applyRect,
	canTransform,
	centreOf,
	HANDLES,
	type Handle,
	handleDirection,
	layerBounds,
	mapRectInBox,
	normalizeAngle,
	type Rect,
	resizeRect,
	rotateFromPointer,
	rotatePoint,
	snapCandidates,
	snapMove,
	snapResize,
	toParentSpace,
	worldCorners,
} from "../doc/geometry";
import { insertElements, unwrap, updateElement } from "../doc/ops";
import { getElement } from "../doc/path";
import { doc, frozenDoc, geometryOf } from "./doc-fixture";

const r = (
	x: number,
	y: number,
	width: number,
	height: number,
	rotation = 0,
): Rect => ({
	x,
	y,
	width,
	height,
	rotation,
});

function expectRect(actual: Rect | undefined, expected: Rect, digits = 6) {
	expect(actual).toBeDefined();
	for (const k of ["x", "y", "width", "height", "rotation"] as const)
		expect(actual?.[k], k).toBeCloseTo(expected[k], digits);
}

describe("collectGeometry from a real compile", () => {
	const t = frozenDoc();
	const g = geometryOf(t);

	test("top-level and nested frames report absolute boxes", () => {
		expectRect(g.get("0/0")?.rect, r(10, 20, 100, 50));
		expectRect(g.get("0/1")?.rect, r(200, 100, 300, 200));
		expectRect(g.get("0/1/0")?.rect, r(210, 110, 50, 50));
		expectRect(g.get("0/1/2")?.rect, r(300, 200, 80, 80));
		expectRect(g.get("0/1/2/0")?.rect, r(305, 206, 10, 10));
		expect(g.get("0/1/2/0")?.parentKey).toBe("0/1/2");
		expect(g.get("0/0")?.parentKey).toBeNull();
	});

	test("the background fills the side", () => {
		expectRect(g.get("0/bg")?.rect, r(0, 0, 1000, 600));
		expect(g.get("0/bg")?.parentKey).toBeNull();
	});

	test("auto-layout children are placed by the layout", () => {
		expectRect(g.get("0/3")?.rect, r(600, 50, 300, 80));
		expectRect(g.get("0/3/0")?.rect, r(610, 60, 50, 60));
		expectRect(g.get("0/3/1")?.rect, r(670, 60, 40, 60));
		expectRect(g.get("0/3/2")?.rect, r(605, 55, 10, 10));
		expect(g.get("0/3/0")?.autoLayoutChild).toBe(true);
		expect(g.get("0/3/2")?.autoLayoutChild).toBe(false);
		expect(g.get("0/1/0")?.autoLayoutChild).toBe(false);
	});

	test("a mask's source and children are relative to it", () => {
		expectRect(g.get("0/2")?.rect, r(50, 300, 200, 100));
		expectRect(g.get("0/2/-1")?.rect, r(50, 300, 200, 100));
		expectRect(g.get("0/2/0")?.rect, r(50, 300, 200, 100));
		expect(g.get("0/2/-1")?.parentKey).toBe("0/2");
	});

	test("rotation is per layer, and world rotation sums ancestors", () => {
		expectRect(g.get("0/5")?.rect, r(700, 300, 100, 40, 30));
		expect(g.get("0/5")?.worldRotation).toBe(30);
		expectRect(g.get("0/6/0")?.rect, r(620, 430, 40, 20, 10));
		expect(g.get("0/6/0")?.worldRotation).toBe(25);
	});

	test("a layer hidden by visibleWhen has no box", () => {
		expect(g.get("0/4")).toBeDefined();
		expect(geometryOf(t, 0, { show: "false" }).get("0/4")).toBeUndefined();
	});

	test("hug-sized text in auto layout reports its measured box", () => {
		const text: Element = {
			id: "label",
			type: "text",
			size: { width: 10, height: 10 },
			layoutChild: { width: "hug", height: "hug" },
			properties: { value: "Hello", font: { family: "Inter", size: 20 } },
		};
		const t2 = unwrap(insertElements(t, "0/3", 0, [text])).template;
		const box = geometryOf(t2).get("0/3/0")?.rect;
		expect(box?.x).toBe(610);
		expect(box?.width).toBeGreaterThan(20);
		expect(geometryOf(t2).get("0/3/1")?.rect.x).toBeCloseTo(
			610 + (box?.width ?? 0) + 10,
		);
	});

	test("canTransform", () => {
		expect(canTransform("0/0", g)).toBe(true);
		expect(canTransform("0/5", g)).toBe(true);
		expect(canTransform("0/1/2/0", g)).toBe(true);
		expect(canTransform("0/3/0", g)).toBe(false);
		expect(canTransform("0/3/2", g)).toBe(true);
		expect(canTransform("0/6/0", g)).toBe(false);
		expect(canTransform("0/bg", g)).toBe(false);
		expect(canTransform("0/99", g)).toBe(false);
	});

	test("toParentSpace", () => {
		expect(toParentSpace({ x: 250, y: 150 }, "0/1", g)).toEqual({
			x: 50,
			y: 50,
		});
		expect(toParentSpace({ x: 250, y: 150 }, null, g)).toEqual({
			x: 250,
			y: 150,
		});
		expect(toParentSpace({ x: 60, y: 310 }, "0/2", g)).toEqual({
			x: 10,
			y: 10,
		});
	});
});

describe("worldCorners", () => {
	test("an unrotated rect", () => {
		expect(worldCorners(r(10, 20, 30, 40))).toEqual([
			{ x: 10, y: 20 },
			{ x: 40, y: 20 },
			{ x: 40, y: 60 },
			{ x: 10, y: 60 },
		]);
	});

	test("turns about its own centre, then each ancestor's", () => {
		const c = worldCorners(r(0, 0, 20, 10, 90));
		expect(c[0].x).toBeCloseTo(15);
		expect(c[0].y).toBeCloseTo(-5);
		const nested = worldCorners(r(0, 0, 10, 10), [r(0, 0, 100, 100, 180)]);
		expect(nested[0].x).toBeCloseTo(100);
		expect(nested[0].y).toBeCloseTo(100);
	});

	test("layerBounds covers a rotated layer's painted box", () => {
		const b = layerBounds("0/5", geometryOf(doc()));
		const w = 100 * Math.cos(Math.PI / 6) + 40 * Math.sin(Math.PI / 6);
		expect(b?.width).toBeCloseTo(w);
		expect((b?.x ?? 0) + (b?.width ?? 0) / 2).toBeCloseTo(750);
	});
});

describe("resizeRect", () => {
	// The local point a handle's anchor sits at, in units of half-size.
	const anchorLocal = (h: Handle, fromCenter: boolean): [number, number] => {
		const [sx, sy] = handleDirection(h);
		return fromCenter ? [0, 0] : [-sx, -sy];
	};
	const worldAt = (rect: Rect, u: number, v: number) =>
		rotatePoint(
			{
				x: centreOf(rect).x + (u * rect.width) / 2,
				y: centreOf(rect).y + (v * rect.height) / 2,
			},
			rect.rotation,
			centreOf(rect),
		);

	for (const rotation of [0, 30]) {
		for (const handle of HANDLES) {
			test(`${handle} at ${rotation}° moves its edges and keeps the anchor`, () => {
				const start = r(100, 100, 200, 100, rotation);
				const local = { x: 20, y: 10 };
				const delta = rotatePoint(local, rotation);
				const out = resizeRect(start, handle, delta);
				const [sx, sy] = handleDirection(handle);
				expect(out.width).toBeCloseTo(200 + sx * 20);
				expect(out.height).toBeCloseTo(100 + sy * 10);
				expect(out.rotation).toBe(rotation);
				const [u, v] = anchorLocal(handle, false);
				const before = worldAt(start, u, v);
				const after = worldAt(out, u, v);
				expect(after.x).toBeCloseTo(before.x);
				expect(after.y).toBeCloseTo(before.y);
			});

			test(`${handle} at ${rotation}° from the centre mirrors the opposite edge`, () => {
				const start = r(100, 100, 200, 100, rotation);
				const delta = rotatePoint({ x: 20, y: 10 }, rotation);
				const out = resizeRect(start, handle, delta, { fromCenter: true });
				const [sx, sy] = handleDirection(handle);
				expect(out.width).toBeCloseTo(200 + 2 * sx * 20);
				expect(out.height).toBeCloseTo(100 + 2 * sy * 10);
				expect(centreOf(out).x).toBeCloseTo(200);
				expect(centreOf(out).y).toBeCloseTo(150);
			});

			test(`${handle} at ${rotation}° keeps the aspect ratio`, () => {
				const start = r(100, 100, 200, 100, rotation);
				const delta = rotatePoint({ x: 40, y: 5 }, rotation);
				const out = resizeRect(start, handle, delta, { keepAspect: true });
				expect(out.width / out.height).toBeCloseTo(2);
				const [sx, sy] = handleDirection(handle);
				const [u, v] = anchorLocal(handle, false);
				// Corner handles pin the opposite corner; edge handles scale the
				// other axis about the centre, so the anchor edge's midpoint holds.
				const anchor =
					sx !== 0 && sy !== 0 ? [u, v] : [sx === 0 ? 0 : u, sy === 0 ? 0 : v];
				const before = worldAt(start, anchor[0], anchor[1]);
				const after = worldAt(out, anchor[0], anchor[1]);
				expect(after.x).toBeCloseTo(before.x);
				expect(after.y).toBeCloseTo(before.y);
			});
		}
	}

	test("keepAspect on a corner follows the dominant axis", () => {
		const out = resizeRect(
			r(0, 0, 200, 100),
			"se",
			{ x: 100, y: 10 },
			{ keepAspect: true },
		);
		expect(out).toEqual(r(0, 0, 300, 150));
		const tall = resizeRect(
			r(0, 0, 200, 100),
			"se",
			{ x: 10, y: 100 },
			{ keepAspect: true },
		);
		expect(tall).toEqual(r(0, 0, 400, 200));
	});

	test("keepAspect with fromCenter", () => {
		const out = resizeRect(
			r(0, 0, 200, 100),
			"e",
			{ x: 50, y: 0 },
			{
				keepAspect: true,
				fromCenter: true,
			},
		);
		expect(out).toEqual(r(-50, -25, 300, 150));
	});

	test("a drag past the anchor flips instead of going negative", () => {
		const out = resizeRect(r(100, 100, 200, 100), "e", { x: -260, y: 0 });
		expect(out).toEqual(r(40, 100, 60, 100));
		const corner = resizeRect(r(100, 100, 200, 100), "se", {
			x: -250,
			y: -130,
		});
		expect(corner).toEqual(r(50, 70, 50, 30));
	});

	test("sizes floor at 1 on the anchor's side", () => {
		const out = resizeRect(r(100, 100, 200, 100), "e", { x: -200, y: 0 });
		expect(out).toEqual(r(100, 100, 1, 100));
		const w = resizeRect(r(100, 100, 200, 100), "w", { x: 200, y: 0 });
		expect(w).toEqual(r(299, 100, 1, 100));
		const c = resizeRect(
			r(100, 100, 200, 100),
			"n",
			{ x: 0, y: 50 },
			{ fromCenter: true },
		);
		expect(c).toEqual(r(100, 149.5, 200, 1));
	});

	test("mapRectInBox scales members of a group resize", () => {
		expect(
			mapRectInBox(r(10, 10, 10, 10), r(0, 0, 100, 100), r(0, 0, 200, 50)),
		).toEqual(r(20, 5, 20, 5));
	});
});

describe("rotate", () => {
	test("adds the pointer's turn about the centre", () => {
		const rect = r(0, 0, 100, 100);
		expect(
			rotateFromPointer(rect, { x: 100, y: 50 }, { x: 50, y: 100 }, 0),
		).toBeCloseTo(90);
		expect(
			rotateFromPointer(rect, { x: 100, y: 50 }, { x: 50, y: 100 }, 20),
		).toBeCloseTo(110);
	});

	test("snaps to 15° when asked", () => {
		const rect = r(0, 0, 100, 100);
		const p = rotatePoint({ x: 100, y: 50 }, 37, { x: 50, y: 50 });
		expect(rotateFromPointer(rect, { x: 100, y: 50 }, p, 0)).toBeCloseTo(37);
		expect(
			rotateFromPointer(rect, { x: 100, y: 50 }, p, 0, { snap: true }),
		).toBe(30);
		const q = rotatePoint({ x: 100, y: 50 }, 38, { x: 50, y: 50 });
		expect(
			rotateFromPointer(rect, { x: 100, y: 50 }, q, 0, { snap: true }),
		).toBe(45);
	});

	test("normalises to (-180, 180]", () => {
		expect(normalizeAngle(190)).toBe(-170);
		expect(normalizeAngle(-180)).toBe(180);
		expect(normalizeAngle(540)).toBe(180);
		expect(normalizeAngle(-360)).toBe(0);
		expect(Object.is(normalizeAngle(-0), 0)).toBe(true);
		const rect = r(0, 0, 100, 100);
		const p = rotatePoint({ x: 100, y: 50 }, 38, { x: 50, y: 50 });
		expect(
			rotateFromPointer(rect, { x: 100, y: 50 }, p, 170, { snap: true }),
		).toBe(-150);
	});
});

describe("applyRect", () => {
	const t = frozenDoc();
	const g = geometryOf(t);
	const el = (tt: Template, k: string) => getElement(tt, k) as Element;

	test("writes a parent-relative pos, size and rotation, rounded", () => {
		const out = unwrap(
			applyRect(t, "0/1/0", r(250.123, 160.456, 70.005, 30, 12.3456), g),
		);
		expect(el(out.template, "0/1/0")).toMatchObject({
			pos: { x: 50.12, y: 60.46 },
			size: { width: 70.01, height: 30 },
			rotation: 12.35,
		});
		expect(el(out.template, "0/0")).toBe(el(t, "0/0"));
	});

	test("does not add a zero rotation", () => {
		const out = unwrap(applyRect(t, "0/0", r(0, 0, 10, 10), g));
		expect("rotation" in el(out.template, "0/0")).toBe(false);
		const zeroed = unwrap(applyRect(t, "0/5", r(0, 0, 10, 10), g));
		expect(el(zeroed.template, "0/5").rotation).toBe(0);
	});

	test("scales a vector's path with its size", () => {
		const withVector = unwrap(
			insertElements(t, { side: 0 }, 0, [
				{
					id: "v",
					type: "vector",
					pos: { x: 0, y: 0 },
					size: { width: 10, height: 20 },
					properties: { d: "M0 0L10 0L10 20Z" },
				},
			]),
		).template;
		const out = unwrap(
			applyRect(withVector, "0/0", r(0, 0, 20, 10), geometryOf(withVector)),
		);
		expect(
			(el(out.template, "0/0") as { properties: { d: string } }).properties.d,
		).toBe("M0 0L20 0L20 10Z");
	});

	test("regenerates an ellipse instead of scaling it", () => {
		const ellipse = unwrap(
			updateElement(t, "0/2/-1", { size: { width: 200, height: 100 } }),
		).template;
		expect(isEllipseVector(el(ellipse, "0/2/-1"))).toBe(true);
		const out = unwrap(applyRect(ellipse, "0/2/-1", r(50, 300, 120, 60), g));
		const src = el(out.template, "0/2/-1") as Extract<
			Element,
			{ type: "vector" }
		>;
		expect(src.properties.d).toBe(ellipsePath(120, 60));
		expect(src.pos).toEqual({ x: 0, y: 0 });
		expect(isEllipseVector(src)).toBe(true);
	});

	test("hug-sized text becomes fixed on the axis that changed", () => {
		const withText = unwrap(
			updateElement(t, "0/1/1", {
				layoutChild: { width: "hug", height: "hug" },
			}),
		).template;
		const out = unwrap(applyRect(withText, "0/1/1", r(270, 110, 140, 30), g));
		expect(el(out.template, "0/1/1").layoutChild).toEqual({
			width: "fixed",
			height: "hug",
		});
	});

	test("refuses the background and a missing layer", () => {
		expect(applyRect(t, "0/bg", r(0, 0, 1, 1), g).ok).toBe(false);
		expect(applyRect(t, "0/40", r(0, 0, 1, 1), g).ok).toBe(false);
	});

	test("the result validates", () => {
		const out = unwrap(applyRect(t, "0/6/0", r(1, 2, 3, 4, 5), g));
		expect(validate(out.template).ok).toBe(true);
	});
});

describe("snapping", () => {
	const t = frozenDoc();
	const g = geometryOf(t);
	const artboard = { width: t.width, height: t.height };

	test("candidates: artboard, visible layers not moving and not inside a moving one", () => {
		const c = snapCandidates(g, artboard, ["0/1"], new Set(["0/5"]));
		const xs = c.x.map((l) => l.value);
		expect(xs.slice(0, 3)).toEqual([0, 500, 1000]);
		expect(xs).toContain(10);
		expect(xs).toContain(110);
		expect(xs).toContain(600);
		expect(xs).not.toContain(200);
		expect(xs).not.toContain(210);
		expect(xs).not.toContain(305);
		const rotLeft = layerBounds("0/5", g)?.x;
		expect(xs).not.toContain(rotLeft);
		expect(c.y.map((l) => l.value)).toContain(20);
	});

	test("the mask source offers no lines, and hiding a parent hides its children", () => {
		const c = snapCandidates(g, artboard, [], new Set(["0/3"]));
		const xs = c.x.map((l) => l.value);
		expect(xs).not.toContain(610);
		expect(xs).toContain(50);
	});

	test("snapMove picks the smallest delta per axis", () => {
		const c = {
			x: [
				{ value: 100, from: 0, to: 10 },
				{ value: 52, from: 0, to: 10 },
			],
			y: [{ value: 45, from: 300, to: 400 }],
		};
		const s = snapMove(r(0, 40, 50, 20), c, 6);
		expect(s.dx).toBe(2);
		expect(s.dy).toBe(5);
		expect(s.guides).toEqual([
			{ x1: 52, y1: 0, x2: 52, y2: 65 },
			{ x1: 2, y1: 45, x2: 400, y2: 45 },
		]);
	});

	test("snapMove against a real side draws a guide spanning both boxes", () => {
		const c = snapCandidates(g, artboard, ["0/0"]);
		const s = snapMove(r(196, 580, 8, 8), c, 6);
		expect(s).toEqual({
			dx: 0,
			dy: 0,
			guides: [{ x1: 200, y1: 100, x2: 200, y2: 588 }],
		});
	});

	test("nothing within the threshold means no snap", () => {
		const s = snapMove(
			r(123, 237, 10, 10),
			{ x: [{ value: 0, from: 0, to: 1 }], y: [] },
			6,
		);
		expect(s).toEqual({ dx: 0, dy: 0, guides: [] });
	});

	test("centres snap too", () => {
		const s = snapMove(
			r(446, 10, 100, 10),
			{ x: [{ value: 500, from: 0, to: 600 }], y: [] },
			6,
		);
		expect(s.dx).toBe(4);
		expect(s.guides).toEqual([{ x1: 500, y1: 0, x2: 500, y2: 600 }]);
	});

	test("snapResize only moves the handle's edges", () => {
		const c = {
			x: [{ value: 100, from: 0, to: 10 }],
			y: [{ value: 50, from: 0, to: 10 }],
		};
		expect(snapResize(r(0, 0, 97, 48), "e", c, 6)).toMatchObject({
			dx: 3,
			dy: 0,
		});
		expect(snapResize(r(0, 0, 97, 48), "se", c, 6)).toMatchObject({
			dx: 3,
			dy: 2,
		});
		expect(snapResize(r(0, 0, 97, 48), "w", c, 6)).toMatchObject({
			dx: 0,
			dy: 0,
		});
		expect(snapResize(r(98, 0, 50, 48), "w", c, 6)).toMatchObject({ dx: 2 });
	});

	test("a rotated rect snaps by its bounds", () => {
		const moving = r(0, 0, 100, 100, 45);
		const left = 50 - 50 * Math.SQRT2;
		const s = snapMove(
			moving,
			{ x: [{ value: -20, from: 0, to: 1 }], y: [] },
			6,
		);
		expect(s.dx).toBeCloseTo(-20 - left);
	});
});

describe("align and distribute", () => {
	const t = frozenDoc();
	const g = geometryOf(t);
	const pos = (tt: Template, k: string) => (getElement(tt, k) as Element).pos;

	test("aligns to the selection box", () => {
		const left = unwrap(align(t, ["0/0", "0/1"], g, "left"));
		expect(pos(left.template, "0/1")).toEqual({ x: 10, y: 100 });
		expect(pos(left.template, "0/0")).toEqual({ x: 10, y: 20 });
		const right = unwrap(align(t, ["0/0", "0/1"], g, "right"));
		expect(pos(right.template, "0/0")).toEqual({ x: 400, y: 20 });
		const bottom = unwrap(align(t, ["0/0", "0/1"], g, "bottom"));
		expect(pos(bottom.template, "0/0")).toEqual({ x: 10, y: 250 });
		const vc = unwrap(align(t, ["0/0", "0/1"], g, "vcenter"));
		expect(pos(vc.template, "0/0")).toEqual({ x: 10, y: 135 });
		const hc = unwrap(align(t, ["0/0", "0/1"], g, "hcenter"));
		expect(pos(hc.template, "0/0")).toEqual({ x: 205, y: 20 });
		const top = unwrap(align(t, ["0/0", "0/1"], g, "top"));
		expect(pos(top.template, "0/1")).toEqual({ x: 200, y: 20 });
	});

	test("one layer aligns to the artboard, in its parent's space", () => {
		const out = unwrap(align(t, ["0/1/0"], g, "right"));
		expect(pos(out.template, "0/1/0")).toEqual({ x: 750, y: 10 });
	});

	test("a rotated layer aligns by its painted bounds", () => {
		const out = unwrap(align(t, ["0/5"], g, "left"));
		const b = layerBounds("0/5", geometryOf(out.template));
		expect(b?.x).toBeCloseTo(0);
	});

	test("under a rotated parent the delta is turned into the parent's axes", () => {
		const out = unwrap(align(t, ["0/6/0"], g, "top"));
		expect(layerBounds("0/6/0", geometryOf(out.template))?.y).toBeCloseTo(0, 1);
	});

	test("distribute gives equal gaps and keeps the ends", () => {
		const t2 = unwrap(
			updateElement(
				unwrap(updateElement(t, "0/0", { pos: { x: 0, y: 0 } })).template,
				"0/5",
				{
					rotation: undefined,
					pos: { x: 900, y: 0 },
				},
			),
		).template;
		const g2 = geometryOf(t2);
		const out = unwrap(align(t2, ["0/0", "0/1", "0/5"], g2, "hdistribute"));
		// Widths 100 + 300 + 100 over 0..1000 → gaps of 250.
		expect(pos(out.template, "0/0")?.x).toBe(0);
		expect(pos(out.template, "0/1")?.x).toBe(350);
		expect(pos(out.template, "0/5")?.x).toBe(900);
		// Heights 50 + 40 + 200 over 0..300 → gaps of 5; the ends stay.
		const v = unwrap(align(t2, ["0/0", "0/1", "0/5"], g2, "vdistribute"));
		expect(pos(v.template, "0/0")?.y).toBe(0);
		expect(pos(v.template, "0/5")?.y).toBe(55);
		expect(pos(v.template, "0/1")?.y).toBe(100);
	});

	test("distribute needs three layers; auto-layout children are skipped", () => {
		expect(align(t, ["0/0", "0/1"], g, "hdistribute")).toMatchObject({
			ok: false,
			code: "too_few",
		});
		expect(align(t, ["0/3/0", "0/3/1"], g, "left")).toMatchObject({
			ok: false,
			code: "empty_selection",
		});
		const out = unwrap(align(t, ["0/3/0", "0/0", "0/1"], g, "left"));
		expect(out.keys).toEqual(["0/0", "0/1"]);
		expect(pos(out.template, "0/3/0")).toBeUndefined();
	});
});
