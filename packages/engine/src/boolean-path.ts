import type { CanvasKit, Path } from "canvaskit-wasm";
import { roundCorners } from "./round-corners";

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

type Radii = [number, number, number, number];

/** One shape in a boolean operation, placed in the space of the result. A
 *  rect is `size` wide and high; a path is drawn at its own coordinates. */
export type BooleanOperand = {
	pos?: { x: number; y: number };
	size?: { width: number; height: number };
	/** Degrees, about the centre of `size`. */
	rotation?: number;
} & (
	| { kind: "rect"; cornerRadius?: number | number[] }
	| {
			kind: "path";
			d: string;
			cornerRadius?: number;
			fillRule?: "nonzero" | "evenodd";
	  }
);

export type BooleanShape = {
	/** Path data relative to the result's box, or to `origin` when given. */
	d: string;
	fillRule?: "evenodd";
	box: { x: number; y: number; width: number; height: number };
};

function round2(n: number): number {
	const r = Math.round(n * 100) / 100;
	return r === 0 ? 0 : r;
}

function radiiOf(
	corner: number | number[] | undefined,
	width: number,
	height: number,
): Radii {
	const r = corner ?? 0;
	const list = (typeof r === "number" ? [r, r, r, r] : r) as Radii;
	const max = Math.min(width, height) / 2;
	return list.map((v) => Math.max(0, Math.min(max, v))) as Radii;
}

/** A shape's outline in its own box, fill rule applied. */
function localPath(ck: CanvasKit, shape: BooleanOperand): Path | null {
	if (shape.kind === "path") {
		const path = ck.Path.MakeFromSVGString(
			roundCorners(shape.d, shape.cornerRadius ?? 0),
		);
		if (path && shape.fillRule === "evenodd")
			path.setFillType(ck.FillType.EvenOdd);
		return path;
	}
	const w = shape.size?.width ?? 0;
	const h = shape.size?.height ?? 0;
	const [tl, tr, br, bl] = radiiOf(shape.cornerRadius, w, h);
	const builder = new ck.PathBuilder();
	builder.addRRect(Float32Array.of(0, 0, w, h, tl, tl, tr, tr, br, br, bl, bl));
	const path = builder.detach();
	builder.delete();
	return path;
}

/** A shape's outline in its parent's space: moved to its position and turned
 *  about its centre. */
function shapePath(ck: CanvasKit, shape: BooleanOperand): Path | null {
	const local = localPath(ck, shape);
	if (!local) return null;
	const x = shape.pos?.x ?? 0;
	const y = shape.pos?.y ?? 0;
	const cx = (shape.size?.width ?? 0) / 2;
	const cy = (shape.size?.height ?? 0) / 2;
	const a = ((shape.rotation ?? 0) * Math.PI) / 180;
	const cos = Math.cos(a);
	const sin = Math.sin(a);
	const builder = new ck.PathBuilder(local);
	builder.transform([
		cos,
		-sin,
		x + cx - cos * cx + sin * cy,
		sin,
		cos,
		y + cy - sin * cx - cos * cy,
		0,
		0,
		1,
	]);
	const path = builder.detach();
	path.setFillType(local.getFillType());
	builder.delete();
	local.delete();
	return path;
}

/**
 * Combines shapes, bottom-most first, as Figma does: union and exclude fold
 * every shape together, intersect keeps what all of them cover, and subtract
 * takes the rest away from the bottom-most. Null when nothing is left. The
 * path data is relative to the result's box unless `origin` names another
 * point.
 */
export function combineShapes(
	ck: CanvasKit,
	shapes: readonly BooleanOperand[],
	op: BooleanOp,
	origin?: { x: number; y: number },
): BooleanShape | null {
	const paths = shapes.map((shape) => shapePath(ck, shape));
	const made: Path[] = [];
	try {
		if (paths.length === 0 || paths.some((p) => !p)) return null;
		const kind = {
			union: ck.PathOp.Union,
			subtract: ck.PathOp.Difference,
			intersect: ck.PathOp.Intersect,
			exclude: ck.PathOp.XOR,
		}[op];
		let acc = paths[0] as Path;
		for (const next of paths.slice(1)) {
			const out = ck.Path.MakeFromOp(acc, next as Path, kind);
			if (!out) return null;
			made.push(out);
			acc = out;
		}
		const [l, t, r, b] = acc.computeTightBounds();
		if (
			acc.isEmpty() ||
			l === undefined ||
			t === undefined ||
			r === undefined ||
			b === undefined
		)
			return null;
		const x = round2(l);
		const y = round2(t);
		const evenOdd = acc.getFillType() === ck.FillType.EvenOdd;
		return {
			d: pathData(ck, acc.toCmds(), origin?.x ?? x, origin?.y ?? y),
			...(evenOdd ? { fillRule: "evenodd" as const } : {}),
			box: {
				x,
				y,
				width: Math.max(1, round2(r - x)),
				height: Math.max(1, round2(b - y)),
			},
		};
	} finally {
		for (const p of [...paths, ...made]) p?.delete();
	}
}

/**
 * SVG path data for CanvasKit's path commands, moved by (-dx, -dy). Each
 * conic, which is how Skia keeps an arc, becomes one cubic.
 */
function pathData(
	ck: CanvasKit,
	cmds: Float32Array,
	dx: number,
	dy: number,
): string {
	const n = (v: number) => String(round2(v));
	const pt = (x: number, y: number) => `${n(x - dx)} ${n(y - dy)}`;
	let d = "";
	let cx = 0;
	let cy = 0;
	let i = 0;
	const next = () => cmds[i++] as number;
	while (i < cmds.length) {
		const verb = next();
		if (verb === ck.MOVE_VERB || verb === ck.LINE_VERB) {
			cx = next();
			cy = next();
			d += `${verb === ck.MOVE_VERB ? "M" : "L"}${pt(cx, cy)}`;
		} else if (verb === ck.QUAD_VERB) {
			const [x1, y1, x2, y2] = [next(), next(), next(), next()];
			d += `Q${pt(x1, y1)} ${pt(x2, y2)}`;
			cx = x2;
			cy = y2;
		} else if (verb === ck.CONIC_VERB) {
			const [x1, y1, x2, y2, w] = [next(), next(), next(), next(), next()];
			const k = (4 * w) / (3 * (1 + w));
			d += `C${pt(cx + k * (x1 - cx), cy + k * (y1 - cy))} ${pt(
				x2 + k * (x1 - x2),
				y2 + k * (y1 - y2),
			)} ${pt(x2, y2)}`;
			cx = x2;
			cy = y2;
		} else if (verb === ck.CUBIC_VERB) {
			const [x1, y1, x2, y2, x3, y3] = [
				next(),
				next(),
				next(),
				next(),
				next(),
				next(),
			];
			d += `C${pt(x1, y1)} ${pt(x2, y2)} ${pt(x3, y3)}`;
			cx = x3;
			cy = y3;
		} else if (verb === ck.CLOSE_VERB) d += "Z";
		else break;
	}
	return d;
}
