import { applyMatrix, type Matrix } from "./matrix";

/** Path data reduced to absolute moves, lines, cubics and closes. */
export type Segment =
	| { op: "M"; x: number; y: number }
	| { op: "L"; x: number; y: number }
	| {
			op: "C";
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			x: number;
			y: number;
	  }
	| { op: "Z" };

export type Box = { x: number; y: number; width: number; height: number };

const ARITY: Record<string, number> = {
	M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const SEPARATORS = /[\s,]*/y;

/** Reads path data. Like a browser, it keeps everything before the first
 *  error rather than dropping the whole path. */
export function normalizePath(d: string): Segment[] {
	const out: Segment[] = [];
	let i = 0;
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let cmd = "";
	// The last control point, reflected by S and T.
	let lastC: [number, number] | null = null;
	let lastQ: [number, number] | null = null;

	const skip = () => {
		SEPARATORS.lastIndex = i;
		SEPARATORS.exec(d);
		i = SEPARATORS.lastIndex;
	};
	const readNumber = (): number | null => {
		NUMBER.lastIndex = i;
		const m = NUMBER.exec(d);
		if (!m) return null;
		i = NUMBER.lastIndex;
		skip();
		return Number(m[0]);
	};
	const readFlag = (): number | null => {
		const ch = d[i];
		if (ch !== "0" && ch !== "1") return null;
		i++;
		skip();
		return ch === "1" ? 1 : 0;
	};
	const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number) => {
		out.push({ op: "C", x1, y1, x2, y2, x: ex, y: ey });
		x = ex;
		y = ey;
	};

	skip();
	while (i < d.length) {
		const ch = d[i] as string;
		if (/[a-zA-Z]/.test(ch)) {
			if (!(ch.toUpperCase() in ARITY)) break;
			cmd = ch;
			i++;
			skip();
		} else if (!cmd || cmd === "Z" || cmd === "z") break;
		const upper = cmd.toUpperCase();
		const rel = cmd !== upper;
		if (upper === "Z") {
			out.push({ op: "Z" });
			x = startX;
			y = startY;
			lastC = lastQ = null;
			continue;
		}
		const args: number[] = [];
		for (let k = 0; k < (ARITY[upper] ?? 0); k++) {
			const v = upper === "A" && (k === 3 || k === 4) ? readFlag() : readNumber();
			if (v === null) return out;
			args.push(v);
		}
		const ox = rel ? x : 0;
		const oy = rel ? y : 0;
		const a = args as number[] & { [k: number]: number };
		let nextC: [number, number] | null = null;
		let nextQ: [number, number] | null = null;
		switch (upper) {
			case "M":
				x = startX = a[0] + ox;
				y = startY = a[1] + oy;
				out.push({ op: "M", x, y });
				// Further pairs after a move are lines.
				cmd = rel ? "l" : "L";
				break;
			case "L":
				x = a[0] + ox;
				y = a[1] + oy;
				out.push({ op: "L", x, y });
				break;
			case "H":
				x = a[0] + ox;
				out.push({ op: "L", x, y });
				break;
			case "V":
				y = a[0] + oy;
				out.push({ op: "L", x, y });
				break;
			case "C":
				nextC = [a[2] + ox, a[3] + oy];
				cubic(a[0] + ox, a[1] + oy, nextC[0], nextC[1], a[4] + ox, a[5] + oy);
				break;
			case "S": {
				const [cx, cy] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
				nextC = [a[0] + ox, a[1] + oy];
				cubic(cx, cy, nextC[0], nextC[1], a[2] + ox, a[3] + oy);
				break;
			}
			case "Q":
			case "T": {
				const q: [number, number] =
					upper === "Q"
						? [a[0] + ox, a[1] + oy]
						: lastQ
							? [2 * x - lastQ[0], 2 * y - lastQ[1]]
							: [x, y];
				const ex = (upper === "Q" ? a[2] : a[0]) + ox;
				const ey = (upper === "Q" ? a[3] : a[1]) + oy;
				nextQ = q;
				cubic(
					x + (2 / 3) * (q[0] - x),
					y + (2 / 3) * (q[1] - y),
					ex + (2 / 3) * (q[0] - ex),
					ey + (2 / 3) * (q[1] - ey),
					ex,
					ey,
				);
				break;
			}
			case "A": {
				const ex = a[5] + ox;
				const ey = a[6] + oy;
				for (const c of arcToCubics(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey))
					out.push(c);
				x = ex;
				y = ey;
				break;
			}
		}
		lastC = nextC;
		lastQ = nextQ;
	}
	return out;
}

