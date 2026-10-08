// Rounds the corners where two straight segments meet with the geometry of
// Skia's PathEffect.MakeCorner: each corner is cut back along both segments by
// the radius, or by half a segment when it is shorter than twice the radius,
// and the cut ends are joined by a quadratic with the corner as its control
// point. Curves, arcs and the corners next to them are kept as they are. Path
// data that does not parse is returned unchanged.

type Point = [number, number];

type Segment =
	| { kind: "line"; to: Point }
	| { kind: "curve"; to: Point; cmd: string };

type Subpath = { start: Point; segments: Segment[]; closed: boolean };

const ARITY: Record<string, number> = {
	M: 2,
	L: 2,
	T: 2,
	H: 1,
	V: 1,
	C: 6,
	S: 4,
	Q: 4,
	A: 7,
	Z: 0,
};

const TOKEN = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function roundCorners(d: string, radius: number): string {
	if (!(radius > 0)) return d;
	try {
		return parse(d)
			.map((sub) => emit(sub, radius))
			.join(" ");
	} catch {
		return d;
	}
}

function parse(d: string): Subpath[] {
	const subpaths: Subpath[] = [];
	let sub: Subpath | null = null;
	let pen: Point = [0, 0];
	let start: Point = [0, 0];
	let lastCtrl: Point | null = null;
	let lastKind = "";
	const tokens = tokenize(d);
	let i = 0;
	let cmd = "";
	const num = () => {
		const t = tokens[i++];
		if (t === undefined || /[a-zA-Z]/.test(t))
			throw new Error("path: missing argument");
		return Number.parseFloat(t);
	};
	const open = () => {
		if (!sub) {
			sub = { start: [...pen], segments: [], closed: false };
			subpaths.push(sub);
		}
		return sub;
	};
	while (i < tokens.length) {
		if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
		else if (!cmd) throw new Error("path: number without a command");
		const upper = cmd.toUpperCase();
		if (!(upper in ARITY)) throw new Error(`path: unknown command "${cmd}"`);
		const rel = cmd !== upper;
		const ox = rel ? pen[0] : 0;
		const oy = rel ? pen[1] : 0;
		let ctrl: Point | null = null;
		switch (upper) {
			case "M": {
				pen = [num() + ox, num() + oy];
				start = [...pen];
				sub = null;
				open();
				cmd = rel ? "l" : "L";
				break;
			}
			case "L":
			case "H":
			case "V": {
				const to: Point =
					upper === "L"
						? [num() + ox, num() + oy]
						: upper === "H"
							? [num() + ox, pen[1]]
							: [pen[0], num() + oy];
				open().segments.push({ kind: "line", to });
				pen = to;
				break;
			}
			case "C":
			case "S": {
				const c1: Point =
					upper === "C"
						? [num() + ox, num() + oy]
						: reflect(pen, lastKind === "C" ? lastCtrl : null);
				const c2: Point = [num() + ox, num() + oy];
				const to: Point = [num() + ox, num() + oy];
				open().segments.push({
					kind: "curve",
					to,
					cmd: `C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${to[0]} ${to[1]}`,
				});
				ctrl = c2;
				pen = to;
				break;
			}
			case "Q":
			case "T": {
				const c: Point =
					upper === "Q"
						? [num() + ox, num() + oy]
						: reflect(pen, lastKind === "Q" ? lastCtrl : null);
				const to: Point = [num() + ox, num() + oy];
				open().segments.push({
					kind: "curve",
					to,
					cmd: `Q ${c[0]} ${c[1]} ${to[0]} ${to[1]}`,
				});
				ctrl = c;
				pen = to;
				break;
			}
			case "A": {
				const args = [num(), num(), num(), num(), num()];
				const to: Point = [num() + ox, num() + oy];
				open().segments.push({
					kind: "curve",
					to,
					cmd: `A ${args.join(" ")} ${to[0]} ${to[1]}`,
				});
				pen = to;
				break;
			}
			case "Z": {
				if (sub) (sub as Subpath).closed = true;
				sub = null;
				pen = [...start];
				break;
			}
		}
		lastKind = upper === "S" ? "C" : upper === "T" ? "Q" : upper;
		lastCtrl = ctrl;
	}
	return subpaths;
}

