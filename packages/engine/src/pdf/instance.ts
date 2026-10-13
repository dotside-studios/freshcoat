// A variable TrueType font fixed at one instance: gvar deltas applied to the
// outlines, HVAR (or the phantom points) to the advances, and the variation
// tables dropped, so a PDF can embed the glyphs as they were drawn.

import {
	ARGS_XY,
	type Bbox,
	type CompositeGlyph,
	componentMatrix,
	pointsBbox,
	readComposite,
	readSimple,
	type SimpleGlyph,
	writeComposite,
	writeSimple,
} from "./glyf";
import { assemble, type Tables } from "../sfnt-write";
import { tagAt } from "./sfnt";
import { get, glyfReader, layoutGlyf, readTables } from "./subset";

const DROPPED = ["fvar", "gvar", "avar", "HVAR", "VVAR", "MVAR", "STAT", "cvar"];

const view = (b: Uint8Array) =>
	new DataView(b.buffer, b.byteOffset, b.byteLength);
const f2dot14 = (dv: DataView, o: number) => dv.getInt16(o) / 16384;

// `bytes` at the axis values in `settings`, or null when it cannot be.
export function instanceFont(
	bytes: Uint8Array,
	settings: Record<string, number>,
): Uint8Array | null {
	try {
		const { version, tables } = readTables(bytes);
		if (version === "OTTO" || !tables.has("glyf")) return null;
		const coords = normalize(tables, settings);
		const count = view(get(tables, "maxp")).getUint16(4);
		const glyphs = applyGvar(tables, count, coords);
		const advances = instanceAdvances(tables, count, coords, glyphs);
		const out: Tables = new Map(tables);
		for (const tag of DROPPED) out.delete(tag);
		layoutGlyf(
			out,
			glyphs.map((g) => g.data),
			glyfReader(tables, count).long,
			out,
		);
		writeMetrics(out, glyphs, advances);
		const wght = settings.wght;
		const os2 = out.get("OS/2");
		if (os2 && wght !== undefined && tables.has("fvar")) {
			const copy = os2.slice();
			view(copy).setUint16(4, Math.max(1, Math.min(1000, Math.round(wght))));
			out.set("OS/2", copy);
		}
		return assemble(version, out);
	} catch {
		return null;
	}
}

// Each axis's normalized coordinate, after avar.
function normalize(tables: Tables, settings: Record<string, number>): number[] {
	const fvar = tables.get("fvar");
	if (!fvar) return [];
	const dv = view(fvar);
	const first = dv.getUint16(4);
	const n = dv.getUint16(8);
	const size = dv.getUint16(10);
	const coords: number[] = [];
	for (let i = 0; i < n; i++) {
		const o = first + i * size;
		const tag = tagAt(fvar, o).trim();
		const min = dv.getInt32(o + 4) / 65536;
		const def = dv.getInt32(o + 8) / 65536;
		const max = dv.getInt32(o + 12) / 65536;
		const v = Math.min(max, Math.max(min, settings[tag] ?? def));
		coords.push(
			v < def ? (def > min ? (v - def) / (def - min) : 0)
			: v > def ? (max > def ? (v - def) / (max - def) : 0)
			: 0,
		);
	}
	const avar = tables.get("avar");
	if (avar) {
		const av = view(avar);
		let o = 8;
		for (let i = 0; i < Math.min(av.getUint16(6), n); i++) {
			const pairs = av.getUint16(o);
			o += 2;
			const map: Array<[number, number]> = [];
			for (let k = 0; k < pairs; k++, o += 4)
				map.push([f2dot14(av, o), f2dot14(av, o + 2)]);
			coords[i] = segmentMap(coords[i] as number, map);
		}
	}
	return coords.map((c) => Math.round(c * 16384) / 16384);
}

