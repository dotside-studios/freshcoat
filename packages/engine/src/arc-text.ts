// Places shaped glyph runs along a curve: a circle (see TextArc) or a path
// (see TextPath). Each glyph turns about the middle of its advance, so the
// shaper's glyphs, ligatures and fallback faces are kept and only their
// positions change.

import type { GlyphRun } from "canvaskit-wasm";
import type { TextArc, TextPath } from "./types";

export type ArcLine = {
	runs: GlyphRun[];
	// The paragraph's baseline the run positions are measured from.
	baseline: number;
	// This line's baseline below the first line's, in the reading frame.
	offset: number;
	// Letter spacing after each glyph of each run, which the shaper adds to its
	// advance.
	spacing?: Float32Array[];
};

// Four floats (scos, ssin, tx, ty) per glyph of each run. A hidden glyph is
// all zeros.
export type ArcPlacement = Float32Array[][];

// A point on the curve and the unit tangent there.
export type Pose = { x: number; y: number; cos: number; sin: number };

// Where one line's glyph centres go: `at` maps a distance along the curve to a
// pose, or null where the glyph does not fit. A glyph centre `u` px into the
// line lands at `start + u * advance`, drawn at `glyph` times its size.
export type LineTrack = {
	at: (s: number) => Pose | null;
	start: number;
	advance: number;
	glyph: number;
};

// One line's circle: its baseline radius, the glyph scale `fit: "shrink"`
// applies, and the angle a shaped x lands at.
export type ArcRing = {
	r: number;
	scale: number;
	// The line's ink advance, without the spacing after its last glyph.
	width: number;
	circumference: number;
	// The radius asked for was below `minRadius` and was raised to it.
	clamped: boolean;
	// The line is longer than its circle and wraps over itself.
	overflow: boolean;
	angle: (x: number) => number;
};

const ALIGN = { start: 0, center: 0.5, end: 1 } as const;

const spacingAt = (line: ArcLine, ri: number, gi: number) =>
	(line.spacing?.[ri]?.[gi] as number | undefined) ?? 0;

// The line's first shaped x, its ink advance without the spacing after its
// last glyph, and its largest font size.
function lineExtent(line: ArcLine): { x0: number; width: number; em: number } {
	let x0 = Number.POSITIVE_INFINITY;
	let x1 = Number.NEGATIVE_INFINITY;
	let em = 0;
	line.runs.forEach((run, ri) => {
		const pos = run.positions;
		const n = run.glyphs.length;
		em = Math.max(em, run.size ?? 0);
		if (pos.length < 2) return;
		x0 = Math.min(x0, pos[0] as number);
		const end = pos[pos.length - 2] as number;
		x1 = Math.max(x1, n > 0 ? end - spacingAt(line, ri, n - 1) : end);
	});
	return { x0, width: x1 > x0 ? x1 - x0 : 0, em };
}

export function placeAlong(
	lines: ArcLine[],
	trackFor: (line: ArcLine, li: number) => LineTrack,
): ArcPlacement {
	return lines.map((line, li) => {
		const { x0 } = lineExtent(line);
		const track = trackFor(line, li);
		const g = track.glyph;
		return line.runs.map((run, ri) => {
			const pos = run.positions;
			const n = run.glyphs.length;
			const out = new Float32Array(n * 4);
			for (let i = 0; i < n; i++) {
				const x = pos[2 * i] as number;
				const dy = ((pos[2 * i + 1] as number) - line.baseline) * g;
				const next = pos[2 * i + 2];
				const advance =
					next === undefined ? 0 : (next - x - spacingAt(line, ri, i)) / 2;
				const p = track.at(track.start + (x + advance - x0) * track.advance);
				if (!p) continue;
				const half = advance * g;
				out[4 * i] = p.cos * g;
				out[4 * i + 1] = p.sin * g;
				out[4 * i + 2] = p.x - p.cos * half - p.sin * dy;
				out[4 * i + 3] = p.y - p.sin * half + p.cos * dy;
			}
			return out;
		});
	});
}

export function arcRings(lines: ArcLine[], arc: TextArc): ArcRing[] {
	const turn = arc.direction === "outside" ? 1 : -1;
	const theta0 = (arc.startAngle * Math.PI) / 180;
	return lines.map((line) => {
		const { x0, width, em } = lineExtent(line);
		const asked = arc.radius - turn * line.offset;
		const minRadius = Math.max(em, 1e-3);
		const r = Math.max(asked, minRadius);
		const circumference = 2 * Math.PI * r;
		const k =
			arc.sweep !== undefined && width > 0
				? ((arc.sweep * Math.PI) / 180) * (r / width)
				: 1;
		const over = arc.sweep === undefined && width > circumference;
		const scale = over && arc.fit === "shrink" ? circumference / width : 1;
		const lead = ALIGN[arc.align] * width * k * scale;
		return {
			r,
			scale,
			width,
			circumference,
			clamped: asked < minRadius,
			overflow: over && scale === 1,
			angle: (x) => theta0 + (turn * ((x - x0) * k * scale - lead)) / r,
		};
	});
}

