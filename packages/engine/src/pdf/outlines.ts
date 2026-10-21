// Glyph outlines read from a font file, for text drawn as paths: TrueType
// outlines, a variable font's fixed at its instance first, and CFF and CFF2
// charstrings, a CFF2 font's blends taken at the instance. A collection is
// read at its first face, the one CanvasKit draws. Coordinates are in font
// units, y up.

import { assemble } from "../sfnt-write";
import { ARGS_XY, componentMatrix, readComposite, readSimple } from "./glyf";
import { instanceFont, normalize, regionScalar } from "./instance";
import { faceOffset } from "./sfnt";
import { get, glyfReader, readTables } from "./subset";

// 0 x y moves, 1 x y draws a line, 2 x1 y1 x2 y2 x y a cubic curve, 3 closes
// the contour.
export type GlyphPath = number[];

export type GlyphOutlines = {
	unitsPerEm: number;
	// Null for a glyph whose outline does not read.
	glyph(id: number): GlyphPath | null;
};

const SCALED_OFFSET = 0x0800;
const MAX_NESTING = 10;
const MAX_STACK = 513;

const view = (b: Uint8Array) =>
	new DataView(b.buffer, b.byteOffset, b.byteLength);

// `bytes` at the axis values in `settings`, or null when its outlines do not
// read.
export function readOutlines(
	bytes: Uint8Array,
	settings: Record<string, number> = {},
): GlyphOutlines | null {
	try {
		const at = faceOffset(bytes);
		let { version, tables } = readTables(bytes, at);
		const unitsPerEm = view(get(tables, "head")).getUint16(18);
		const count = view(get(tables, "maxp")).getUint16(4);
		if (!unitsPerEm) return null;
		let read: (g: number) => GlyphPath;
		if (tables.has("glyf")) {
			const coords = normalize(tables, settings);
			if (tables.has("gvar") && coords.some((c) => c !== 0)) {
				const sfnt = at ? assemble(version, new Map(tables)) : bytes;
				const fixed = instanceFont(sfnt, settings);
				if (!fixed) return null;
				({ version, tables } = readTables(fixed));
			}
			read = glyfOutlines(tables, count);
		} else if (tables.has("CFF "))
			read = cffOutlines(get(tables, "CFF "), count);
		else if (tables.has("CFF2"))
			read = cff2Outlines(
				get(tables, "CFF2"),
				count,
				normalize(tables, settings),
			);
		else return null;
		const cache = new Map<number, GlyphPath | null>();
		return {
			unitsPerEm,
			glyph(id) {
				if (!cache.has(id)) {
					let path: GlyphPath | null = null;
					try {
						if (id < count) path = read(id);
					} catch {}
					cache.set(id, path);
				}
				return cache.get(id) ?? null;
			},
		};
	} catch {
		return null;
	}
}

type Point = { x: number; y: number; on: boolean };

function glyfOutlines(tables: Map<string, Uint8Array>, count: number) {
	const { piece } = glyfReader(tables, count);
	const contours = (g: number, depth: number): Point[][] => {
		const data = piece(g);
		if (data.length === 0) return [];
		if (view(data).getInt16(0) >= 0) {
			const s = readSimple(data);
			let start = 0;
			return s.endPts.map((end) => {
				const c: Point[] = [];
				for (let i = start; i <= end; i++)
					c.push({
						x: s.xs[i] as number,
						y: s.ys[i] as number,
						on: s.onCurve[i] as boolean,
					});
				start = end + 1;
				return c;
			});
		}
		if (depth > MAX_NESTING) throw new Error("components nested too deep");
		const out: Point[][] = [];
		for (const c of readComposite(data).components) {
			if (c.glyph >= count) throw new Error("no such component");
			const [xx, yx, xy, yy] = componentMatrix(c);
			const parts = contours(c.glyph, depth + 1).map((con) =>
				con.map((p) => ({
					x: xx * p.x + xy * p.y,
					y: yx * p.x + yy * p.y,
					on: p.on,
				})),
			);
			let dx = c.a;
			let dy = c.b;
			if (!(c.flags & ARGS_XY)) {
				const p = out.flat()[c.a];
				const q = parts.flat()[c.b];
				if (!p || !q) throw new Error("no such point");
				dx = p.x - q.x;
				dy = p.y - q.y;
			} else if (c.flags & SCALED_OFFSET)
				[dx, dy] = [xx * dx + xy * dy, yx * dx + yy * dy];
			for (const con of parts)
				out.push(con.map((p) => ({ x: p.x + dx, y: p.y + dy, on: p.on })));
		}
		return out;
	};
	return (g: number) => quadPath(contours(g, 0));
}