function segmentMap(v: number, map: Array<[number, number]>): number {
	if (map.length === 0) return v;
	for (let k = 0; k < map.length; k++) {
		const [from, to] = map[k] as [number, number];
		if (v === from) return to;
		if (v < from) {
			if (k === 0) return v;
			const [pf, pt] = map[k - 1] as [number, number];
			return pt + ((to - pt) * (v - pf)) / (from - pf);
		}
	}
	return v;
}

// How much a region at `peak`, from `start` to `end`, applies at `coords`.
function regionScalar(
	coords: number[],
	peak: number[],
	start?: number[],
	end?: number[],
): number {
	let scalar = 1;
	for (let i = 0; i < peak.length; i++) {
		const p = peak[i] as number;
		if (p === 0) continue;
		const lo = start ? (start[i] as number) : Math.min(p, 0);
		const hi = end ? (end[i] as number) : Math.max(p, 0);
		if (lo > p || p > hi || (lo < 0 && hi > 0)) continue;
		const v = coords[i] ?? 0;
		if (v === p) continue;
		if (v <= lo || v >= hi) return 0;
		scalar *= v < p ? (v - lo) / (p - lo) : (v - hi) / (p - hi);
	}
	return scalar;
}

type Glyph = {
	data: Uint8Array;
	bbox: Bbox;
	// Phantom point deltas: the left side and the advance.
	left: number;
	right: number;
	simple?: SimpleGlyph;
	composite?: CompositeGlyph;
};

function applyGvar(tables: Tables, count: number, coords: number[]): Glyph[] {
	const { piece } = glyfReader(tables, count);
	const gvar = tables.get("gvar");
	const gv = gvar ? view(gvar) : null;
	const axes = gv ? gv.getUint16(4) : 0;
	const shared: number[][] = [];
	if (gv && gvar) {
		const at = gv.getUint32(8);
		for (let i = 0; i < gv.getUint16(6); i++)
			shared.push(
				Array.from({ length: axes }, (_, k) =>
					f2dot14(gv, at + 2 * (i * axes + k)),
				),
			);
	}
	const variation = (g: number): Uint8Array | null => {
		if (!gv || !gvar) return null;
		const long = gv.getUint16(14) & 1;
		const base = gv.getUint32(16);
		const at = (i: number) =>
			long ? gv.getUint32(20 + 4 * i) : gv.getUint16(20 + 2 * i) * 2;
		const [s, e] = [at(g), at(g + 1)];
		return e > s ? gvar.subarray(base + s, base + e) : null;
	};
	const out: Glyph[] = [];
	for (let g = 0; g < count; g++) {
		const data = piece(g);
		const contours = data.length ? view(data).getInt16(0) : 0;
		const simple = contours > 0 ? readSimple(data) : undefined;
		const composite = contours < 0 ? readComposite(data) : undefined;
		const n = simple
			? simple.xs.length
			: composite
				? composite.components.length
				: 0;
		const dx = new Float64Array(n + 4);
		const dy = new Float64Array(n + 4);
		const vd = variation(g);
		if (vd && coords.some((c) => c !== 0))
			addDeltas(vd, axes, shared, coords, n + 4, simple, dx, dy);
		const glyph: Glyph = {
			data,
			bbox: data.length
				? [0, 1, 2, 3].map((k) => view(data).getInt16(2 + 2 * k)) as Bbox
				: [0, 0, 0, 0],
			left: dx[n] as number,
			right: dx[n + 1] as number,
		};
		if (simple) {
			simple.xs = simple.xs.map((x, i) => Math.round(x + (dx[i] as number)));
			simple.ys = simple.ys.map((y, i) => Math.round(y + (dy[i] as number)));
			glyph.simple = simple;
			glyph.bbox = pointsBbox(simple.xs, simple.ys);
			glyph.data = writeSimple(simple, glyph.bbox);
		} else if (composite) {
			composite.components.forEach((c, i) => {
				if (!(c.flags & ARGS_XY)) return;
				c.a = Math.round(c.a + (dx[i] as number));
				c.b = Math.round(c.b + (dy[i] as number));
			});
			glyph.composite = composite;
		}
		out.push(glyph);
	}
	const memo = new Map<number, [number[], number[]]>();
	const points = (g: number, depth: number): [number[], number[]] => {
		const hit = memo.get(g);
		if (hit) return hit;
		const glyph = out[g];
		let result: [number[], number[]] = [[], []];
		if (glyph?.simple) result = [glyph.simple.xs, glyph.simple.ys];
		else if (glyph?.composite && depth < 8) {
			const xs: number[] = [];
			const ys: number[] = [];
			for (const c of glyph.composite.components) {
				const [cx, cy] = points(c.glyph, depth + 1);
				const [a, b, cc, d] = componentMatrix(c);
				const [ox, oy] = c.flags & ARGS_XY ? [c.a, c.b] : [0, 0];
				cx.forEach((x, i) => {
					const y = cy[i] as number;
					xs.push(a * x + cc * y + ox);
					ys.push(b * x + d * y + oy);
				});
			}
			result = [xs, ys];
		}
		memo.set(g, result);
		return result;
	};
	out.forEach((glyph, g) => {
		if (!glyph.composite) return;
		const [xs, ys] = points(g, 0);
		glyph.bbox = pointsBbox(xs, ys).map(Math.round) as Bbox;
		glyph.data = writeComposite(glyph.composite, glyph.bbox);
	});
	return out;
}

