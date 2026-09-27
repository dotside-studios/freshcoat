import {
	linearGradientAngle,
	linearGradientPoints,
} from "@freshcoat-js/coatfile";
import {
	ancestorRects,
	centreOf,
	type LayerGeometry,
	type Point,
	type Rect,
	rotatePoint,
} from "~/doc/geometry";
import type { Gradient } from "~/panels/design/fills";

/**
 * Where a gradient sits on the canvas, matching the coat engine's `shaderFor`:
 * the shader is laid out in the layer's own unrotated box (fractions of its
 * width and height, a radial radius in units of its longest side, angles in
 * its pixel space), and the canvas then turns that box about its centre and
 * about each ancestor's, as `worldCorners` does.
 */

export type Vec = [number, number];

/** A layer's box and the boxes whose rotations carry it, nearest first. */
export type GradientFrame = { rect: Rect; ancestors: Rect[] };

export type HandlePart =
	| "from"
	| "to"
	| "center"
	| "radius"
	| "radiusY"
	| "rotation";

export type GradientHandles = {
	kind: Gradient["kind"];
	/** Draggable points in template units. */
	points: Partial<Record<HandlePart, Point>>;
	/** The line stops sit on (linear, radial), where a click adds a stop. */
	line?: [Point, Point];
	/** Radial's secondary axis, drawn as a guide. */
	guide?: [Point, Point];
	/** Angular's stop circle, in template units. */
	ring?: { center: Point; radius: number };
	stops: { index: number; at: Point; color: string }[];
};

export type DragOptions = {
	/** Snap the direction to 15-degree steps. */
	snap?: boolean;
};

const SNAP_DEG = 15;
/** The angular rotation handle's distance, as a multiple of its ring. */
export const ANGULAR_HANDLE_REACH = 1.5;

export function frameOf(
	key: string,
	geometry: LayerGeometry,
): GradientFrame | null {
	const box = geometry.get(key);
	if (!box || box.rect.width <= 0 || box.rect.height <= 0) return null;
	return { rect: box.rect, ancestors: ancestorRects(key, geometry) };
}

/** The frame's total rotation: its own plus every ancestor's. */
export function frameRotation(f: GradientFrame): number {
	return f.ancestors.reduce((sum, a) => sum + a.rotation, f.rect.rotation);
}

// ── Box, local and template space ────────────────────────────────────────────

/** A point in the layer's unrotated box, relative to its top-left, in
 *  template units, to template space. */
export function localToWorld(f: GradientFrame, l: Point): Point {
	let p = rotatePoint(
		{ x: f.rect.x + l.x, y: f.rect.y + l.y },
		f.rect.rotation,
		centreOf(f.rect),
	);
	for (const a of f.ancestors) p = rotatePoint(p, a.rotation, centreOf(a));
	return p;
}

export function worldToLocal(f: GradientFrame, p: Point): Point {
	let q = p;
	for (let i = f.ancestors.length - 1; i >= 0; i--) {
		const a = f.ancestors[i] as Rect;
		q = rotatePoint(q, -a.rotation, centreOf(a));
	}
	q = rotatePoint(q, -f.rect.rotation, centreOf(f.rect));
	return { x: q.x - f.rect.x, y: q.y - f.rect.y };
}

/** A normalised box point (0..1 across the layer) to template space. */
export function boxToWorld(f: GradientFrame, u: Vec): Point {
	return localToWorld(f, { x: u[0] * f.rect.width, y: u[1] * f.rect.height });
}

export function worldToBox(f: GradientFrame, p: Point): Vec {
	const l = worldToLocal(f, p);
	return [l.x / f.rect.width, l.y / f.rect.height];
}

const toLocal = (f: GradientFrame, u: Vec): Point => ({
	x: u[0] * f.rect.width,
	y: u[1] * f.rect.height,
});

const toBox = (f: GradientFrame, l: Point): Vec => [
	l.x / f.rect.width,
	l.y / f.rect.height,
];

const longest = (f: GradientFrame) => Math.max(f.rect.width, f.rect.height);
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const snapAngle = (d: number) => Math.round(d / SNAP_DEG) * SNAP_DEG;

/** Degrees in [0, 360). */
export function wrapDegrees(d: number): number {
	const w = d % 360;
	return w < 0 ? w + 360 : w === 0 ? 0 : w;
}

// ── Reading a gradient ───────────────────────────────────────────────────────

