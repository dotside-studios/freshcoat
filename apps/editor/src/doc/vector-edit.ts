import type { Template, VectorElement } from "@freshcoat-js/coatfile";
import { normalizePath } from "@freshcoat-js/engine/svg/path";
import { round2 } from "./factories";
import {
	centreOf,
	type LayerGeometry,
	type Point,
	parentOrigin,
	type Rect,
	rotatePoint,
} from "./geometry";
import { updateElement } from "./ops";
import { getElement } from "./path";
import {
	isLine,
	type PenPath,
	type PenPoint,
	penBounds,
	penPathData,
	type Segment,
	segments,
} from "./pen";
import type { OpResult } from "./result";

/** An anchor of an edited vector: its subpath and its place in it. */
export type PointRef = { path: number; index: number };

export type HandleSide = "in" | "out";

/** The spot on a path nearest a point. */
export type SegmentHit = {
	path: number;
	/** The segment's index: from the anchor of that index to the next. */
	segment: number;
	t: number;
	point: Point;
	distance: number;
};

const SAMPLES = 32;
const SAME = 1e-6;

const same = (a: Point, b: Point) =>
	Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME;

export const sameRef = (a: PointRef, b: PointRef) =>
	a.path === b.path && a.index === b.index;

// ── Reading and writing path data ────────────────────────────────────────────

/**
 * The subpaths of path data as editable anchors. Arcs and quadratics come
 * out as cubics, and a subpath of a single point is dropped.
 */
export function parseVectorPath(d: string): PenPath[] {
	const all: PenPath[] = [];
	let cur: PenPath | null = null;
	let start: Point = { x: 0, y: 0 };
	const resume = (): PenPath => {
		if (!cur) {
			cur = { points: [{ x: start.x, y: start.y }], closed: false };
			all.push(cur);
		}
		return cur;
	};
	for (const s of normalizePath(d)) {
		if (s.op === "M") {
			start = { x: s.x, y: s.y };
			cur = { points: [{ x: s.x, y: s.y }], closed: false };
			all.push(cur);
		} else if (s.op === "L") {
			resume().points.push({ x: s.x, y: s.y });
		} else if (s.op === "C") {
			const path = resume();
			const prev = path.points[path.points.length - 1] as PenPoint;
			const out = { x: s.x1, y: s.y1 };
			if (!same(out, prev)) prev.out = out;
			const point: PenPoint = { x: s.x, y: s.y };
			const into = { x: s.x2, y: s.y2 };
			if (!same(into, point)) point.in = into;
			path.points.push(point);
		} else if (cur) {
			const path: PenPath = cur;
			path.closed = true;
			const first = path.points[0] as PenPoint;
			const last = path.points[path.points.length - 1] as PenPoint;
			if (path.points.length > 1 && same(first, last)) {
				if (last.in) first.in = last.in;
				path.points.pop();
			}
			cur = null;
		}
	}
	return all.filter((p) => p.points.length >= 2);
}

/** Path data for subpaths, relative to `origin`. */
export function vectorPathData(
	paths: readonly PenPath[],
	origin: Point = { x: 0, y: 0 },
): string {
	return paths.map((p) => penPathData(p, origin)).join("");
}

/** The painted bounds of every subpath together. */
export function vectorBounds(paths: readonly PenPath[]): Rect | null {
	const boxes = paths.filter((p) => p.points.length > 0).map(penBounds);
	if (boxes.length === 0) return null;
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	return {
		x,
		y,
		width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
		height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
		rotation: 0,
	};
}

/**
 * `el` with its path replaced by `paths`, which are in the element's own
 * space. The box is refitted to the new bounds and the path re-based to it,
 * with the box's position turned about the old centre so a rotated layer
 * stays where it painted.
 */