function addDeltas(
	vd: Uint8Array,
	axes: number,
	shared: number[][],
	coords: number[],
	total: number,
	simple: SimpleGlyph | undefined,
	dx: Float64Array,
	dy: Float64Array,
) {
	const dv = view(vd);
	const header = dv.getUint16(0);
	let data = dv.getUint16(2);
	let o = 4;
	let sharedPoints: number[] | null = null;
	if (header & 0x8000) {
		const r = readPoints(vd, data);
		sharedPoints = r.points;
		data = r.end;
	}
	for (let t = 0; t < (header & 0x0fff); t++) {
		const size = dv.getUint16(o);
		const index = dv.getUint16(o + 2);
		o += 4;
		const tuple = (): number[] => {
			const v = Array.from({ length: axes }, (_, k) => f2dot14(dv, o + 2 * k));
			o += 2 * axes;
			return v;
		};
		const peak = index & 0x8000 ? tuple() : (shared[index & 0x0fff] ?? []);
		const start = index & 0x4000 ? tuple() : undefined;
		const end = index & 0x4000 ? tuple() : undefined;
		const scalar = regionScalar(coords, peak, start, end);
		let at = data;
		data += size;
		if (scalar === 0) continue;
		let points = sharedPoints;
		if (index & 0x2000) {
			const r = readPoints(vd, at);
			points = r.points;
			at = r.end;
		}
		const all = !points || points.length === 0;
		const n = all ? total : (points as number[]).length;
		const xs = readDeltas(vd, at, n);
		const ys = readDeltas(vd, xs.end, n);
		if (all) {
			for (let i = 0; i < total; i++) {
				dx[i] = (dx[i] as number) + scalar * (xs.values[i] as number);
				dy[i] = (dy[i] as number) + scalar * (ys.values[i] as number);
			}
			continue;
		}
		const px = new Float64Array(total);
		const py = new Float64Array(total);
		const touched = new Uint8Array(total);
		(points as number[]).forEach((p, i) => {
			if (p >= total) return;
			px[p] = (px[p] as number) + (xs.values[i] as number);
			py[p] = (py[p] as number) + (ys.values[i] as number);
			touched[p] = 1;
		});
		if (simple) {
			interpolate(simple, touched, px, simple.xs);
			interpolate(simple, touched, py, simple.ys);
		}
		for (let i = 0; i < total; i++) {
			dx[i] = (dx[i] as number) + scalar * (px[i] as number);
			dy[i] = (dy[i] as number) + scalar * (py[i] as number);
		}
	}
}