// Quadratic contours as cubic curves, an on-curve point implied between two
// off-curve ones.
function quadPath(contours: Point[][]): GlyphPath {
	const out: GlyphPath = [];
	const mid = (a: Point, b: Point): Point => ({
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
		on: true,
	});
	for (const c of contours) {
		const first = c.findIndex((p) => p.on);
		if (c.length === 0) continue;
		const start =
			first < 0
				? mid(c[c.length - 1] as Point, c[0] as Point)
				: (c[first] as Point);
		const rest = first < 0 ? c : [...c.slice(first + 1), ...c.slice(0, first)];
		let { x, y } = start;
		out.push(0, x, y);
		let ctrl: Point | null = null;
		const to = (p: Point) => {
			if (ctrl)
				out.push(
					2,
					x + (2 / 3) * (ctrl.x - x),
					y + (2 / 3) * (ctrl.y - y),
					p.x + (2 / 3) * (ctrl.x - p.x),
					p.y + (2 / 3) * (ctrl.y - p.y),
					p.x,
					p.y,
				);
			else out.push(1, p.x, p.y);
			x = p.x;
			y = p.y;
		};
		for (const p of [...rest, start]) {
			if (p.on) {
				to(p);
				ctrl = null;
			} else {
				if (ctrl) to(mid(ctrl, p));
				ctrl = p;
			}
		}
		out.push(3);
	}
	return out;
}

type Dict = Map<number, number[]>;

// A CFF or CFF2 DICT's operands by operator, a two-byte operator 12 n as
// 1200 + n.
function readDict(b: Uint8Array): Dict {
	const out: Dict = new Map();
	const dv = view(b);
	let args: number[] = [];
	for (let i = 0; i < b.length; ) {
		const c = b[i++] as number;
		if (c === 28) {
			args.push(dv.getInt16(i));
			i += 2;
		} else if (c === 29) {
			args.push(dv.getInt32(i));
			i += 4;
		} else if (c === 30) {
			let text = "";
			for (let end = false; !end; ) {
				const byte = b[i++] as number;
				for (const n of [byte >> 4, byte & 15]) {
					if (n === 15) {
						end = true;
						break;
					}
					text += n <= 9 ? n : ["", ".", "E", "E-", "", "-"][n - 9];
				}
			}
			args.push(Number(text));
		} else if (c >= 32 && c <= 246) args.push(c - 139);
		else if (c >= 247 && c <= 250)
			args.push((c - 247) * 256 + (b[i++] as number) + 108);
		else if (c >= 251 && c <= 254)
			args.push(-(c - 251) * 256 - (b[i++] as number) - 108);
		else if (c <= 27) {
			out.set(c === 12 ? 1200 + (b[i++] as number) : c, args);
			args = [];
		} else throw new Error("bad dict");
	}
	return out;
}

// A CFF INDEX, whose count is four bytes in CFF2.
function readIndex(dv: DataView, o: number, cff2: boolean) {
	const count = cff2 ? dv.getUint32(o) : dv.getUint16(o);
	const head = o + (cff2 ? 4 : 2);
	if (count === 0) return { items: [] as Uint8Array[], end: head };
	const size = dv.getUint8(head);
	const offset = (i: number) => {
		let v = 0;
		for (let k = 0; k < size; k++)
			v = v * 256 + dv.getUint8(head + 1 + i * size + k);
		return v;
	};
	const base = head + (count + 1) * size;
	const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
	const items: Uint8Array[] = [];
	for (let i = 0; i < count; i++) {
		const [s, e] = [base + offset(i), base + offset(i + 1)];
		if (e < s || e > dv.byteLength) throw new Error("bad index");
		items.push(bytes.subarray(s, e));
	}
	return { items, end: base + offset(count) };
}

