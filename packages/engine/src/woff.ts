// WOFF and WOFF2 unpacked to the TrueType or OpenType file they wrap, for the
// readers that parse sfnt tables (font metrics, PDF embedding). CanvasKit reads
// both formats itself.

import { decompress } from "brotli/decompress";
import { unzlibSync } from "fflate";
import { assemble, type Tables } from "./sfnt-write";

const tagAt = (b: Uint8Array, o: number) =>
	String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);

/** Most bytes a WOFF or WOFF2 file may unpack to, in all its tables. */
export const MAX_UNPACKED_FONT_BYTES = 128 * 1024 * 1024;

const unpacked = new WeakMap<Uint8Array, Uint8Array>();

// The sfnt inside a WOFF or WOFF2 file, or `bytes` as given when they are
// neither. Throws on a WOFF or WOFF2 file that does not decode.
export function sfntBytes(bytes: Uint8Array): Uint8Array {
	const signature = tagAt(bytes, 0);
	if (signature !== "wOFF" && signature !== "wOF2") return bytes;
	let out = unpacked.get(bytes);
	if (!out) {
		out = signature === "wOFF" ? unpackWoff(bytes) : unpackWoff2(bytes);
		unpacked.set(bytes, out);
	}
	return out;
}

function unpackWoff(bytes: Uint8Array): Uint8Array {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tables: Tables = new Map();
	let total = 0;
	for (let i = 0; i < dv.getUint16(12); i++) {
		const o = 44 + i * 20;
		const at = dv.getUint32(o + 4);
		const compLength = dv.getUint32(o + 8);
		const origLength = dv.getUint32(o + 12);
		if (at + compLength > bytes.length) throw new Error("table past the end");
		total += origLength;
		if (total > MAX_UNPACKED_FONT_BYTES) throw new Error("font too large");
		const data = bytes.subarray(at, at + compLength);
		const table =
			compLength < origLength
				? unzlibSync(data, { out: new Uint8Array(origLength + 1) })
				: data;
		if (table.length !== origLength) throw new Error("table length mismatch");
		tables.set(tagAt(bytes, o), table);
	}
	return assemble(tagAt(bytes, 4), tables);
}

const KNOWN_TAGS = [
	"cmap",
	"head",
	"hhea",
	"hmtx",
	"maxp",
	"name",
	"OS/2",
	"post",
	"cvt ",
	"fpgm",
	"glyf",
	"loca",
	"prep",
	"CFF ",
	"VORG",
	"EBDT",
	"EBLC",
	"gasp",
	"hdmx",
	"kern",
	"LTSH",
	"PCLT",
	"VDMX",
	"vhea",
	"vmtx",
	"BASE",
	"GDEF",
	"GPOS",
	"GSUB",
	"EBSC",
	"JSTF",
	"MATH",
	"CBDT",
	"CBLC",
	"COLR",
	"CPAL",
	"SVG ",
	"sbix",
	"acnt",
	"avar",
	"bdat",
	"bloc",
	"bsln",
	"cvar",
	"fdsc",
	"feat",
	"fmtx",
	"fvar",
	"gvar",
	"hsty",
	"just",
	"lcar",
	"mort",
	"morx",
	"opbd",
	"prop",
	"trak",
	"Zapf",
	"Silf",
	"Glat",
	"Gloc",
	"Feat",
	"Sill",
];

class Reader {
	o: number;
	readonly dv: DataView;
	constructor(
		readonly b: Uint8Array,
		start = 0,
		readonly end = b.length,
	) {
		this.o = start;
		this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	}
	private need(n: number): number {
		const at = this.o;
		if (at + n > this.end) throw new Error("stream past the end");
		this.o += n;
		return at;
	}
	u8 = () => this.dv.getUint8(this.need(1));
	u16 = () => this.dv.getUint16(this.need(2));
	i16 = () => this.dv.getInt16(this.need(2));
	u32 = () => this.dv.getUint32(this.need(4));
	bytes = (n: number) => {
		const at = this.need(n);
		return this.b.subarray(at, at + n);
	};
	base128(): number {
		let value = 0;
		for (let i = 0; i < 5; i++) {
			const b = this.u8();
			if (i === 0 && b === 0x80) throw new Error("bad UIntBase128");
			if (value > 0x1ffffff) throw new Error("UIntBase128 overflow");
			value = value * 128 + (b & 0x7f);
			if (!(b & 0x80)) return value;
		}
		throw new Error("UIntBase128 too long");
	}
	u255(): number {
		const code = this.u8();
		if (code === 253) return this.u16();
		if (code === 255) return this.u8() + 253;
		if (code === 254) return this.u8() + 506;
		return code;
	}
}