function readPoints(b: Uint8Array, o: number): { points: number[]; end: number } {
	let count = b[o++] as number;
	if (count & 0x80) count = ((count & 0x7f) << 8) | (b[o++] as number);
	const points: number[] = [];
	let last = 0;
	while (points.length < count) {
		const control = b[o++] as number;
		const run = (control & 0x7f) + 1;
		for (let k = 0; k < run && points.length < count; k++) {
			if (control & 0x80) {
				last += ((b[o] as number) << 8) | (b[o + 1] as number);
				o += 2;
			} else last += b[o++] as number;
			points.push(last);
		}
	}
	return { points, end: o };
}

function readDeltas(
	b: Uint8Array,
	o: number,
	count: number,
): { values: number[]; end: number } {
	const dv = view(b);
	const values: number[] = [];
	while (values.length < count) {
		const control = b[o++] as number;
		const run = (control & 0x3f) + 1;
		for (let k = 0; k < run && values.length < count; k++) {
			if (control & 0x80) values.push(0);
			else if (control & 0x40) {
				values.push(dv.getInt16(o));
				o += 2;
			} else {
				values.push(dv.getInt8(o));
				o += 1;
			}
		}
	}
	return { values, end: o };
}

// Deltas for the points a tuple leaves out, from the touched points either side
// of them on their contour, as FreeType infers them.
function interpolate(
	g: SimpleGlyph,
	touched: Uint8Array,
	d: Float64Array,
	orig: number[],
) {
	let start = 0;
	for (const end of g.endPts) {
		const idx: number[] = [];
		for (let i = start; i <= end; i++) if (touched[i]) idx.push(i);
		if (idx.length === 1) {
			const v = d[idx[0] as number] as number;
			for (let i = start; i <= end; i++) d[i] = v;
		} else if (idx.length > 1) {
			for (let k = 0; k < idx.length; k++) {
				const a = idx[k] as number;
				const b = idx[(k + 1) % idx.length] as number;
				let [i1, i2] = [a, b];
				if ((orig[i1] as number) > (orig[i2] as number)) [i1, i2] = [i2, i1];
				const x1 = orig[i1] as number;
				const x2 = orig[i2] as number;
				const d1 = d[i1] as number;
				const d2 = d[i2] as number;
				for (let i = a + 1; ; i++) {
					if (i > end) i = start;
					if (i === b) break;
					const x = orig[i] as number;
					d[i] =
						x <= x1
							? d1
							: x >= x2
								? d2
								: d1 + ((x - x1) * (d2 - d1)) / (x2 - x1);
				}
			}
		}
		start = end + 1;
	}
}

function instanceAdvances(
	tables: Tables,
	count: number,
	coords: number[],
	glyphs: Glyph[],
): number[] {
	const hmtx = view(get(tables, "hmtx"));
	const metrics = view(get(tables, "hhea")).getUint16(34);
	const base = (g: number) => hmtx.getUint16(4 * Math.min(g, metrics - 1));
	const hvar = tables.get("HVAR");
	const delta = hvar ? hvarDeltas(hvar, coords) : null;
	return Array.from({ length: count }, (_, g) => {
		const glyph = glyphs[g] as Glyph;
		const d = delta ? delta(g) : glyph.right - glyph.left;
		return Math.max(0, Math.round(base(g) + d));
	});
}