function fdSelect(dv: DataView, o: number): (g: number) => number {
	const format = dv.getUint8(o);
	if (format === 0) return (g) => dv.getUint8(o + 1 + g);
	if (format !== 3 && format !== 4) throw new Error("bad FDSelect");
	const wide = format === 4;
	const n = wide ? dv.getUint32(o + 1) : dv.getUint16(o + 1);
	const first = o + (wide ? 5 : 3);
	const size = wide ? 6 : 3;
	const glyph = (at: number) => (wide ? dv.getUint32(at) : dv.getUint16(at));
	return (g) => {
		for (let r = 0; r < n; r++) {
			const at = first + r * size;
			if (g >= glyph(at) && g < glyph(at + size))
				return wide ? dv.getUint16(at + 4) : dv.getUint8(at + 2);
		}
		throw new Error("glyph has no font dict");
	};
}

type FontDict = { subrs: Uint8Array[]; vsindex: number };

function privateDict(
	cff: Uint8Array,
	dv: DataView,
	dict: Dict,
	cff2: boolean,
): FontDict {
	const [size, at] = dict.get(18) ?? [];
	if (size === undefined || at === undefined) return { subrs: [], vsindex: 0 };
	const priv = readDict(cff.subarray(at, at + size));
	const subrs = priv.get(19)?.at(-1);
	return {
		subrs: subrs === undefined ? [] : readIndex(dv, at + subrs, cff2).items,
		vsindex: priv.get(22)?.[0] ?? 0,
	};
}

function cffOutlines(cff: Uint8Array, count: number) {
	const dv = view(cff);
	const names = readIndex(dv, cff[2] as number, false);
	const tops = readIndex(dv, names.end, false);
	const strings = readIndex(dv, tops.end, false);
	const global = readIndex(dv, strings.end, false).items;
	const [topBytes] = tops.items;
	if (!topBytes) throw new Error("no top dict");
	const top = readDict(topBytes);
	if ((top.get(1206)?.[0] ?? 2) !== 2) throw new Error("not Type 2");
	const glyphs = charStrings(dv, top, count, false);
	let dictOf: (g: number) => FontDict | undefined;
	const fdArray = top.get(1236)?.[0];
	if (fdArray !== undefined) {
		const fds = readIndex(dv, fdArray, false).items.map((b) =>
			privateDict(cff, dv, readDict(b), false),
		);
		const at = top.get(1237)?.[0];
		if (at === undefined) throw new Error("no FDSelect");
		const select = fdSelect(dv, at);
		dictOf = (g) => fds[select(g)];
	} else {
		const fd = privateDict(cff, dv, top, false);
		dictOf = () => fd;
	}
	return (g: number) =>
		charstring(glyphs[g] as Uint8Array, global, dictOf(g), false, []);
}

function cff2Outlines(cff: Uint8Array, count: number, coords: number[]) {
	const dv = view(cff);
	const headerSize = cff[2] as number;
	const topEnd = headerSize + dv.getUint16(3);
	const top = readDict(cff.subarray(headerSize, topEnd));
	const global = readIndex(dv, topEnd, true).items;
	const glyphs = charStrings(dv, top, count, true);
	const fdArray = top.get(1236)?.[0];
	if (fdArray === undefined) throw new Error("no FDArray");
	const fds = readIndex(dv, fdArray, true).items.map((b) =>
		privateDict(cff, dv, readDict(b), true),
	);
	const at = top.get(1237)?.[0];
	const select = at === undefined ? () => 0 : fdSelect(dv, at);
	const vstore = top.get(24)?.[0];
	const scalars =
		vstore === undefined ? [] : blendScalars(dv, vstore + 2, coords);
	return (g: number) =>
		charstring(glyphs[g] as Uint8Array, global, fds[select(g)], true, scalars);
}

function charStrings(dv: DataView, top: Dict, count: number, cff2: boolean) {
	const at = top.get(17)?.[0];
	if (at === undefined) throw new Error("no charstrings");
	const glyphs = readIndex(dv, at, cff2).items;
	if (glyphs.length !== count) throw new Error("glyph count");
	return glyphs;
}