type Woff2Entry = {
	tag: string;
	origLength: number;
	length: number;
	transformed: boolean;
};

function unpackWoff2(bytes: Uint8Array): Uint8Array {
	const r = new Reader(bytes);
	r.o = 4;
	const flavor = tagAt(bytes, r.o);
	r.o += 4;
	if (flavor === "ttcf") throw new Error("WOFF2 collections are unsupported");
	r.o += 4;
	const numTables = r.u16();
	r.o += 6;
	const compressedSize = r.u32();
	r.o = 48;
	const entries: Woff2Entry[] = [];
	let original = 0;
	let stream = 0;
	for (let i = 0; i < numTables; i++) {
		const flags = r.u8();
		const tag =
			(flags & 0x3f) === 0x3f ? tagAt(r.bytes(4), 0) : KNOWN_TAGS[flags & 0x3f];
		if (!tag) throw new Error("unknown table tag");
		const version = flags >> 6;
		const origLength = r.base128();
		const transformed =
			tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
		const length = transformed ? r.base128() : origLength;
		original += origLength;
		stream += length;
		if (original > MAX_UNPACKED_FONT_BYTES || stream > MAX_UNPACKED_FONT_BYTES)
			throw new Error("font too large");
		entries.push({ tag, origLength, length, transformed });
	}
	const data = decompress(r.bytes(compressedSize), stream);
	if (data.length !== stream) throw new Error("table data length mismatch");

	const raw = new Map<string, Uint8Array>();
	let at = 0;
	for (const e of entries) {
		if (at + e.length > data.length) throw new Error("table past the end");
		raw.set(e.tag, data.subarray(at, at + e.length));
		at += e.length;
	}

	const tables: Tables = new Map();
	for (const e of entries)
		if (!e.transformed) tables.set(e.tag, raw.get(e.tag) as Uint8Array);

	let xMins: Int16Array | undefined;
	const glyf = entries.find((e) => e.tag === "glyf");
	if (glyf?.transformed) {
		const head = tables.get("head");
		if (!head) throw new Error("no head");
		const out = reconstructGlyf(raw.get("glyf") as Uint8Array, head.slice());
		tables.set("glyf", out.glyf);
		tables.set("loca", out.loca);
		tables.set("head", out.head);
		xMins = out.xMins;
	} else if (entries.some((e) => e.tag === "loca" && e.transformed))
		throw new Error("transformed loca without glyf");

	const hmtx = entries.find((e) => e.tag === "hmtx");
	if (hmtx?.transformed) {
		if (!xMins) throw new Error("transformed hmtx without glyf");
		tables.set(
			"hmtx",
			reconstructHmtx(raw.get("hmtx") as Uint8Array, tables, xMins),
		);
	}
	return assemble(flavor, tables);
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME = 0x10;
const Y_SAME = 0x20;
const OVERLAP_SIMPLE = 0x40;

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

function reconstructGlyf(
	src: Uint8Array,
	head: Uint8Array,
): { glyf: Uint8Array; loca: Uint8Array; head: Uint8Array; xMins: Int16Array } {
	const h = new Reader(src);
	h.u16();
	const options = h.u16();
	const numGlyphs = h.u16();
	const indexFormat = h.u16();
	const sizes = Array.from({ length: 7 }, () => h.u32());
	let start = h.o;
	const [nContour, nPoints, flagStream, glyphStream, composite, bbox, instr] =
		sizes.map((size) => {
			const s = new Reader(src, start, start + size);
			start += size;
			if (start > src.length) throw new Error("stream past the end");
			return s;
		}) as [Reader, Reader, Reader, Reader, Reader, Reader, Reader];
	const overlap =
		options & 1 ? new Reader(src, start).bytes((numGlyphs + 7) >> 3) : null;
	const bitmap = bbox.bytes(((numGlyphs + 31) >> 5) * 4);
	const hasBox = (g: number) =>
		((bitmap[g >> 3] ?? 0) & (0x80 >> (g & 7))) !== 0;

	const xMins = new Int16Array(numGlyphs);
	const glyphs: Uint8Array[] = [];
	let glyfSize = 0;
	const push = (glyph: Uint8Array) => {
		glyfSize += (glyph.length + 3) & ~3;
		if (glyfSize > MAX_UNPACKED_FONT_BYTES) throw new Error("font too large");
		glyphs.push(glyph);
	};
	for (let g = 0; g < numGlyphs; g++) {
		const contours = nContour.i16();
		if (contours === 0) {
			if (hasBox(g)) throw new Error("empty glyph with a bbox");
			push(new Uint8Array(0));
			continue;
		}
		if (contours < 0) {
			if (!hasBox(g)) throw new Error("composite glyph without a bbox");
			const box = [bbox.i16(), bbox.i16(), bbox.i16(), bbox.i16()];
			const from = composite.o;
			let flags: number;
			let instructions = false;
			do {
				flags = composite.u16();
				instructions ||= (flags & WE_HAVE_INSTRUCTIONS) !== 0;
				let size = 2 + (flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2);
				if (flags & WE_HAVE_A_SCALE) size += 2;
				else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) size += 4;
				else if (flags & WE_HAVE_A_TWO_BY_TWO) size += 8;
				composite.bytes(size);
			} while (flags & MORE_COMPONENTS);
			const components = src.subarray(from, composite.o);
			const program = instructions ? instr.bytes(glyphStream.u255()) : null;
			const w = new Writer(
				10 + components.length + (program ? 2 + program.length : 0),
			);
			w.i16(-1);
			for (const v of box) w.i16(v);
			w.bytes(components);
			if (program) {
				w.u16(program.length);
				w.bytes(program);
			}
			xMins[g] = box[0] as number;
			push(w.out);
			continue;
		}

		const ends: number[] = [];
		let total = 0;
		for (let c = 0; c < contours; c++) {
			total += nPoints.u255();
			ends.push(total - 1);
		}
		// endPtsOfContours is 16-bit, and each point takes one flag byte.
		if (total > 0x10000 || total > flagStream.end - flagStream.o)
			throw new Error("point count past the flag stream");
		const xs = new Int32Array(total);
		const ys = new Int32Array(total);
		const on = new Uint8Array(total);
		let x = 0;
		let y = 0;
		for (let p = 0; p < total; p++) {
			const flag = flagStream.u8();
			on[p] = flag & 0x80 ? 0 : 1;
			const [dx, dy] = triplet(flag & 0x7f, glyphStream);
			x += dx;
			y += dy;
			xs[p] = x;
			ys[p] = y;
		}
		const program = instr.bytes(glyphStream.u255());
		let box: number[];
		if (hasBox(g)) box = [bbox.i16(), bbox.i16(), bbox.i16(), bbox.i16()];
		else {
			box = [xs[0] ?? 0, ys[0] ?? 0, xs[0] ?? 0, ys[0] ?? 0];
			for (let p = 1; p < total; p++) {
				box[0] = Math.min(box[0] as number, xs[p] as number);
				box[1] = Math.min(box[1] as number, ys[p] as number);
				box[2] = Math.max(box[2] as number, xs[p] as number);
				box[3] = Math.max(box[3] as number, ys[p] as number);
			}
		}
		xMins[g] = box[0] as number;
		const overlaps =
			overlap !== null && ((overlap[g >> 3] ?? 0) & (0x80 >> (g & 7))) !== 0;
		push(simpleGlyph(ends, xs, ys, on, box, program, overlaps));
	}

	const starts = [0];
	for (const glyph of glyphs)
		starts.push((starts.at(-1) as number) + ((glyph.length + 3) & ~3));
	const size = starts.at(-1) as number;
	const wide = indexFormat !== 0 || size > 0x1fffe;
	const loca = new Uint8Array(starts.length * (wide ? 4 : 2));
	const lv = new DataView(loca.buffer);
	starts.forEach((s, i) => {
		if (wide) lv.setUint32(4 * i, s);
		else lv.setUint16(2 * i, s / 2);
	});
	const glyf = new Uint8Array(size);
	glyphs.forEach((glyph, g) => {
		glyf.set(glyph, starts[g]);
	});
	new DataView(head.buffer).setInt16(50, wide ? 1 : 0);
	return { glyf, loca, head, xMins };
}

