import { MM_PER_INCH } from "@freshcoat-js/engine";
import {
	normalizePath,
	parseTransform,
	type Segment,
	transformPath,
} from "@freshcoat-js/engine/svg";
import { CUT_KINDS, CUT_STYLES, type ItemCuts } from "./cut";

/** How far a flattened curve may stray from the true one, in millimetres. */
export const DXF_CHORD_TOLERANCE_MM = 0.05;

type Point = [number, number];
type Polyline = { points: Point[]; closed: boolean };

const MAX_DEPTH = 16;

// A cubic lies within three quarters of its control points' distance from the
// chord, so a flat enough control polygon is a close enough chord.
function lineDistance(p: Point, a: Point, b: Point): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length = Math.hypot(dx, dy);
	if (length < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
	return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length;
}

function cubic(
	out: Point[],
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	depth = 0,
): void {
	const flat =
		0.75 * Math.max(lineDistance(p1, p0, p3), lineDistance(p2, p0, p3)) <=
		DXF_CHORD_TOLERANCE_MM;
	if (flat || depth >= MAX_DEPTH) {
		out.push(p3);
		return;
	}
	const mid = (a: Point, b: Point): Point => [
		(a[0] + b[0]) / 2,
		(a[1] + b[1]) / 2,
	];
	const a = mid(p0, p1);
	const b = mid(p1, p2);
	const c = mid(p2, p3);
	const ab = mid(a, b);
	const bc = mid(b, c);
	const m = mid(ab, bc);
	cubic(out, p0, a, ab, m, depth + 1);
	cubic(out, m, bc, c, p3, depth + 1);
}

const same = (a: Point, b: Point) =>
	Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** The subpaths of segments already in millimetres, curves flattened. */
function polylines(segments: Segment[]): Polyline[] {
	const out: Polyline[] = [];
	let points: Point[] = [];
	let start: Point = [0, 0];
	let at: Point = [0, 0];
	const end = (closed: boolean) => {
		const kept = points.filter(
			(p, i) => i === 0 || !same(p, points[i - 1] as Point),
		);
		const first = kept[0];
		if (
			closed &&
			first &&
			kept.length > 1 &&
			same(first, kept[kept.length - 1] as Point)
		)
			kept.pop();
		if (kept.length >= 2) out.push({ points: kept, closed });
		points = [];
	};
	const begin = () => {
		if (points.length === 0) points = [at];
	};
	for (const s of segments) {
		if (s.op === "M") {
			end(false);
			start = at = [s.x, s.y];
			points = [at];
		} else if (s.op === "L") {
			begin();
			at = [s.x, s.y];
			points.push(at);
		} else if (s.op === "C") {
			begin();
			const to: Point = [s.x, s.y];
			cubic(points, at, [s.x1, s.y1], [s.x2, s.y2], to);
			at = to;
		} else {
			end(true);
			at = start;
		}
	}
	end(false);
	return out;
}

const num = (n: number) => {
	const r = Math.round(n * 1e4) / 1e4;
	return String(Object.is(r, -0) ? 0 : r);
};

/**
 * A DXF of an item's cut lines, as ASCII R12 (AC1009): the oldest dialect
 * every cutter software reads, with no entity beyond the heavy POLYLINE,
 * VERTEX and SEQEND that R12 has for a polygon. LWPOLYLINE only exists from
 * R13 on, and a reader that stops at R12 skips it. Units are millimetres
 * (`$INSUNITS` 4, `$MEASUREMENT` 1) and y runs up, so the item's top is its
 * largest y. Curves are flattened to chords within `DXF_CHORD_TOLERANCE_MM`.
 * There is one layer per kind present, named for the kind and coloured as the
 * SVG and PDF are.
 */
export function cutDxf(cuts: ItemCuts, dpi: number): string {
	const scale = MM_PER_INCH / dpi;
	const matrix = parseTransform(
		`translate(0 ${cuts.height * scale}) scale(${scale} ${-scale})`,
	);
	const kinds = CUT_KINDS.filter((k) => cuts.lines.some((l) => l.kind === k));
	const drawn = kinds.flatMap((kind) =>
		cuts.lines
			.filter((l) => l.kind === kind)
			.flatMap((l) =>
				polylines(transformPath(normalizePath(l.path), matrix)).map((p) => ({
					layer: CUT_STYLES[kind].layer,
					...p,
				})),
			),
	);
	const all = drawn.flatMap((p) => p.points);
	const min: Point = [
		Math.min(0, ...all.map((p) => p[0])),
		Math.min(0, ...all.map((p) => p[1])),
	];
	const max: Point = [
		Math.max(0, ...all.map((p) => p[0])),
		Math.max(0, ...all.map((p) => p[1])),
	];

	const rows: (string | number)[] = [];
	const pair = (code: number, value: string | number) => rows.push(code, value);
	const point = (x: number, y: number) => {
		pair(10, num(x));
		pair(20, num(y));
		pair(30, 0);
	};

	pair(0, "SECTION");
	pair(2, "HEADER");
	pair(9, "$ACADVER");
	pair(1, "AC1009");
	pair(9, "$INSUNITS");
	pair(70, 4);
	pair(9, "$MEASUREMENT");
	pair(70, 1);
	pair(9, "$EXTMIN");
	point(...min);
	pair(9, "$EXTMAX");
	point(...max);
	pair(0, "ENDSEC");

	pair(0, "SECTION");
	pair(2, "TABLES");
	pair(0, "TABLE");
	pair(2, "LTYPE");
	pair(70, 1);
	pair(0, "LTYPE");
	pair(2, "CONTINUOUS");
	pair(70, 0);
	pair(3, "Solid line");
	pair(72, 65);
	pair(73, 0);
	pair(40, 0);
	pair(0, "ENDTAB");
	pair(0, "TABLE");
	pair(2, "LAYER");
	pair(70, kinds.length + 1);
	for (const [name, color] of [
		["0", 7],
		...kinds.map((k) => [CUT_STYLES[k].layer, CUT_STYLES[k].aci] as const),
	] as const) {
		pair(0, "LAYER");
		pair(2, name);
		pair(70, 0);
		pair(62, color);
		pair(6, "CONTINUOUS");
	}
	pair(0, "ENDTAB");
	pair(0, "ENDSEC");

	pair(0, "SECTION");
	pair(2, "ENTITIES");
	for (const p of drawn) {
		pair(0, "POLYLINE");
		pair(8, p.layer);
		pair(66, 1);
		point(0, 0);
		pair(70, p.closed ? 1 : 0);
		for (const [x, y] of p.points) {
			pair(0, "VERTEX");
			pair(8, p.layer);
			point(x, y);
		}
		pair(0, "SEQEND");
		pair(8, p.layer);
	}
	pair(0, "ENDSEC");
	pair(0, "EOF");
	const lines: string[] = [];
	for (let i = 0; i < rows.length; i += 2)
		lines.push(String(rows[i]).padStart(3), String(rows[i + 1]));
	return `${lines.join("\n")}\n`;
}