// The scalar of each region an ItemVariationData names, at `coords`, by its
// index: what a CFF2 blend weighs its deltas by under each vsindex.
function blendScalars(dv: DataView, ivs: number, coords: number[]): number[][] {
	const f2dot14 = (o: number) => dv.getInt16(o) / 16384;
	const list = ivs + dv.getUint32(ivs + 2);
	const axes = dv.getUint16(list);
	const regions = Array.from({ length: dv.getUint16(list + 2) }, (_, r) => {
		const start: number[] = [];
		const peak: number[] = [];
		const end: number[] = [];
		for (let a = 0; a < axes; a++) {
			const o = list + 4 + (r * axes + a) * 6;
			start.push(f2dot14(o));
			peak.push(f2dot14(o + 2));
			end.push(f2dot14(o + 4));
		}
		return regionScalar(coords, peak, start, end);
	});
	return Array.from({ length: dv.getUint16(ivs + 6) }, (_, d) => {
		const o = ivs + dv.getUint32(ivs + 8 + 4 * d);
		return Array.from(
			{ length: dv.getUint16(o + 4) },
			(_, k) => regions[dv.getUint16(o + 6 + 2 * k)] ?? 0,
		);
	});
}

const bias = (n: number) => (n < 1240 ? 107 : n < 33900 ? 1131 : 32768);