function triplet(flag: number, s: Reader): [number, number] {
	const signed = (bit: number, v: number) => (bit & 1 ? v : -v);
	if (flag < 10) return [0, signed(flag, ((flag & 14) << 7) + s.u8())];
	if (flag < 20) return [signed(flag, (((flag - 10) & 14) << 7) + s.u8()), 0];
	if (flag < 84) {
		const b0 = flag - 20;
		const b1 = s.u8();
		return [
			signed(flag, 1 + (b0 & 0x30) + (b1 >> 4)),
			signed(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)),
		];
	}
	if (flag < 120) {
		const b0 = flag - 84;
		return [
			signed(flag, 1 + (Math.floor(b0 / 12) << 8) + s.u8()),
			signed(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + s.u8()),
		];
	}
	if (flag < 124) {
		const b0 = s.u8();
		const b1 = s.u8();
		const b2 = s.u8();
		return [
			signed(flag, (b0 << 4) + (b1 >> 4)),
			signed(flag >> 1, ((b1 & 0x0f) << 8) + b2),
		];
	}
	return [signed(flag, s.u16()), signed(flag >> 1, s.u16())];
}

function simpleGlyph(
	ends: number[],
	xs: Int32Array,
	ys: Int32Array,
	on: Uint8Array,
	box: number[],
	program: Uint8Array,
	overlaps: boolean,
): Uint8Array {
	const flags: number[] = [];
	const xBytes: number[] = [];
	const yBytes: number[] = [];
	let lastFlag = -1;
	let repeats = 0;
	let lastX = 0;
	let lastY = 0;
	for (let p = 0; p < xs.length; p++) {
		let flag = on[p] ? ON_CURVE : 0;
		if (p === 0 && overlaps) flag |= OVERLAP_SIMPLE;
		const dx = (xs[p] as number) - lastX;
		const dy = (ys[p] as number) - lastY;
		lastX = xs[p] as number;
		lastY = ys[p] as number;
		if (dx === 0) flag |= X_SAME;
		else if (dx > -256 && dx < 256) {
			flag |= X_SHORT | (dx > 0 ? X_SAME : 0);
			xBytes.push(Math.abs(dx));
		} else xBytes.push((dx >> 8) & 0xff, dx & 0xff);
		if (dy === 0) flag |= Y_SAME;
		else if (dy > -256 && dy < 256) {
			flag |= Y_SHORT | (dy > 0 ? Y_SAME : 0);
			yBytes.push(Math.abs(dy));
		} else yBytes.push((dy >> 8) & 0xff, dy & 0xff);
		if (flag === lastFlag && repeats < 255) {
			repeats++;
			if (repeats === 1) {
				flags[flags.length - 1] = flag | REPEAT;
				flags.push(1);
			} else flags[flags.length - 1] = repeats;
		} else {
			flags.push(flag);
			repeats = 0;
		}
		lastFlag = flag;
	}
	const w = new Writer(
		10 +
			2 * ends.length +
			2 +
			program.length +
			flags.length +
			xBytes.length +
			yBytes.length,
	);
	w.i16(ends.length);
	for (const v of box) w.i16(v);
	for (const e of ends) w.u16(e);
	w.u16(program.length);
	w.bytes(program);
	w.bytes(flags);
	w.bytes(xBytes);
	w.bytes(yBytes);
	return w.out;
}

