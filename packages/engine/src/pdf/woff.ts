// WOFF and WOFF2 files unpacked to the sfnt they wrap, so a PDF can embed it.
// Decompression is the platform's own (DecompressionStream); a runtime without
// Brotli leaves a WOFF2 file as it is.

import {
	type Bbox,
	HAVE_INSTRUCTIONS,
	MORE_COMPONENTS,
	pointsBbox,
	writeSimple,
} from "./glyf";
import { tagAt } from "./sfnt";
import { assemble, concat, layoutGlyf, type Tables } from "./subset";

// `bytes` as an sfnt, or null when it is neither WOFF nor WOFF2 or does not read.
export async function unwrapWoff(bytes: Uint8Array): Promise<Uint8Array | null> {
	try {
		const sig = tagAt(bytes, 0);
		if (sig === "wOFF") return await woff1(bytes);
		if (sig === "wOF2") return await woff2(bytes);
	} catch {}
	return null;
}

async function decompress(
	format: "deflate" | "brotli",
	data: Uint8Array,
): Promise<Uint8Array> {
	const ds = new DecompressionStream(format as CompressionFormat);
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function woff1(bytes: Uint8Array): Promise<Uint8Array> {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tables: Tables = new Map();
	for (let i = 0; i < dv.getUint16(12); i++) {
		const o = 44 + i * 20;
		const at = dv.getUint32(o + 4);
		const packed = dv.getUint32(o + 8);
		const size = dv.getUint32(o + 12);
		const data = bytes.subarray(at, at + packed);
		const table =
			packed < size ? await decompress("deflate", data) : data.slice();
		if (table.length !== size) throw new Error("bad table length");
		tables.set(tagAt(bytes, o), table);
	}
	return assemble(tagAt(bytes, 4), tables);
}

const KNOWN = [
	"cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ",
	"fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp",
	"hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF",
	"GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
	"SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc",
	"feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx",
	"opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

class Reader {
	o = 0;
	readonly dv: DataView;
	constructor(readonly b: Uint8Array) {
		this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	}
	u8() {
		if (this.o >= this.b.length) throw new Error("read past the end");
		return this.b[this.o++] as number;
	}
	u16() {
		const v = this.dv.getUint16(this.o);
		this.o += 2;
		return v;
	}
	i16() {
		const v = this.dv.getInt16(this.o);
		this.o += 2;
		return v;
	}
	u32() {
		const v = this.dv.getUint32(this.o);
		this.o += 4;
		return v;
	}
	bytes(n: number) {
		if (this.o + n > this.b.length) throw new Error("read past the end");
		const v = this.b.subarray(this.o, this.o + n);
		this.o += n;
		return v;
	}
	base128() {
		let v = 0;
		for (let i = 0; i < 5; i++) {
			const b = this.u8();
			if (i === 0 && b === 0x80) throw new Error("bad UIntBase128");
			if (v & 0xfe000000) throw new Error("UIntBase128 overflow");
			v = (v << 7) | (b & 0x7f);
			if (!(b & 0x80)) return v >>> 0;
		}
		throw new Error("UIntBase128 too long");
	}
	u255() {
		const code = this.u8();
		if (code === 253) return this.u16();
		if (code === 255) return this.u8() + 253;
		if (code === 254) return this.u8() + 506;
		return code;
	}
}

type Entry = { tag: string; size: number; length: number; transformed: boolean };

async function woff2(bytes: Uint8Array): Promise<Uint8Array> {
	const r = new Reader(bytes);
	r.o = 4;
	const flavor = tagAt(bytes, 4);
	if (flavor === "ttcf") throw new Error("collections are not unwrapped");
	r.o = 12;
	const count = r.u16();
	r.o = 20;
	const packed = r.u32();
	r.o = 48;
	const entries: Entry[] = [];
	for (let i = 0; i < count; i++) {
		const flags = r.u8();
		const known = flags & 0x3f;
		const tag =
			known === 63 ? tagAt(r.bytes(4), 0) : (KNOWN[known] as string);
		const version = flags >> 6;
		const size = r.base128();
		const glyfOrLoca = tag === "glyf" || tag === "loca";
		const transformed = glyfOrLoca ? version === 0 : version !== 0;
		const length = transformed ? r.base128() : size;
		entries.push({ tag, size, length, transformed });
	}
	const data = await decompress("brotli", r.bytes(packed));
	const raw = new Map<string, Uint8Array>();
	let at = 0;
	for (const e of entries) {
		if (at + e.length > data.length) throw new Error("table past the end");
		raw.set(e.tag, data.subarray(at, at + e.length));
		at += e.length;
	}
	const tables: Tables = new Map();
	for (const e of entries)
		if (!e.transformed) tables.set(e.tag, (raw.get(e.tag) as Uint8Array).slice());
	const glyf = entries.find((e) => e.tag === "glyf");
	let xMins: number[] | null = null;
	if (glyf?.transformed) {
		const out = glyfTransform(raw.get("glyf") as Uint8Array);
		const pieces: Tables = new Map(tables);
		layoutGlyf(pieces, out.glyphs, out.long, pieces);
		for (const tag of ["head", "loca", "glyf"])
			tables.set(tag, pieces.get(tag) as Uint8Array);
		xMins = out.xMins;
	}
	const hmtx = entries.find((e) => e.tag === "hmtx");
	if (hmtx?.transformed) {
		if (!xMins) throw new Error("hmtx transform without glyf");
		tables.set("hmtx", hmtxTransform(raw.get("hmtx") as Uint8Array, tables, xMins));
	}
	return assemble(flavor, tables);
}

function glyfTransform(table: Uint8Array): {
	glyphs: Uint8Array[];
	long: boolean;
	xMins: number[];
} {
	const h = new Reader(table);
	h.o = 2;
	const options = h.u16();
	const count = h.u16();
	const long = h.u16() === 1;
	const sizes = Array.from({ length: 7 }, () => h.u32());
	let o = h.o;
	const streams = sizes.map((n) => {
		const s = new Reader(table.subarray(o, o + n));
		if (o + n > table.length) throw new Error("stream past the end");
		o += n;
		return s;
	});
	const [contours, points, flags, glyph, composite, bboxes, instr] =
		streams as [Reader, Reader, Reader, Reader, Reader, Reader, Reader];
	const overlap =
		options & 1 ? table.subarray(o, o + ((count + 7) >> 3)) : null;
	const bitmap = bboxes.bytes(4 * ((count + 31) >> 5));
	const has = (bits: Uint8Array | null, g: number) =>
		bits ? ((bits[g >> 3] as number) & (0x80 >> (g & 7))) !== 0 : false;
	const glyphs: Uint8Array[] = [];
	const xMins: number[] = [];
	for (let g = 0; g < count; g++) {
		const n = contours.i16();
		const explicit: Bbox | null = has(bitmap, g)
			? [bboxes.i16(), bboxes.i16(), bboxes.i16(), bboxes.i16()]
			: null;
		if (n === 0) {
			glyphs.push(new Uint8Array(0));
			xMins.push(0);
			continue;
		}
		if (n < 0) {
			if (!explicit) throw new Error("composite without a bbox");
			const start = composite.o;
			let f: number;
			let instructions = false;
			do {
				f = composite.u16();
				composite.o += 2;
				composite.o += f & 1 ? 4 : 2;
				composite.o += f & 0x8 ? 2 : f & 0x40 ? 4 : f & 0x80 ? 8 : 0;
				if (f & HAVE_INSTRUCTIONS) instructions = true;
			} while (f & MORE_COMPONENTS);
			const body = composite.b.subarray(start, composite.o);
			const code = instructions ? instr.bytes(glyph.u255()) : new Uint8Array(0);
			const head = new Uint8Array(10);
			const dv = new DataView(head.buffer);
			dv.setInt16(0, -1);
			explicit.forEach((v, i) => dv.setInt16(2 + 2 * i, v));
			const tail = instructions ? [code.length >> 8, code.length & 0xff] : [];
			glyphs.push(concat([head, body, tail, code]));
			xMins.push(explicit[0]);
			continue;
		}
		const endPts: number[] = [];
		let total = 0;
		for (let c = 0; c < n; c++) {
			total += points.u255();
			endPts.push(total - 1);
		}
		const xs: number[] = [];
		const ys: number[] = [];
		const onCurve: boolean[] = [];
		let x = 0;
		let y = 0;
		for (let i = 0; i < total; i++) {
			const raw = flags.u8();
			onCurve.push(raw >> 7 === 0);
			const [dx, dy] = triplet(raw & 0x7f, glyph);
			x += dx;
			y += dy;
			xs.push(x);
			ys.push(y);
		}
		const instructions = instr.bytes(glyph.u255()).slice();
		const simple = {
			endPts,
			onCurve,
			xs,
			ys,
			instructions,
			overlap: has(overlap, g),
		};
		const box = explicit ?? pointsBbox(xs, ys);
		glyphs.push(writeSimple(simple, box));
		xMins.push(box[0]);
	}
	return { glyphs, long, xMins };
}

function triplet(flag: number, r: Reader): [number, number] {
	const sign = (f: number, v: number) => (f & 1 ? v : -v);
	if (flag < 10) return [0, sign(flag, ((flag & 14) << 7) + r.u8())];
	if (flag < 20) return [sign(flag, (((flag - 10) & 14) << 7) + r.u8()), 0];
	if (flag < 84) {
		const b0 = flag - 20;
		const b1 = r.u8();
		return [
			sign(flag, 1 + (b0 & 0x30) + (b1 >> 4)),
			sign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)),
		];
	}
	if (flag < 120) {
		const b0 = flag - 84;
		const b1 = r.u8();
		const b2 = r.u8();
		return [
			sign(flag, 1 + (Math.floor(b0 / 12) << 8) + b1),
			sign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + b2),
		];
	}
	if (flag < 124) {
		const b1 = r.u8();
		const b2 = r.u8();
		const b3 = r.u8();
		return [sign(flag, (b1 << 4) + (b2 >> 4)), sign(flag >> 1, ((b2 & 0x0f) << 8) + b3)];
	}
	const b1 = r.u8();
	const b2 = r.u8();
	const b3 = r.u8();
	const b4 = r.u8();
	return [sign(flag, (b1 << 8) + b2), sign(flag >> 1, (b3 << 8) + b4)];
}

function hmtxTransform(table: Uint8Array, tables: Tables, xMins: number[]) {
	const hhea = tables.get("hhea");
	if (!hhea) throw new Error("no hhea");
	const metrics = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
	const count = xMins.length;
	const r = new Reader(table);
	const flags = r.u8();
	const advances = Array.from({ length: metrics }, () => r.u16());
	const lsbs = Array.from({ length: metrics }, (_, g) =>
		flags & 1 ? (xMins[g] as number) : r.i16(),
	);
	const rest = Array.from({ length: count - metrics }, (_, k) =>
		flags & 2 ? (xMins[metrics + k] as number) : r.i16(),
	);
	const out = new Uint8Array(4 * metrics + 2 * (count - metrics));
	const dv = new DataView(out.buffer);
	advances.forEach((a, g) => {
		dv.setUint16(4 * g, a);
		dv.setInt16(4 * g + 2, lsbs[g] as number);
	});
	rest.forEach((l, k) => dv.setInt16(4 * metrics + 2 * k, l));
	return out;
}