// SVG arc implementation notes, appendix B.2.4: endpoint to centre
// parameterization, then one cubic per quarter turn at most.
function arcToCubics(
	x1: number, y1: number, rx: number, ry: number, angle: number,
	largeArc: number, sweep: number, x2: number, y2: number,
): Segment[] {
	if (x1 === x2 && y1 === y2) return [];
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	if (rx === 0 || ry === 0) return [{ op: "L", x: x2, y: y2 }];
	const phi = (angle * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const px = cos * dx + sin * dy;
	const py = -sin * dx + cos * dy;
	const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	const num = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
	const den = rx * rx * py * py + ry * ry * px * px;
	let k = Math.sqrt(Math.max(0, num / den));
	if (largeArc === sweep) k = -k;
	const cxp = (k * rx * py) / ry;
	const cyp = (-k * ry * px) / rx;
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
	const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
		const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
		return a;
	};
	const theta = vecAngle(1, 0, (px - cxp) / rx, (py - cyp) / ry);
	let delta = vecAngle((px - cxp) / rx, (py - cyp) / ry, (-px - cxp) / rx, (-py - cyp) / ry);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;
	const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
	const step = delta / n;
	const t = (4 / 3) * Math.tan(step / 4);
	const point = (a: number): [number, number] => [
		cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
		cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
	];
	const deriv = (a: number): [number, number] => [
		-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
		-rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
	];
	const out: Segment[] = [];
	let a0 = theta;
	for (let s = 0; s < n; s++) {
		const a1 = a0 + step;
		const [sx, sy] = point(a0);
		const [ex, ey] = s === n - 1 ? [x2, y2] : point(a1);
		const [d0x, d0y] = deriv(a0);
		const [d1x, d1y] = deriv(a1);
		out.push({
			op: "C",
			x1: sx + t * d0x,
			y1: sy + t * d0y,
			x2: ex - t * d1x,
			y2: ey - t * d1y,
			x: ex,
			y: ey,
		});
		a0 = a1;
	}
	return out;
}

export function transformPath(segs: Segment[], m: Matrix): Segment[] {
	return segs.map((s) => {
		if (s.op === "Z") return s;
		const [x, y] = applyMatrix(m, s.x, s.y);
		if (s.op !== "C") return { op: s.op, x, y };
		const [x1, y1] = applyMatrix(m, s.x1, s.y1);
		const [x2, y2] = applyMatrix(m, s.x2, s.y2);
		return { op: "C", x1, y1, x2, y2, x, y };
	});
}

// Where a cubic's derivative is zero along one axis, within (0, 1).
function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
	const a = -p0 + 3 * p1 - 3 * p2 + p3;
	const b = 2 * (p0 - 2 * p1 + p2);
	const c = p1 - p0;
	const roots: number[] = [];
	if (Math.abs(a) < 1e-12) {
		if (Math.abs(b) > 1e-12) roots.push(-c / b);
	} else {
		const disc = b * b - 4 * a * c;
		if (disc >= 0) {
			const r = Math.sqrt(disc);
			roots.push((-b + r) / (2 * a), (-b - r) / (2 * a));
		}
	}
	return roots.filter((t) => t > 0 && t < 1);
}

const bezier = (p0: number, p1: number, p2: number, p3: number, t: number) => {
	const u = 1 - t;
	return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/** The exact bounds of the geometry, or null when there is none. */
export function pathBounds(segs: Segment[]): Box | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const add = (x: number, y: number) => {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	};
	let px = 0;
	let py = 0;
	for (const s of segs) {
		if (s.op === "Z") continue;
		if (s.op === "C") {
			for (const t of extrema(px, s.x1, s.x2, s.x))
				add(bezier(px, s.x1, s.x2, s.x, t), bezier(py, s.y1, s.y2, s.y, t));
			for (const t of extrema(py, s.y1, s.y2, s.y))
				add(bezier(px, s.x1, s.x2, s.x, t), bezier(py, s.y1, s.y2, s.y, t));
		}
		add(s.x, s.y);
		px = s.x;
		py = s.y;
	}
	if (minX === Infinity) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const num = (n: number) => {
	const r = Math.round(n * 1e4) / 1e4;
	return String(Object.is(r, -0) ? 0 : r);
};

export function serializePath(segs: Segment[]): string {
	return segs
		.map((s) => {
			if (s.op === "Z") return "Z";
			if (s.op === "C")
				return `C${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)}`;
			return `${s.op}${num(s.x)} ${num(s.y)}`;
		})
		.join("");
}
