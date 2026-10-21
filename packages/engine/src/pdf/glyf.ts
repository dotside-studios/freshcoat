// Reading and writing TrueType glyph records, for rebuilding a glyf table at a
// variable font's instance.

import { concat } from "./subset";

export type SimpleGlyph = {
	endPts: number[];
	onCurve: boolean[];
	xs: number[];
	ys: number[];
	instructions: Uint8Array;
	overlap: boolean;
};

export type Component = {
	flags: number;
	glyph: number;
	// The offset when ARGS_ARE_XY_VALUES is set, else the point numbers.
	a: number;
	b: number;
	// The transform's raw F2Dot14 bytes, kept as they are.
	transform: Uint8Array;
};

export type CompositeGlyph = {
	components: Component[];
	instructions: Uint8Array;
};

export const ARG_WORDS = 0x0001;
export const ARGS_XY = 0x0002;
export const MORE_COMPONENTS = 0x0020;
export const HAVE_INSTRUCTIONS = 0x0100;

const view = (b: Uint8Array) =>
	new DataView(b.buffer, b.byteOffset, b.byteLength);

export function readSimple(data: Uint8Array): SimpleGlyph {
	const dv = view(data);
	const contours = dv.getInt16(0);
	const endPts: number[] = [];
	let o = 10;
	for (let i = 0; i < contours; i++, o += 2) endPts.push(dv.getUint16(o));
	const count = contours ? (endPts[contours - 1] as number) + 1 : 0;
	const ilen = dv.getUint16(o);
	o += 2;
	const instructions = data.slice(o, o + ilen);
	o += ilen;
	const flags: number[] = [];
	while (flags.length < count) {
		const f = data[o++] as number;
		flags.push(f);
		if (f & 8) {
			const repeat = data[o++] as number;
			for (let k = 0; k < repeat; k++) flags.push(f);
		}
	}
	const coords = (short: number, same: number) => {
		const out: number[] = [];
		let v = 0;
		for (const f of flags) {
			if (f & short) {
				const d = data[o++] as number;
				v += f & same ? d : -d;
			} else if (!(f & same)) {
				v += dv.getInt16(o);
				o += 2;
			}
			out.push(v);
		}
		return out;
	};
	const xs = coords(0x02, 0x10);
	const ys = coords(0x04, 0x20);
	return {
		endPts,
		onCurve: flags.map((f) => (f & 1) === 1),
		xs,
		ys,
		instructions,
		overlap: ((flags[0] ?? 0) & 0x40) !== 0,
	};
}

export function readComposite(data: Uint8Array): CompositeGlyph {
	const dv = view(data);
	const components: Component[] = [];
	let o = 10;
	let flags: number;
	do {
		flags = dv.getUint16(o);
		const glyph = dv.getUint16(o + 2);
		o += 4;
		let a: number;
		let b: number;
		const xy = flags & ARGS_XY;
		if (flags & ARG_WORDS) {
			a = xy ? dv.getInt16(o) : dv.getUint16(o);
			b = xy ? dv.getInt16(o + 2) : dv.getUint16(o + 2);
			o += 4;
		} else {
			a = xy ? dv.getInt8(o) : dv.getUint8(o);
			b = xy ? dv.getInt8(o + 1) : dv.getUint8(o + 1);
			o += 2;
		}
		const size = flags & 0x8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
		components.push({
			flags,
			glyph,
			a,
			b,
			transform: data.slice(o, o + size),
		});
		o += size;
	} while (flags & MORE_COMPONENTS);
	let instructions = new Uint8Array(0);
	if (flags & HAVE_INSTRUCTIONS) {
		const n = dv.getUint16(o);
		instructions = data.slice(o + 2, o + 2 + n);
	}
	return { components, instructions };
}

export type Bbox = [number, number, number, number];

export function pointsBbox(xs: number[], ys: number[]): Bbox {
	if (xs.length === 0) return [0, 0, 0, 0];
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function header(contours: number, bbox: Bbox): number[] {
	const out = new Uint8Array(10);
	const dv = new DataView(out.buffer);
	dv.setInt16(0, contours);
	bbox.forEach((v, i) => {
		dv.setInt16(2 + 2 * i, v);
	});
	return [...out];
}

export function writeSimple(g: SimpleGlyph, bbox = pointsBbox(g.xs, g.ys)) {
	const out: number[] = header(g.endPts.length, bbox);
	for (const e of g.endPts) out.push(e >> 8, e & 0xff);
	out.push(g.instructions.length >> 8, g.instructions.length & 0xff);
	const flags: number[] = [];
	const xb: number[] = [];
	const yb: number[] = [];
	let px = 0;
	let py = 0;
	g.xs.forEach((x, i) => {
		const y = g.ys[i] as number;
		let f = g.onCurve[i] ? 1 : 0;
		if (i === 0 && g.overlap) f |= 0x40;
		const dx = x - px;
		const dy = y - py;
		if (dx === 0) f |= 0x10;
		else if (Math.abs(dx) < 256) {
			f |= 0x02 | (dx > 0 ? 0x10 : 0);
			xb.push(Math.abs(dx));
		} else xb.push((dx >> 8) & 0xff, dx & 0xff);
		if (dy === 0) f |= 0x20;
		else if (Math.abs(dy) < 256) {
			f |= 0x04 | (dy > 0 ? 0x20 : 0);
			yb.push(Math.abs(dy));
		} else yb.push((dy >> 8) & 0xff, dy & 0xff);
		flags.push(f);
		px = x;
		py = y;
	});
	const packed: number[] = [];
	for (let i = 0; i < flags.length; ) {
		const f = flags[i] as number;
		let n = 1;
		while (i + n < flags.length && flags[i + n] === f && n < 256) n++;
		if (n > 1) packed.push(f | 8, n - 1);
		else packed.push(f);
		i += n;
	}
	return concat([out, g.instructions, packed, xb, yb]);
}

export function writeComposite(g: CompositeGlyph, bbox: Bbox): Uint8Array {
	const out: number[] = header(-1, bbox);
	g.components.forEach((c, i) => {
		const xy = c.flags & ARGS_XY;
		const fits = xy
			? c.a >= -128 && c.a <= 127 && c.b >= -128 && c.b <= 127
			: c.a <= 255 && c.b <= 255;
		let flags = c.flags & ~(ARG_WORDS | MORE_COMPONENTS | HAVE_INSTRUCTIONS);
		if (!fits) flags |= ARG_WORDS;
		if (i < g.components.length - 1) flags |= MORE_COMPONENTS;
		else if (g.instructions.length) flags |= HAVE_INSTRUCTIONS;
		out.push(flags >> 8, flags & 0xff, c.glyph >> 8, c.glyph & 0xff);
		if (fits) out.push(c.a & 0xff, c.b & 0xff);
		else out.push((c.a >> 8) & 0xff, c.a & 0xff, (c.b >> 8) & 0xff, c.b & 0xff);
		out.push(...c.transform);
	});
	if (g.instructions.length)
		out.push(g.instructions.length >> 8, g.instructions.length & 0xff);
	return concat([out, g.instructions]);
}

// A component's 2x2 transform as [xx, yx, xy, yy].
export function componentMatrix(
	c: Component,
): [number, number, number, number] {
	const dv = view(c.transform);
	const f = (o: number) => dv.getInt16(o) / 16384;
	if (c.flags & 0x8) return [f(0), 0, 0, f(0)];
	if (c.flags & 0x40) return [f(0), 0, 0, f(2)];
	if (c.flags & 0x80) return [f(0), f(2), f(4), f(6)];
	return [1, 0, 0, 1];
}