function hvarDeltas(hvar: Uint8Array, coords: number[]): (g: number) => number {
	const dv = view(hvar);
	const store = dv.getUint32(4);
	const mapAt = dv.getUint32(8);
	const regionsAt = store + dv.getUint32(store + 2);
	const axisCount = dv.getUint16(regionsAt);
	const scalars: number[] = [];
	for (let r = 0; r < dv.getUint16(regionsAt + 2); r++) {
		const o = regionsAt + 4 + r * axisCount * 6;
		const lane = (k: number) =>
			Array.from({ length: axisCount }, (_, a) => f2dot14(dv, o + a * 6 + 2 * k));
		scalars.push(regionScalar(coords, lane(1), lane(0), lane(2)));
	}
	const dataCount = dv.getUint16(store + 6);
	const datas = Array.from({ length: dataCount }, (_, i) =>
		store + dv.getUint32(store + 8 + 4 * i),
	);
	const map = (g: number): [number, number] => {
		if (!mapAt) return [0, g];
		const format = dv.getUint8(mapAt);
		const entry = dv.getUint8(mapAt + 1);
		const n = format === 0 ? dv.getUint16(mapAt + 2) : dv.getUint32(mapAt + 2);
		const first = mapAt + (format === 0 ? 4 : 6);
		const size = ((entry & 0x30) >> 4) + 1;
		const bits = (entry & 0x0f) + 1;
		const at = first + Math.min(g, n - 1) * size;
		let v = 0;
		for (let k = 0; k < size; k++) v = v * 256 + dv.getUint8(at + k);
		return [Math.floor(v / 2 ** bits), v & ((1 << bits) - 1)];
	};
	return (g) => {
		const [outer, inner] = map(g);
		const at = datas[outer];
		if (at === undefined) return 0;
		const items = dv.getUint16(at);
		if (inner >= items) return 0;
		const words = dv.getUint16(at + 2);
		const long = (words & 0x8000) !== 0;
		const wordCount = words & 0x7fff;
		const regions = dv.getUint16(at + 4);
		const indexes = Array.from({ length: regions }, (_, k) =>
			dv.getUint16(at + 6 + 2 * k),
		);
		const [wide, narrow] = long ? [4, 2] : [2, 1];
		const row = wordCount * wide + (regions - wordCount) * narrow;
		let o = at + 6 + 2 * regions + inner * row;
		let sum = 0;
		for (let k = 0; k < regions; k++) {
			const size = k < wordCount ? wide : narrow;
			const v =
				size === 4
					? dv.getInt32(o)
					: size === 2
						? dv.getInt16(o)
						: dv.getInt8(o);
			o += size;
			sum += (scalars[indexes[k] as number] ?? 0) * v;
		}
		return sum;
	};
}

function writeMetrics(out: Tables, glyphs: Glyph[], advances: number[]) {
	const old = view(get(out, "hmtx"));
	const metrics = view(get(out, "hhea")).getUint16(34);
	const lsbOf = (g: number) =>
		g < metrics ? old.getInt16(4 * g + 2) : old.getInt16(4 * metrics + 2 * (g - metrics));
	const hmtx = new Uint8Array(4 * glyphs.length);
	const hv = new DataView(hmtx.buffer);
	const box: Bbox = [0x7fff, 0x7fff, -0x8000, -0x8000];
	let lsbMin = 0x7fff;
	let rsbMin = 0x7fff;
	let extent = -0x8000;
	glyphs.forEach((glyph, g) => {
		const advance = advances[g] as number;
		const lsb = glyph.data.length ? glyph.bbox[0] : lsbOf(g);
		hv.setUint16(4 * g, advance);
		hv.setInt16(4 * g + 2, lsb);
		if (!glyph.data.length) return;
		const [x0, y0, x1, y1] = glyph.bbox;
		box[0] = Math.min(box[0], x0);
		box[1] = Math.min(box[1], y0);
		box[2] = Math.max(box[2], x1);
		box[3] = Math.max(box[3], y1);
		lsbMin = Math.min(lsbMin, lsb);
		rsbMin = Math.min(rsbMin, advance - x1);
		extent = Math.max(extent, x1);
	});
	out.set("hmtx", hmtx);
	const hhea = get(out, "hhea").slice();
	const hh = view(hhea);
	hh.setUint16(10, Math.max(...advances, 0));
	if (lsbMin !== 0x7fff) {
		hh.setInt16(12, lsbMin);
		hh.setInt16(14, rsbMin);
		hh.setInt16(16, extent);
	}
	hh.setUint16(34, glyphs.length);
	out.set("hhea", hhea);
	if (box[0] <= box[2]) {
		const head = get(out, "head").slice();
		box.forEach((v, i) => view(head).setInt16(36 + 2 * i, v));
		out.set("head", head);
	}
}