export function withVectorPaths(
	el: VectorElement,
	paths: readonly PenPath[],
): VectorElement {
	const box = vectorBounds(paths);
	if (!box) return el;
	const origin = { x: round2(box.x), y: round2(box.y) };
	const size = {
		width: Math.max(1, round2(box.width)),
		height: Math.max(1, round2(box.height)),
	};
	const pos = el.pos ?? { x: 0, y: 0 };
	const was = el.size ?? { width: 0, height: 0 };
	const centre = centreOf({ ...pos, ...was });
	const at = rotatePoint(
		{
			x: pos.x + origin.x + size.width / 2,
			y: pos.y + origin.y + size.height / 2,
		},
		el.rotation ?? 0,
		centre,
	);
	return {
		...el,
		pos: {
			x: round2(at.x - size.width / 2),
			y: round2(at.y - size.height / 2),
		},
		size,
		properties: { ...el.properties, d: vectorPathData(paths, origin) },
	};
}

/** The template with the vector at `key` redrawn as `paths`. */
export function setVectorPaths(
	t: Template,
	key: string,
	paths: readonly PenPath[],
): OpResult {
	return updateElement(t, key, (el) =>
		"type" in el && el.type === "vector" ? withVectorPaths(el, paths) : el,
	);
}

// ── The element's frame ──────────────────────────────────────────────────────

/** The vector's own box in template space, as it paints. Null when `key` is
 *  not a vector. */
export function vectorFrame(
	t: Template,
	key: string,
	geometry: LayerGeometry,
): Rect | null {
	const el = getElement(t, key);
	if (!el || !("type" in el) || el.type !== "vector") return null;
	const o = parentOrigin(t, key, geometry);
	return {
		x: o.x + (el.pos?.x ?? 0),
		y: o.y + (el.pos?.y ?? 0),
		width: el.size?.width ?? 0,
		height: el.size?.height ?? 0,
		rotation: el.rotation ?? 0,
	};
}

/** A point in the vector's space, in template space. */
export function frameToWorld(frame: Rect, p: Point): Point {
	return rotatePoint(
		{ x: frame.x + p.x, y: frame.y + p.y },
		frame.rotation,
		centreOf(frame),
	);
}

/** A point in template space, in the vector's space. */
export function worldToFrame(frame: Rect, p: Point): Point {
	const q = rotatePoint(p, -frame.rotation, centreOf(frame));
	return { x: q.x - frame.x, y: q.y - frame.y };
}

/** `path` with every anchor and handle mapped through `fn`. */
export function mapPath(path: PenPath, fn: (p: Point) => Point): PenPath {
	return {
		closed: path.closed,
		points: path.points.map((p) => ({
			...fn(p),
			...(p.in ? { in: fn(p.in) } : {}),
			...(p.out ? { out: fn(p.out) } : {}),
		})),
	};
}

// ── Editing ──────────────────────────────────────────────────────────────────

function mapPoints(
	paths: readonly PenPath[],
	fn: (p: PenPoint, ref: PointRef) => PenPoint,
): PenPath[] {
	return paths.map((path, i) => ({
		...path,
		points: path.points.map((p, j) => fn(p, { path: i, index: j })),
	}));
}

const shifted = (p: Point, dx: number, dy: number): Point => ({
	x: p.x + dx,
	y: p.y + dy,
});

