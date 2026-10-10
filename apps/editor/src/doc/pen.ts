import type { Element, Template, VectorElement } from "@freshcoat-js/coatfile";
import { DEFAULT_FILL, round2 } from "./factories";
import {
	type Guide,
	type Point,
	type Rect,
	type SnapCandidates,
	snapMove,
} from "./geometry";
import { uniqueId } from "./ids";

/** An anchor with its control handles, in template space. A corner point has
 *  none; a smooth one has both, mirrored. */
export type PenPoint = Point & { in?: Point; out?: Point };

export type PenPath = { points: PenPoint[]; closed: boolean };

type Segment = [Point, Point, Point, Point];

export const PEN_STROKE = { color: "#000000", width: 2 } as const;

const CLOSE_PX = 8;

/** How close, in screen px, the pointer must come to the first anchor to
 *  close the path: wider for a finger or pen than for a mouse. */
export const penCloseRadius = (coarse: boolean) =>
	coarse ? CLOSE_PX * 2 : CLOSE_PX;

type VectorProps = VectorElement["properties"];

/** The look the pen last gave a layer: its stroke for open paths, its fill
 *  for closed ones. */
export type PenStyle = {
	stroke?: NonNullable<VectorProps["stroke"]>;
	fill?: NonNullable<VectorProps["fill"]>;
};

/** The paint a new path gets: the remembered style, else the defaults. */
export function penPaint(
	closed: boolean,
	style: PenStyle = {},
): Pick<VectorProps, "fill" | "stroke"> {
	return closed
		? { fill: style.fill ?? DEFAULT_FILL }
		: { stroke: style.stroke ?? { ...PEN_STROKE } };
}

/** A smooth point at `anchor` whose outgoing handle follows `drag`. */
export function smoothPoint(anchor: Point, drag: Point): PenPoint {
	return {
		x: anchor.x,
		y: anchor.y,
		out: { x: drag.x, y: drag.y },
		in: { x: 2 * anchor.x - drag.x, y: 2 * anchor.y - drag.y },
	};
}

/**
 * `prev` dragged to `drag`. The handles stay mirrored, unless `breakHandles`
 * is set: then only the outgoing one follows, and the incoming one stays
 * where `prev` had it (at the anchor for a corner).
 */
export function dragPoint(
	anchor: Point,
	drag: Point,
	prev: PenPoint | undefined,
	breakHandles: boolean,
): PenPoint {
	if (!breakHandles) return smoothPoint(anchor, drag);
	return {
		x: anchor.x,
		y: anchor.y,
		out: { x: drag.x, y: drag.y },
		...(prev?.in ? { in: prev.in } : {}),
	};
}

/**
 * The first point dragged as the path closes. Alt shapes only the closing
 * segment, mirroring the drag into the incoming handle.
 */
export function closePoint(
	anchor: Point,
	drag: Point,
	prev: PenPoint | undefined,
	breakHandles: boolean,
): PenPoint {
	if (!breakHandles) return smoothPoint(anchor, drag);
	return {
		x: anchor.x,
		y: anchor.y,
		...(prev?.out ? { out: prev.out } : {}),
		in: { x: 2 * anchor.x - drag.x, y: 2 * anchor.y - drag.y },
	};
}

/**
 * `p` pulled onto the nearest candidate line within `threshold`, with the
 * guides that show it. The anchors already placed are candidates too.
 */
export function snapPenPoint(
	p: Point,
	candidates: SnapCandidates,
	anchors: readonly Point[],
	threshold: number,
): { point: Point; guides: Guide[] } {
	const withAnchors: SnapCandidates = {
		x: [
			...candidates.x,
			...anchors.map((a) => ({ value: a.x, from: a.y, to: a.y })),
		],
		y: [
			...candidates.y,
			...anchors.map((a) => ({ value: a.y, from: a.x, to: a.x })),
		],
	};
	const snap = snapMove(
		{ x: p.x, y: p.y, width: 0, height: 0, rotation: 0 },
		withAnchors,
		threshold,
	);
	return { point: { x: p.x + snap.dx, y: p.y + snap.dy }, guides: snap.guides };
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

/** `path` with an axis it barely spans (under 1) made exactly flat, so the
 *  layer's 1 unit minimum size never stands in for a real extent. */
function flattened(path: PenPath, box: Rect): PenPath {
	const flatX = box.width < 1;
	const flatY = box.height < 1;
	if (!flatX && !flatY) return path;
	const snap = (p: Point): Point => ({
		x: flatX ? box.x : p.x,
		y: flatY ? box.y : p.y,
	});
	return {
		...path,
		points: path.points.map((p) => ({
			...snap(p),
			...(p.in ? { in: snap(p.in) } : {}),
			...(p.out ? { out: snap(p.out) } : {}),
		})),
	};
}

/**
 * The vector layer a finished path becomes, placed at its bounds: an open
 * path is stroked, a closed one filled as a new shape is, both with `style`
 * when given. Null for a path of fewer than two points.
 */
export function penElement(
	path: PenPath,
	t: Template,
	side: number,
	style?: PenStyle,
): Element | null {
	if (path.points.length < 2) return null;
	path = flattened(path, penBounds(path));
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
		properties: {
			d: penPathData(path, origin),
			...penPaint(path.closed, style),
		},
	};
}
