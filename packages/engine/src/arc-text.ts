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
};

// Four floats (scos, ssin, tx, ty) per glyph of each run.
export type ArcPlacement = Float32Array[][];

const ALIGN = { start: 0, center: 0.5, end: 1 } as const;

export function placeOnArc(
	lines: ArcLine[],
	arc: TextArc,
	cx: number,
	cy: number,
): ArcPlacement {
	const outside = arc.direction === "outside";
	const turn = outside ? 1 : -1;
	const theta0 = (arc.startAngle * Math.PI) / 180;
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
		const r = Math.max(arc.radius - turn * line.offset, 1e-3);
		const k =
			arc.sweep !== undefined && width > 0
				? ((arc.sweep * Math.PI) / 180) * (r / width)
				: 1;
		const lead = ALIGN[arc.align] * width * k;
		return line.runs.map((run) => {
			const pos = run.positions;
			const n = run.glyphs.length;
			const out = new Float32Array(n * 4);
			for (let i = 0; i < n; i++) {
				const x = pos[2 * i] as number;
				const dy = (pos[2 * i + 1] as number) - line.baseline;
				const next = pos[2 * i + 2];
				const half = next === undefined ? 0 : (next - x) / 2;
				const s = (x - x0 + half) * k - lead;
				const theta = theta0 + (turn * s) / r;
				const phi = outside ? theta : theta + Math.PI;
				const c = Math.cos(phi);
				const sn = Math.sin(phi);
				out[4 * i] = c;
				out[4 * i + 1] = sn;
				out[4 * i + 2] = cx + r * Math.sin(theta) - c * half - sn * dy;
				out[4 * i + 3] = cy - r * Math.cos(theta) - sn * half + c * dy;
			}
			return out;
		});
	});
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