/** The anchors at `refs` moved by a delta, carrying their handles. */
export function movePoints(
	paths: readonly PenPath[],
	refs: readonly PointRef[],
	dx: number,
	dy: number,
): PenPath[] {
	return mapPoints(paths, (p, ref) => {
		if (!refs.some((r) => sameRef(r, ref))) return p;
		return {
			...shifted(p, dx, dy),
			...(p.in ? { in: shifted(p.in, dx, dy) } : {}),
			...(p.out ? { out: shifted(p.out, dx, dy) } : {}),
		};
	});
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Whether the handles run in opposite directions through the anchor. */
function isSmooth(p: PenPoint): boolean {
	if (!p.in || !p.out) return false;
	const a = { x: p.in.x - p.x, y: p.in.y - p.y };
	const b = { x: p.out.x - p.x, y: p.out.y - p.y };
	const la = Math.hypot(a.x, a.y);
	const lb = Math.hypot(b.x, b.y);
	if (la === 0 || lb === 0) return false;
	return (
		Math.abs(a.x * b.y - a.y * b.x) / (la * lb) < 0.03 &&
		a.x * b.x + a.y * b.y < 0
	);
}

/**
 * The handle `side` of the anchor at `ref` moved to `to`. A smooth point's
 * other handle stays opposite it, and keeps its length unless the two were
 * mirrored; `breakPair` moves the one handle alone.
 */
export function moveHandle(
	paths: readonly PenPath[],
	ref: PointRef,
	side: HandleSide,
	to: Point,
	breakPair = false,
): PenPath[] {
	const other: HandleSide = side === "in" ? "out" : "in";
	return mapPoints(paths, (p, r) => {
		if (!sameRef(r, ref)) return p;
		const next: PenPoint = { ...p, [side]: { x: to.x, y: to.y } };
		const old = p[side];
		const opposite = p[other];
		const len = dist(to, p);
		if (!breakPair && old && opposite && len > 0 && isSmooth(p)) {
			const was = dist(old, p);
			const oppositeLen = dist(opposite, p);
			const reach = Math.abs(was - oppositeLen) < 0.05 ? len : oppositeLen;
			next[other] = {
				x: p.x - ((to.x - p.x) / len) * reach,
				y: p.y - ((to.y - p.y) / len) * reach,
			};
		}
		return next;
	});
}

const towards = (from: Point, to: Point, length: number): Point => {
	const d = dist(from, to) || 1;
	return {
		x: from.x + ((to.x - from.x) / d) * length,
		y: from.y + ((to.y - from.y) / d) * length,
	};
};

function neighbours(path: PenPath, index: number) {
	const n = path.points.length;
	const wrap = path.closed;
	return {
		prev: path.points[index - 1] ?? (wrap ? path.points[n - 1] : undefined),
		next: path.points[index + 1] ?? (wrap ? path.points[0] : undefined),
	};
}

/**
 * The anchor at `ref` made a corner when it has handles, and smooth when it
 * has none: handles along the line between its neighbours, a third of the way
 * to each.
 */
export function toggleSmooth(
	paths: readonly PenPath[],
	ref: PointRef,
): PenPath[] {
	return paths.map((path, i) => {
		if (i !== ref.path) return path;
		const p = path.points[ref.index];
		if (!p) return path;
		let next: PenPoint;
		if (p.in || p.out) next = { x: p.x, y: p.y };
		else {
			const { prev, next: after } = neighbours(path, ref.index);
			const before = prev && !same(prev, p) ? prev : undefined;
			const ahead = after && !same(after, p) ? after : undefined;
			next = { x: p.x, y: p.y };
			if (before && ahead) {
				let tx = ahead.x - before.x;
				let ty = ahead.y - before.y;
				if (Math.hypot(tx, ty) < SAME) {
					tx = -(ahead.y - p.y);
					ty = ahead.x - p.x;
				}
				const m = Math.hypot(tx, ty) || 1;
				const out = dist(p, ahead) / 3;
				const into = dist(p, before) / 3;
				next.out = { x: p.x + (tx / m) * out, y: p.y + (ty / m) * out };
				next.in = { x: p.x - (tx / m) * into, y: p.y - (ty / m) * into };
			} else if (ahead) next.out = towards(p, ahead, dist(p, ahead) / 3);
			else if (before) next.in = towards(p, before, dist(p, before) / 3);
		}
		return {
			...path,
			points: path.points.map((q, j) => (j === ref.index ? next : q)),
		};
	});
}

/** `paths` without the anchors at `refs`; a subpath left with fewer than two
 *  anchors goes too. */
export function removePoints(
	paths: readonly PenPath[],
	refs: readonly PointRef[],
): PenPath[] {
	return paths
		.map((path, i) => ({
			...path,
			points: path.points.filter(
				(_, j) => !refs.some((r) => sameRef(r, { path: i, index: j })),
			),
		}))
		.filter((path) => path.points.length >= 2);
}

/** The cubic's point at `t`. */
function bezierAt([p0, c1, c2, p1]: Segment, t: number): Point {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
		y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
	};
}

const lerp = (a: Point, b: Point, t: number): Point => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

