// Trimmed strokes: the part of an outline a stroke draws, as fractions of the
// outline's length. The trim cuts the outline first, so a dash pattern starts
// at the trimmed start and caps sit on the trimmed ends.

import type { CanvasKit, Path } from "canvaskit-wasm";
import type { Stroke } from "./types";

// `start` lies in [0, 1) and `end` after it by at most 1. An `end` past 1
// wraps through the outline's start.
export type StrokeTrim = { start: number; end: number };

// The stroke's trim, or null when it draws the whole outline. A start after
// the end swaps them; the offset rotates the drawn part along the outline.
export function strokeTrim(
	stroke: Pick<Stroke, "trimStart" | "trimEnd" | "trimOffset">,
): StrokeTrim | null {
	if (stroke.trimStart === undefined && stroke.trimEnd === undefined)
		return null;
	const a = clamp01(stroke.trimStart ?? 0);
	const b = clamp01(stroke.trimEnd ?? 1);
	const span = Math.abs(b - a);
	if (span >= 1) return null;
	const offset = Number.isFinite(stroke.trimOffset)
		? (stroke.trimOffset as number)
		: 0;
	const start = fract(Math.min(a, b) + offset);
	return { start, end: start + span };
}

// `path` cut to `trim`, or null when nothing is left. The caller owns and
// deletes the result. A wrapping trim of a single closed contour stays one
// piece, so its caps and joins match an unwrapped trim.
export function trimPath(
	ck: CanvasKit,
	path: Path,
	trim: StrokeTrim,
): Path | null {
	if (!(trim.end > trim.start)) return null;
	if (trim.end <= 1) return path.makeTrimmed(trim.start, trim.end, false);
	const loop = doubledLoop(ck, path);
	if (!loop) return path.makeTrimmed(trim.end - 1, trim.start, true);
	const out = loop.makeTrimmed(trim.start / 2, trim.end / 2, false);
	loop.delete();
	return out;
}

// A single closed contour traced twice as one open contour, or null for any
// other path.
function doubledLoop(ck: CanvasKit, path: Path): Path | null {
	const args = new Map([
		[ck.MOVE_VERB, 2],
		[ck.LINE_VERB, 2],
		[ck.QUAD_VERB, 4],
		[ck.CONIC_VERB, 5],
		[ck.CUBIC_VERB, 6],
		[ck.CLOSE_VERB, 0],
	]);
	const cmds = path.toCmds();
	const ops: number[][] = [];
	for (let i = 0; i < cmds.length; ) {
		const n = args.get(cmds[i] as number);
		if (n === undefined) return null;
		ops.push(Array.from(cmds.subarray(i, i + 1 + n)));
		i += 1 + n;
	}
	const first = ops[0];
	const last = ops[ops.length - 1];
	if (ops.length < 3 || first?.[0] !== ck.MOVE_VERB) return null;
	if (last?.[0] !== ck.CLOSE_VERB) return null;
	const body = ops.slice(1, -1);
	if (body.some((op) => op[0] === ck.MOVE_VERB || op[0] === ck.CLOSE_VERB))
		return null;
	const lap = [...body, [ck.LINE_VERB, first[1] ?? 0, first[2] ?? 0]];
	return ck.Path.MakeFromCmds([first, ...lap, ...lap].flat());
}

function clamp01(v: number): number {
	return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0;
}

function fract(v: number): number {
	const f = v - Math.floor(v);
	return f >= 1 ? 0 : f;
}