/** A linear gradient's endpoints in box fractions, derived from `angle` when
 *  it has none, exactly as `resolveFill` does. */
export function linearPoints(g: Extract<Gradient, { kind: "linear" }>): {
	from: Vec;
	to: Vec;
} {
	if (g.from && g.to) return { from: g.from, to: g.to };
	return linearGradientPoints(g.angle);
}

const centerOf = (g: Gradient): Vec =>
	g.kind === "linear" ? [0.5, 0.5] : (g.center ?? [0.5, 0.5]);

type Radial = Extract<Gradient, { kind: "radial" }>;

/** Radial's axes in local units: the primary end's offset from the centre
 *  and the secondary's, as the coat engine's local matrix places them. */
function radialAxes(
	g: Radial,
	f: GradientFrame,
): { primary: Point; secondary: Point } {
	const L = longest(f);
	const rx = (g.radius ?? 0.5) * L;
	const ry = (g.radiusY ?? g.radius ?? 0.5) * L;
	const r = rad(g.rotation ?? 0);
	return {
		primary: { x: Math.cos(r) * rx, y: Math.sin(r) * rx },
		secondary: { x: -Math.sin(r) * ry, y: Math.cos(r) * ry },
	};
}

/** The unit direction, in template space, of an angle measured clockwise
 *  from twelve o'clock in the layer's own frame. */
function clockDirection(f: GradientFrame, angle: number): Point {
	const a = rad(angle + frameRotation(f));
	return { x: Math.sin(a), y: -Math.cos(a) };
}

/**
 * Every handle of a gradient in template units. `ring` is the angular stop
 * circle's radius in template units, which the overlay sets from a fixed
 * screen distance.
 */
export function gradientHandles(
	g: Gradient,
	f: GradientFrame,
	opts: { ring: number },
): GradientHandles {
	if (g.kind === "linear") {
		const { from, to } = linearPoints(g);
		const a = boxToWorld(f, from);
		const b = boxToWorld(f, to);
		return {
			kind: g.kind,
			points: { from: a, to: b },
			line: [a, b],
			stops: g.stops.map((s, index) => ({
				index,
				color: s.color,
				at: {
					x: a.x + (b.x - a.x) * s.offset,
					y: a.y + (b.y - a.y) * s.offset,
				},
			})),
		};
	}
	const c = toLocal(f, centerOf(g));
	const center = localToWorld(f, c);
	if (g.kind === "radial") {
		const { primary, secondary } = radialAxes(g, f);
		const end = localToWorld(f, { x: c.x + primary.x, y: c.y + primary.y });
		const endY = localToWorld(f, {
			x: c.x + secondary.x,
			y: c.y + secondary.y,
		});
		return {
			kind: g.kind,
			points: { center, radius: end, radiusY: endY },
			line: [center, end],
			guide: [center, endY],
			stops: g.stops.map((s, index) => ({
				index,
				color: s.color,
				at: {
					x: center.x + (end.x - center.x) * s.offset,
					y: center.y + (end.y - center.y) * s.offset,
				},
			})),
		};
	}
	const rotation = g.rotation ?? 0;
	const dir = clockDirection(f, rotation);
	const reach = opts.ring * ANGULAR_HANDLE_REACH;
	return {
		kind: g.kind,
		points: {
			center,
			rotation: { x: center.x + dir.x * reach, y: center.y + dir.y * reach },
		},
		ring: { center, radius: opts.ring },
		stops: g.stops.map((s, index) => {
			const d = clockDirection(f, rotation + s.offset * 360);
			return {
				index,
				color: s.color,
				at: {
					x: center.x + d.x * opts.ring,
					y: center.y + d.y * opts.ring,
				},
			};
		}),
	};
}

// ── Dragging ─────────────────────────────────────────────────────────────────

/**
 * The gradient with `part` moved to `world`. The inverse of
 * `gradientHandles`: a point handle dragged to a spot is drawn at that spot,
 * except where the part has fewer degrees of freedom (the secondary radius
 * follows only its axis, the angular rotation only its direction).
 */
