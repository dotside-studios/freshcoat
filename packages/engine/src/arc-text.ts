// Places shaped glyph runs along a circle (see TextArc). Each glyph turns about
// the middle of its advance, so the shaper's glyphs, ligatures and fallback
// faces are kept and only their positions change.

import type { GlyphRun } from "canvaskit-wasm";
import type { TextArc } from "./types";

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

// Four floats (scos, ssin, tx, ty) per glyph of each run.
export type ArcPlacement = Float32Array[][];

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

export function arcRings(lines: ArcLine[], arc: TextArc): ArcRing[] {
	const turn = arc.direction === "outside" ? 1 : -1;
	const theta0 = (arc.startAngle * Math.PI) / 180;
	return lines.map((line) => {
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
		const width = x1 > x0 ? x1 - x0 : 0;
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
	return lines.map((line, li) => {
		const { r, scale, angle } = rings[li] as ArcRing;
		return line.runs.map((run, ri) => {
			const pos = run.positions;
			const n = run.glyphs.length;
			const out = new Float32Array(n * 4);
			for (let i = 0; i < n; i++) {
				const x = pos[2 * i] as number;
				const dy = ((pos[2 * i + 1] as number) - line.baseline) * scale;
				const next = pos[2 * i + 2];
				const advance =
					next === undefined ? 0 : (next - x - spacingAt(line, ri, i)) / 2;
				const theta = angle(x + advance);
				const half = advance * scale;
				const phi = outside ? theta : theta + Math.PI;
				const c = Math.cos(phi) * scale;
				const sn = Math.sin(phi) * scale;
				const uc = Math.cos(phi);
				const us = Math.sin(phi);
				out[4 * i] = c;
				out[4 * i + 1] = sn;
				out[4 * i + 2] = cx + r * Math.sin(theta) - uc * half - us * dy;
				out[4 * i + 3] = cy - r * Math.cos(theta) - us * half + uc * dy;
			}
			return out;
		});
	});
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
