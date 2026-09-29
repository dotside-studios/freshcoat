import type { Element, Template } from "@freshcoat-js/coatfile";
import { DEFAULT_FILL, round2 } from "./factories";
import type { Point, Rect } from "./geometry";
import { uniqueId } from "./ids";

/** An anchor with its control handles, in template space. A corner point has
 *  none; a smooth one has both, mirrored. */
export type PenPoint = Point & { in?: Point; out?: Point };

export type PenPath = { points: PenPoint[]; closed: boolean };

type Segment = [Point, Point, Point, Point];

export const PEN_STROKE = { color: "#000000", width: 2 } as const;

/** A smooth point at `anchor` whose outgoing handle follows `drag`. */
export function smoothPoint(anchor: Point, drag: Point): PenPoint {
	return {
		x: anchor.x,
		y: anchor.y,
		out: { x: drag.x, y: drag.y },
		in: { x: 2 * anchor.x - drag.x, y: 2 * anchor.y - drag.y },
	};
}

/** `p` moved onto the nearest 45° line through `from`. */
export function constrain45(from: Point, p: Point): Point {
	const dx = p.x - from.x;
	const dy = p.y - from.y;
	const len = Math.hypot(dx, dy);
	const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
	return {
		x: from.x + Math.cos(angle) * len,
		y: from.y + Math.sin(angle) * len,
	};
}

function segments(path: PenPath): Segment[] {
	const pts = path.points;
	const out: Segment[] = [];
	const count = path.closed ? pts.length : pts.length - 1;
	for (let i = 0; i < count; i++) {
		const a = pts[i] as PenPoint;
		const b = pts[(i + 1) % pts.length] as PenPoint;
		out.push([a, a.out ?? a, b.in ?? b, b]);
	}
	return out;
}

const isLine = ([p0, c1, c2, p1]: Segment) =>
	c1.x === p0.x && c1.y === p0.y && c2.x === p1.x && c2.y === p1.y;

function extremaOf(a: number, b: number, c: number, d: number): number[] {
	// Roots of the derivative of the cubic Bézier through a, b, c, d.
	const qa = -a + 3 * b - 3 * c + d;
	const qb = 2 * (a - 2 * b + c);
	const qc = b - a;
	const roots: number[] = [];
	if (Math.abs(qa) < 1e-12) {
		if (Math.abs(qb) > 1e-12) roots.push(-qc / qb);
	} else {
		const disc = qb * qb - 4 * qa * qc;
		if (disc >= 0) {
			const s = Math.sqrt(disc);
			roots.push((-qb + s) / (2 * qa), (-qb - s) / (2 * qa));
		}
	}
	return roots.filter((t) => t > 0 && t < 1);
}

function at(a: number, b: number, c: number, d: number, t: number): number {
	const u = 1 - t;
	return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/** The painted bounds of a path: its anchors and its curves' extremes. */
export function penBounds(path: PenPath): Rect {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const p of path.points) {
		xs.push(p.x);
		ys.push(p.y);
	}
	for (const seg of segments(path)) {
		if (isLine(seg)) continue;
		const [p0, c1, c2, p1] = seg;
		for (const t of extremaOf(p0.x, c1.x, c2.x, p1.x))
			xs.push(at(p0.x, c1.x, c2.x, p1.x, t));
		for (const t of extremaOf(p0.y, c1.y, c2.y, p1.y))
			ys.push(at(p0.y, c1.y, c2.y, p1.y, t));
	}
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return {
		x,
		y,
		width: Math.max(...xs) - x,
		height: Math.max(...ys) - y,
		rotation: 0,
	};
}

const n = (v: number) => String(round2(v));

/** SVG path data for `path`, relative to `origin`. */
export function penPathData(path: PenPath, origin: Point = { x: 0, y: 0 }) {
	const first = path.points[0];
	if (!first) return "";
	const pt = (p: Point) => `${n(p.x - origin.x)} ${n(p.y - origin.y)}`;
	let d = `M${pt(first)}`;
	const segs = segments(path);
	segs.forEach((seg, i) => {
		const closing = path.closed && i === segs.length - 1;
		if (isLine(seg)) {
			if (!closing) d += `L${pt(seg[3])}`;
		} else d += `C${pt(seg[1])} ${pt(seg[2])} ${pt(seg[3])}`;
	});
	return path.closed ? `${d}Z` : d;
}

/**
 * The vector layer a finished path becomes, placed at its bounds: an open
 * path is stroked, a closed one filled as a new shape is. Null for a path
 * of fewer than two points.
 */
export function penElement(
	path: PenPath,
	t: Template,
	side: number,
): Element | null {
	if (path.points.length < 2) return null;
	const box = penBounds(path);
	const origin = { x: round2(box.x), y: round2(box.y) };
	return {
		id: uniqueId(t, side, "vector"),
		type: "vector",
		pos: origin,
		size: {
			width: Math.max(1, round2(box.width)),
			height: Math.max(1, round2(box.height)),
		},
		properties: path.closed
			? { d: penPathData(path, origin), fill: DEFAULT_FILL }
			: { d: penPathData(path, origin), stroke: { ...PEN_STROKE } },
	};
}