export function dragHandle(
	g: Gradient,
	f: GradientFrame,
	part: HandlePart,
	world: Point,
	opts: DragOptions = {},
): Gradient {
	const l = worldToLocal(f, world);
	if (g.kind === "linear") {
		if (part !== "from" && part !== "to") return g;
		const pts = linearPoints(g);
		const other = toLocal(f, part === "from" ? pts.to : pts.from);
		let d = { x: l.x - other.x, y: l.y - other.y };
		if (opts.snap) {
			const a = rad(snapAngle(deg(Math.atan2(d.y, d.x))));
			const u = { x: Math.cos(a), y: Math.sin(a) };
			const len = d.x * u.x + d.y * u.y;
			d = { x: u.x * len, y: u.y * len };
		}
		if (Math.hypot(d.x, d.y) < 1e-6) return g;
		const moved = toBox(f, { x: other.x + d.x, y: other.y + d.y });
		const fixed = toBox(f, other);
		const from = part === "from" ? moved : fixed;
		const to = part === "to" ? moved : fixed;
		return { ...g, from, to, angle: linearGradientAngle(from, to) };
	}
	if (part === "center") return { ...g, center: toBox(f, l) } as Gradient;
	const c = toLocal(f, centerOf(g));
	const d = { x: l.x - c.x, y: l.y - c.y };
	if (g.kind === "radial") {
		const L = longest(f);
		if (part === "radius") {
			let rotation = deg(Math.atan2(d.y, d.x));
			let length = Math.hypot(d.x, d.y);
			if (opts.snap) {
				rotation = snapAngle(rotation);
				const r = rad(rotation);
				length = Math.max(0, d.x * Math.cos(r) + d.y * Math.sin(r));
			}
			return { ...g, radius: length / L, rotation: wrapDegrees(rotation) };
		}
		if (part === "radiusY") {
			const r = rad(g.rotation ?? 0);
			const along = Math.abs(-d.x * Math.sin(r) + d.y * Math.cos(r));
			return { ...g, radiusY: along / L };
		}
		return g;
	}
	if (part !== "rotation") return g;
	if (Math.hypot(d.x, d.y) < 1e-9) return g;
	let rotation = deg(Math.atan2(d.x, -d.y));
	if (opts.snap) rotation = snapAngle(rotation);
	return { ...g, rotation: wrapDegrees(rotation) };
}

/** The stop offset a template-space point projects to: along a linear
 *  gradient's line, along a radial one's primary radius, or around an
 *  angular one's centre. Clamped to 0..1. */
export function stopOffsetAt(
	g: Gradient,
	f: GradientFrame,
	world: Point,
): number {
	const l = worldToLocal(f, world);
	const clamp = (t: number) => Math.min(1, Math.max(0, t));
	if (g.kind === "linear") {
		const { from, to } = linearPoints(g);
		const a = toLocal(f, from);
		const b = toLocal(f, to);
		const ab = { x: b.x - a.x, y: b.y - a.y };
		const len2 = ab.x * ab.x + ab.y * ab.y;
		if (len2 < 1e-12) return 0;
		return clamp(((l.x - a.x) * ab.x + (l.y - a.y) * ab.y) / len2);
	}
	const c = toLocal(f, centerOf(g));
	const d = { x: l.x - c.x, y: l.y - c.y };
	if (g.kind === "radial") {
		const { primary } = radialAxes(g, f);
		const len2 = primary.x * primary.x + primary.y * primary.y;
		if (len2 < 1e-12) return 0;
		return clamp((d.x * primary.x + d.y * primary.y) / len2);
	}
	const angle = deg(Math.atan2(d.x, -d.y)) - (g.rotation ?? 0);
	return wrapDegrees(angle) / 360;
}

/** Parses a handle name, `grad:<fillIndex>:<part>`, where a part is a
 *  `HandlePart`, `stop:<index>` or `line`. */
export function parseGradientHandle(
	name: string,
):
	| { index: number; part: HandlePart }
	| { index: number; part: "stop"; stop: number }
	| { index: number; part: "line" }
	| null {
	const [head, idx, part, stop] = name.split(":");
	if (head !== "grad" || idx === undefined || part === undefined) return null;
	const index = Number(idx);
	if (!Number.isInteger(index) || index < 0) return null;
	if (part === "stop") {
		const s = Number(stop);
		return Number.isInteger(s) && s >= 0 ? { index, part, stop: s } : null;
	}
	if (part === "line") return { index, part };
	if (
		part === "from" ||
		part === "to" ||
		part === "center" ||
		part === "radius" ||
		part === "radiusY" ||
		part === "rotation"
	)
		return { index, part };
	return null;
}