export function placeOnArc(
	lines: ArcLine[],
	arc: TextArc,
	cx: number,
	cy: number,
): ArcPlacement {
	const outside = arc.direction === "outside";
	const rings = arcRings(lines, arc);
	return placeAlong(lines, (line, li) => {
		const { r, scale, angle } = rings[li] as ArcRing;
		const { x0 } = lineExtent(line);
		return {
			start: x0,
			advance: 1,
			glyph: scale,
			at: (x) => {
				const theta = angle(x);
				const phi = outside ? theta : theta + Math.PI;
				return {
					x: cx + r * Math.sin(theta),
					y: cy - r * Math.cos(theta),
					cos: Math.cos(phi),
					sin: Math.sin(phi),
				};
			},
		};
	});
}

// A measured path: its length, whether it is one closed contour, and the pose
// at a distance in [0, length].
export type PathMeasure = {
	length: number;
	closed: boolean;
	at: (d: number) => Pose;
};

// Glyphs are placed by their centres. On an open path a glyph whose centre
// falls off either end is hidden; on a closed one the text wraps past the
// start point and only what runs a whole lap is hidden.
export function placeOnPath(
	lines: ArcLine[],
	spec: TextPath,
	path: PathMeasure,
	ox = 0,
	oy = 0,
): ArcPlacement {
	const { length, closed } = path;
	const offset = spec.percent
		? (spec.startOffset / 100) * length
		: spec.startOffset;
	const right = spec.side === "right";
	const pose = (d: number): Pose => {
		if (!right) return path.at(d);
		const p = path.at(length - d);
		return { x: p.x, y: p.y, cos: -p.cos, sin: -p.sin };
	};
	return placeAlong(lines, (line) => {
		const start = offset - ALIGN[spec.align] * lineExtent(line).width;
		return {
			start,
			advance: 1,
			glyph: 1,
			at: (s) => {
				if (!(length > 0)) return null;
				let d = s;
				if (closed) {
					if (s - start > length) return null;
					d = ((s % length) + length) % length;
				} else if (s < 0 || s > length) return null;
				const p = pose(d);
				return {
					x: ox + p.x - p.sin * line.offset,
					y: oy + p.y + p.cos * line.offset,
					cos: p.cos,
					sin: p.sin,
				};
			},
		};
	});
}

export function isHidden(xforms: Float32Array, i: number): boolean {
	return xforms[4 * i] === 0 && xforms[4 * i + 1] === 0;
}

// The bounds of a stroke `width` wide along the circle of radius `r` between
// angles a0 and a1 (clockwise from 12 o'clock).
export function arcBandBounds(
	cx: number,
	cy: number,
	r: number,
	a0: number,
	a1: number,
	width: number,
): [number, number, number, number] {
	const lo = Math.min(a0, a1);
	const hi = Math.max(a0, a1);
	const angles = [lo, hi];
	const quarter = Math.PI / 2;
	for (let q = Math.ceil(lo / quarter); q * quarter < hi; q++)
		angles.push(q * quarter);
	const pad = width / 2;
	let l = Number.POSITIVE_INFINITY;
	let t = Number.POSITIVE_INFINITY;
	let rt = Number.NEGATIVE_INFINITY;
	let b = Number.NEGATIVE_INFINITY;
	for (const a of angles) {
		const x = cx + r * Math.sin(a);
		const y = cy - r * Math.cos(a);
		l = Math.min(l, x - pad);
		rt = Math.max(rt, x + pad);
		t = Math.min(t, y - pad);
		b = Math.max(b, y + pad);
	}
	return [l, t, rt, b];
}

export function rsxformBounds(
	xforms: Float32Array,
	box: [number, number, number, number],
): [number, number, number, number] | null {
	let l = Number.POSITIVE_INFINITY;
	let t = Number.POSITIVE_INFINITY;
	let r = Number.NEGATIVE_INFINITY;
	let b = Number.NEGATIVE_INFINITY;
	for (let i = 0; i + 3 < xforms.length; i += 4) {
		const c = xforms[i] as number;
		const s = xforms[i + 1] as number;
		const tx = xforms[i + 2] as number;
		const ty = xforms[i + 3] as number;
		if (c === 0 && s === 0) continue;
		for (const gx of [box[0], box[2]])
			for (const gy of [box[1], box[3]]) {
				const x = c * gx - s * gy + tx;
				const y = s * gx + c * gy + ty;
				l = Math.min(l, x);
				r = Math.max(r, x);
				t = Math.min(t, y);
				b = Math.max(b, y);
			}
	}
	return l <= r ? [l, t, r, b] : null;
}

// UTF-8 byte offset at which each span starts; run offsets count UTF-8 bytes.
export function spanByteStarts(texts: string[]): number[] {
	const encoder = new TextEncoder();
	const out: number[] = [];
	let at = 0;
	for (const t of texts) {
		out.push(at);
		at += encoder.encode(t).length;
	}
	return out;
}

export function spanAt(starts: number[], byte: number): number {
	let lo = 0;
	for (let i = 1; i < starts.length; i++)
		if ((starts[i] as number) <= byte) lo = i;
	return lo;
}