/** The spot on `seg` nearest `p`: its parameter and distance. */
function nearestOnSegment(seg: Segment, p: Point) {
	const line = isLine(seg);
	const steps = line ? 1 : SAMPLES;
	const at = (t: number) => (line ? lerp(seg[0], seg[3], t) : bezierAt(seg, t));
	let best = { t: 0, d: Number.POSITIVE_INFINITY };
	for (let i = 0; i < steps; i++) {
		const a = at(i / steps);
		const b = at((i + 1) / steps);
		const vx = b.x - a.x;
		const vy = b.y - a.y;
		const len = vx * vx + vy * vy;
		const u = len
			? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len))
			: 0;
		const d = dist(p, lerp(a, b, u));
		if (d < best.d) best = { t: (i + u) / steps, d };
	}
	if (!line) {
		let lo = Math.max(0, best.t - 1 / SAMPLES);
		let hi = Math.min(1, best.t + 1 / SAMPLES);
		for (let k = 0; k < 16; k++) {
			const m1 = lo + (hi - lo) / 3;
			const m2 = hi - (hi - lo) / 3;
			if (dist(p, at(m1)) < dist(p, at(m2))) hi = m2;
			else lo = m1;
		}
		best = { t: (lo + hi) / 2, d: dist(p, at((lo + hi) / 2)) };
	}
	return { t: best.t, point: at(best.t), distance: best.d };
}

/** The point on the paths nearest `p`, if within `reach`. */
export function nearestSegment(
	paths: readonly PenPath[],
	p: Point,
	reach: number,
): SegmentHit | null {
	let best: SegmentHit | null = null;
	paths.forEach((path, i) => {
		segments(path).forEach((seg, j) => {
			const hit = nearestOnSegment(seg, p);
			if (hit.distance <= reach && (!best || hit.distance < best.distance))
				best = { path: i, segment: j, ...hit };
		});
	});
	return best;
}

const handleOf = (anchor: Point, h: Point): Point | undefined =>
	same(anchor, h) ? undefined : h;

/**
 * A new anchor on the segment after anchor `segment` of subpath `path`, at
 * parameter `t`. A curve is split with de Casteljau's construction so the
 * shape is unchanged; a line stays a line. The new anchor's ref comes back.
 */
export function splitSegment(
	paths: readonly PenPath[],
	path: number,
	segment: number,
	t: number,
): { paths: PenPath[]; ref: PointRef } | null {
	const target = paths[path];
	const seg = target && segments(target)[segment];
	if (!target || !seg) return null;
	const [p0, c1, c2, p1] = seg;
	const a = target.points[segment] as PenPoint;
	const b = target.points[(segment + 1) % target.points.length] as PenPoint;
	let before: PenPoint = a;
	let middle: PenPoint;
	let after: PenPoint = b;
	if (isLine(seg)) middle = lerp(p0, p1, t);
	else {
		const q0 = lerp(p0, c1, t);
		const q1 = lerp(c1, c2, t);
		const q2 = lerp(c2, p1, t);
		const r0 = lerp(q0, q1, t);
		const r1 = lerp(q1, q2, t);
		const s = lerp(r0, r1, t);
		const out = handleOf(p0, q0);
		const into = handleOf(p1, q2);
		before = { x: a.x, y: a.y, ...(a.in ? { in: a.in } : {}) };
		if (out) before.out = out;
		after = { x: b.x, y: b.y, ...(b.out ? { out: b.out } : {}) };
		if (into) after.in = into;
		middle = { x: s.x, y: s.y };
		const mi = handleOf(s, r0);
		const mo = handleOf(s, r1);
		if (mi) middle.in = mi;
		if (mo) middle.out = mo;
	}
	const points = target.points.slice();
	const next = (segment + 1) % points.length;
	points[segment] = before;
	points[next] = after;
	points.splice(segment + 1, 0, middle);
	const out = paths.slice();
	out[path] = { ...target, points };
	return { paths: out, ref: { path, index: segment + 1 } };
}

/** `path` run backwards, its handles swapped to match. */
export function reversePath(path: PenPath): PenPath {
	const flip = (p: PenPoint): PenPoint => {
		const { in: into, out, ...anchor } = p;
		return {
			...anchor,
			...(out ? { in: out } : {}),
			...(into ? { out: into } : {}),
		};
	};
	const points = path.points.map(flip).reverse();
	if (!path.closed) return { ...path, points };
	// A closed path keeps its first anchor first.
	return {
		...path,
		points: [points[points.length - 1] as PenPoint, ...points.slice(0, -1)],
	};
}