function reconstructHmtx(
	src: Uint8Array,
	tables: Tables,
	xMins: Int16Array,
): Uint8Array {
	const hhea = tables.get("hhea");
	const maxp = tables.get("maxp");
	if (!hhea || !maxp) throw new Error("no hhea or maxp");
	const metrics = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
	const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
	if (metrics > numGlyphs) throw new Error("more metrics than glyphs");
	const r = new Reader(src);
	const flags = r.u8();
	const advances = Array.from({ length: metrics }, () => r.u16());
	const bearing = (g: number, derived: boolean) =>
		derived ? (xMins[g] ?? 0) : r.i16();
	const w = new Writer(2 * metrics + 2 * numGlyphs);
	const lsbs = Array.from({ length: metrics }, (_, g) =>
		bearing(g, (flags & 1) !== 0),
	);
	for (let g = 0; g < metrics; g++) {
		w.u16(advances[g] as number);
		w.i16(lsbs[g] as number);
	}
	for (let g = metrics; g < numGlyphs; g++)
		w.i16(bearing(g, (flags & 2) !== 0));
	return w.out;
}

class Writer {
	readonly out: Uint8Array;
	private dv: DataView;
	private o = 0;
	constructor(size: number) {
		this.out = new Uint8Array(size);
		this.dv = new DataView(this.out.buffer);
	}
	u16(v: number) {
		this.dv.setUint16(this.o, v);
		this.o += 2;
	}
	i16(v: number) {
		this.dv.setInt16(this.o, v);
		this.o += 2;
	}
	bytes(b: ArrayLike<number>) {
		this.out.set(b, this.o);
		this.o += b.length;
	}
}
