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
};

// Four floats (scos, ssin, tx, ty) per glyph of each run. A hidden glyph is
// all zeros.
export type ArcPlacement = Float32Array[][];

// A point on the curve and the unit tangent there.
export type Pose = { x: number; y: number; cos: number; sin: number };

// Where one line's glyph centres go: `at` maps a distance along the curve to a
// pose, or null where the glyph does not fit. A glyph `u` px into the line
// lands at `start + u * scale`.
export type LineTrack = {
	at: (s: number) => Pose | null;
	start: number;
	scale: number;
};

const ALIGN = { start: 0, center: 0.5, end: 1 } as const;

export function placeAlong(
	lines: ArcLine[],
	trackFor: (line: ArcLine, width: number) => LineTrack,
): ArcPlacement {
	return lines.map((line) => {
		let x0 = Number.POSITIVE_INFINITY;
		let x1 = Number.NEGATIVE_INFINITY;
		for (const run of line.runs) {
			const pos = run.positions;
			if (pos.length < 2) continue;
			x0 = Math.min(x0, pos[0] as number);
			x1 = Math.max(x1, pos[pos.length - 2] as number);
		}
		const width = x1 > x0 ? x1 - x0 : 0;
		const track = trackFor(line, width);
		return line.runs.map((run) => {
			const pos = run.positions;
			const n = run.glyphs.length;
			const out = new Float32Array(n * 4);
			for (let i = 0; i < n; i++) {
				const x = pos[2 * i] as number;
				const dy = (pos[2 * i + 1] as number) - line.baseline;
				const next = pos[2 * i + 2];
				const half = next === undefined ? 0 : (next - x) / 2;
				const p = track.at(track.start + (x - x0 + half) * track.scale);
				if (!p) continue;
				const { cos: c, sin: sn } = p;
				out[4 * i] = c;
				out[4 * i + 1] = sn;
				out[4 * i + 2] = p.x - c * half - sn * dy;
				out[4 * i + 3] = p.y - sn * half + c * dy;
			}
			return out;
		});
	});
}

export function placeOnArc(
	lines: ArcLine[],
	arc: TextArc,
	cx: number,
	cy: number,
): ArcPlacement {
	const outside = arc.direction === "outside";
	const turn = outside ? 1 : -1;
	const theta0 = (arc.startAngle * Math.PI) / 180;
	return placeAlong(lines, (line, width) => {
		const r = Math.max(arc.radius - turn * line.offset, 1e-3);
		const k =
			arc.sweep !== undefined && width > 0
				? ((arc.sweep * Math.PI) / 180) * (r / width)
				: 1;
		return {
			start: -ALIGN[arc.align] * width * k,
			scale: k,
			at: (s) => {
				const theta = theta0 + (turn * s) / r;
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
	const offset = spec.percent ? (spec.startOffset / 100) * length : spec.startOffset;
	const right = spec.side === "right";
	const pose = (d: number): Pose => {
		if (!right) return path.at(d);
		const p = path.at(length - d);
		return { x: p.x, y: p.y, cos: -p.cos, sin: -p.sin };
	};
	return placeAlong(lines, (line, width) => {
		const start = offset - ALIGN[spec.align] * width;
		return {
			start,
			scale: 1,
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