// A Type 2 or CFF2 charstring's outline. A CFF glyph's advance comes first
// when it is not the default; the outline leaves it out.
function charstring(
	code: Uint8Array,
	global: Uint8Array[],
	fd: FontDict | undefined,
	cff2: boolean,
	scalars: number[][],
): GlyphPath {
	if (!fd) throw new Error("no font dict");
	const local = fd.subrs;
	const out: GlyphPath = [];
	const s: number[] = [];
	let x = 0;
	let y = 0;
	let stems = 0;
	let width = cff2;
	let open = false;
	let depth = 0;
	let done = false;
	let vsindex = fd.vsindex;
	const move = (dx: number, dy: number) => {
		if (open) out.push(3);
		x += dx;
		y += dy;
		out.push(0, x, y);
		open = true;
	};
	const line = (dx: number, dy: number) => {
		x += dx;
		y += dy;
		out.push(1, x, y);
	};
	const curve = (
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
	) => {
		const x1 = x + a;
		const y1 = y + b;
		const x2 = x1 + c;
		const y2 = y1 + d;
		x = x2 + e;
		y = y2 + f;
		out.push(2, x1, y1, x2, y2, x, y);
	};
	const takeWidth = (extra: boolean) => {
		if (!width && extra) s.shift();
		width = true;
	};
	const at = (k: number) => s[k] as number;
	const exec = (bytes: Uint8Array) => {
		if (++depth > MAX_NESTING) throw new Error("subroutines nested too deep");
		const dv = view(bytes);
		run: for (let i = 0; i < bytes.length && !done; ) {
			const b0 = bytes[i++] as number;
			if (b0 >= 32 || b0 === 28) {
				if (b0 <= 246) s.push(b0 === 28 ? dv.getInt16(i) : b0 - 139);
				else if (b0 <= 250)
					s.push((b0 - 247) * 256 + (bytes[i] as number) + 108);
				else if (b0 <= 254)
					s.push(-(b0 - 251) * 256 - (bytes[i] as number) - 108);
				else s.push(dv.getInt32(i) / 65536);
				i += b0 === 28 ? 2 : b0 === 255 ? 4 : b0 >= 247 ? 1 : 0;
				if (s.length > MAX_STACK) throw new Error("stack overflow");
				continue;
			}
			const n = s.length;
			switch (b0) {
				case 1:
				case 3:
				case 18:
				case 23:
					takeWidth(n % 2 === 1);
					stems += s.length >> 1;
					break;
				case 19:
				case 20:
					takeWidth(n % 2 === 1);
					stems += s.length >> 1;
					i += (stems + 7) >> 3;
					break;
				case 21:
					takeWidth(n > 2);
					move(at(0), at(1));
					break;
				case 22:
					takeWidth(n > 1);
					move(at(0), 0);
					break;
				case 4:
					takeWidth(n > 1);
					move(0, at(0));
					break;
				case 5:
					for (let k = 0; k + 1 < n; k += 2) line(at(k), at(k + 1));
					break;
				case 6:
				case 7:
					for (let k = 0; k < n; k++)
						(k % 2 === 0) === (b0 === 6) ? line(at(k), 0) : line(0, at(k));
					break;
				case 8:
					for (let k = 0; k + 5 < n; k += 6)
						curve(at(k), at(k + 1), at(k + 2), at(k + 3), at(k + 4), at(k + 5));
					break;
				case 24: {
					let k = 0;
					for (; k + 6 <= n - 2; k += 6)
						curve(at(k), at(k + 1), at(k + 2), at(k + 3), at(k + 4), at(k + 5));
					line(at(k), at(k + 1));
					break;
				}
				case 25: {
					let k = 0;
					for (; k + 2 <= n - 6; k += 2) line(at(k), at(k + 1));
					curve(at(k), at(k + 1), at(k + 2), at(k + 3), at(k + 4), at(k + 5));
					break;
				}
				case 26: {
					let k = n % 2;
					let dx = k ? at(0) : 0;
					for (; k + 3 < n; k += 4) {
						curve(dx, at(k), at(k + 1), at(k + 2), 0, at(k + 3));
						dx = 0;
					}
					break;
				}
				case 27: {
					let k = n % 2;
					let dy = k ? at(0) : 0;
					for (; k + 3 < n; k += 4) {
						curve(at(k), dy, at(k + 1), at(k + 2), at(k + 3), 0);
						dy = 0;
					}
					break;
				}
				case 30:
				case 31: {
					let h = b0 === 31;
					for (let k = 0; n - k >= 4; k += 4, h = !h) {
						const last = n - k === 5 ? at(k + 4) : 0;
						if (h) curve(at(k), 0, at(k + 1), at(k + 2), last, at(k + 3));
						else curve(0, at(k), at(k + 1), at(k + 2), at(k + 3), last);
					}
					break;
				}
				case 10:
				case 29: {
					const subrs = b0 === 10 ? local : global;
					const sub = subrs[(s.pop() as number) + bias(subrs.length)];
					if (!sub) throw new Error("no such subroutine");
					exec(sub);
					continue;
				}
				case 11:
					break run;
				case 14:
					if (cff2) throw new Error("endchar in CFF2");
					takeWidth(n === 1 || n === 5);
					if (s.length >= 4) throw new Error("seac");
					done = true;
					break;
				case 15:
					if (!cff2) throw new Error("vsindex in CFF");
					vsindex = s.pop() as number;
					break;
				case 16: {
					const weights = scalars[vsindex];
					if (!cff2 || !weights) throw new Error("bad blend");
					const count = s.pop() as number;
					const k = weights.length;
					const base = s.length - count * (k + 1);
					if (base < 0) throw new Error("stack underflow");
					for (let j = 0; j < count; j++) {
						let v = at(base + j);
						for (let r = 0; r < k; r++)
							v += at(base + count + j * k + r) * (weights[r] as number);
						s[base + j] = v;
					}
					s.length = base + count;
					continue;
				}
				case 12: {
					const b1 = bytes[i++];
					if (b1 === 35) {
						curve(at(0), at(1), at(2), at(3), at(4), at(5));
						curve(at(6), at(7), at(8), at(9), at(10), at(11));
					} else if (b1 === 34) {
						curve(at(0), 0, at(1), at(2), at(3), 0);
						curve(at(4), 0, at(5), -at(2), at(6), 0);
					} else if (b1 === 36) {
						curve(at(0), at(1), at(2), at(3), at(4), 0);
						curve(at(5), 0, at(6), at(7), at(8), -(at(1) + at(3) + at(7)));
					} else if (b1 === 37) {
						const dx = at(0) + at(2) + at(4) + at(6) + at(8);
						const dy = at(1) + at(3) + at(5) + at(7) + at(9);
						const horizontal = Math.abs(dx) > Math.abs(dy);
						curve(at(0), at(1), at(2), at(3), at(4), at(5));
						curve(
							at(6),
							at(7),
							at(8),
							at(9),
							horizontal ? at(10) : -dx,
							horizontal ? -dy : at(10),
						);
					} else throw new Error(`charstring operator 12 ${b1}`);
					break;
				}
				default:
					throw new Error(`charstring operator ${b0}`);
			}
			s.length = 0;
		}
		depth--;
	};
	exec(code);
	if (open) out.push(3);
	return out;
}