function tokenize(d: string): string[] {
	const tokens: string[] = [];
	let cmd = "";
	let argIndex = 0;
	let i = 0;
	while (i < d.length) {
		const ch = d[i];
		if (/[\s,]/.test(ch)) {
			i++;
			continue;
		}
		if (/[a-zA-Z]/.test(ch)) {
			tokens.push(ch);
			cmd = ch.toUpperCase();
			argIndex = 0;
			i++;
			continue;
		}
		const slot = ARITY[cmd] ? argIndex % ARITY[cmd] : -1;
		if (cmd === "A" && (slot === 3 || slot === 4)) {
			if (ch !== "0" && ch !== "1")
				throw new Error(`path: bad arc flag "${ch}" at ${i}`);
			tokens.push(ch);
			i++;
		} else {
			TOKEN.lastIndex = i;
			const m = TOKEN.exec(d);
			if (!m || m.index !== i)
				throw new Error(`path: unreadable number at ${i}`);
			tokens.push(m[0]);
			i += m[0].length;
		}
		argIndex++;
	}
	return tokens;
}

function reflect(pen: Point, ctrl: Point | null): Point {
	return ctrl ? [2 * pen[0] - ctrl[0], 2 * pen[1] - ctrl[1]] : [...pen];
}

function emit(sub: Subpath, radius: number): string {
	const segs: Segment[] = [];
	let at = sub.start;
	for (const s of sub.segments) {
		if (s.kind === "line" && s.to[0] === at[0] && s.to[1] === at[1]) continue;
		segs.push(s);
		at = s.to;
	}
	if (
		sub.closed &&
		(at[0] !== sub.start[0] || at[1] !== sub.start[1]) &&
		segs.length > 0
	)
		segs.push({ kind: "line", to: sub.start });
	const fmt = (p: Point) => `${p[0]} ${p[1]}`;
	if (segs.length === 0) return `M ${fmt(sub.start)}${sub.closed ? " Z" : ""}`;
	const from = (i: number) => (i === 0 ? sub.start : segs[i - 1].to);
	const step = (i: number): Point => {
		const a = from(i);
		const b = segs[i].to;
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const dist = Math.hypot(dx, dy);
		const k = dist <= radius * 2 ? 0.5 : radius / dist;
		return [dx * k, dy * k];
	};
	const n = segs.length;
	const rounded = (i: number) => {
		const next = i + 1 < n ? i + 1 : sub.closed ? 0 : -1;
		return (
			next >= 0 &&
			next !== i &&
			segs[i].kind === "line" &&
			segs[next].kind === "line"
		);
	};
	const closesRounded = sub.closed && rounded(n - 1);
	const first = step(0);
	let pen: Point = closesRounded
		? [sub.start[0] + first[0], sub.start[1] + first[1]]
		: sub.start;
	let out = `M ${fmt(pen)}`;
	for (let i = 0; i < n; i++) {
		const s = segs[i];
		if (s.kind === "curve") {
			out += ` ${s.cmd}`;
			pen = s.to;
			continue;
		}
		if (!rounded(i)) {
			out += ` L ${fmt(s.to)}`;
			pen = s.to;
			continue;
		}
		const back = step(i);
		const fwd = step(i + 1 < n ? i + 1 : 0);
		const cut: Point = [s.to[0] - back[0], s.to[1] - back[1]];
		if (cut[0] !== pen[0] || cut[1] !== pen[1]) out += ` L ${fmt(cut)}`;
		pen = [s.to[0] + fwd[0], s.to[1] + fwd[1]];
		out += ` Q ${fmt(s.to)} ${fmt(pen)}`;
	}
	return sub.closed ? `${out} Z` : out;
}
