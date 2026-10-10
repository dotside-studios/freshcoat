// Cuts a font file down to the glyphs a PDF draws. Glyph ids, glyph count and
// advances of the kept glyphs stay as they are, so the content streams, the
// widths and the ToUnicode map written for the whole font hold for the subset;
// the glyphs left out are empty. Anything unexpected returns null and the
// caller embeds the file whole.
//
// Only the tables a viewer reads for a CID font with an identity map are kept.
// There is no cmap (the spec does not use one there), and no layout, kerning or
// variation tables, as only a font's default instance is ever embedded.

import { tagAt } from "./sfnt";

type Tables = Map<string, Uint8Array>;

const KEPT = [
	"head",
	"hhea",
	"hmtx",
	"maxp",
	"loca",
	"glyf",
	"cvt ",
	"fpgm",
	"prep",
	"CFF ",
	"OS/2",
	"post",
	"name",
];

const ENDCHAR = Uint8Array.of(14);

function readTables(bytes: Uint8Array): {
	version: string;
	tables: Tables;
} {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tables: Tables = new Map();
	for (let i = 0; i < dv.getUint16(4); i++) {
		const o = 12 + i * 16;
		const at = dv.getUint32(o + 8);
		const end = at + dv.getUint32(o + 12);
		if (end > bytes.length) throw new Error("table past the end");
		tables.set(tagAt(bytes, o), bytes.subarray(at, end));
	}
	return { version: tagAt(bytes, 0), tables };
}

function checksum(b: Uint8Array): number {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let sum = 0;
	const whole = b.length & ~3;
	for (let o = 0; o < whole; o += 4) sum = (sum + dv.getUint32(o)) >>> 0;
	for (let i = whole; i < b.length; i++)
		sum = (sum + ((b[i] ?? 0) << (24 - 8 * (i - whole)))) >>> 0;
	return sum;
}

function concat(parts: ArrayLike<number>[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

// The glyphs of `bytes` named in `glyphs`, and glyph 0, as a font file.
export function subsetFont(
	bytes: Uint8Array,
	glyphs: Iterable<number>,
): Uint8Array | null {
	try {
		const { version, tables } = readTables(bytes);
		const maxp = get(tables, "maxp");
		const count = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
		const keep = new Set([0, ...glyphs]);
		for (const g of keep) if (g >= count) throw new Error("no such glyph");
		const out: Tables = new Map();
		for (const tag of KEPT) {
			const table = tables.get(tag);
			if (table) out.set(tag, table);
		}
		if (version === "OTTO")
			out.set("CFF ", subsetCff(get(tables, "CFF "), count, keep));
		else subsetGlyf(tables, count, keep, out);
		out.set("hmtx", subsetHmtx(get(tables, "hmtx"), get(tables, "hhea"), keep));
		const post = get(tables, "post").slice(0, 32);
		new DataView(post.buffer).setUint32(0, 0x00030000);
		out.set("post", post);
		return assemble(version, out);
	} catch {
		return null;
	}
}

function get(tables: Tables, tag: string): Uint8Array {
	const table = tables.get(tag);
	if (!table) throw new Error(`no ${tag}`);
	return table;
}

// Advances and bearings are kept for the kept glyphs only, plus the last full
// metric, which the glyphs after it share. The rest is zeros, which deflate to
// nothing.
function subsetHmtx(hmtx: Uint8Array, hhea: Uint8Array, keep: Set<number>) {
	const metrics = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
	const out = new Uint8Array(hmtx.length);
	for (const g of [...keep, metrics - 1]) {
		const [at, size] = g < metrics ? [4 * g, 4] : [2 * (g + metrics), 2];
		out.set(hmtx.subarray(at, at + size), at);
	}
	return out;
}

// The kept glyphs' outlines, with the components of composites added to
// `keep`, and a loca table that gives every other glyph no data.
function subsetGlyf(
	tables: Tables,
	count: number,
	keep: Set<number>,
	out: Tables,
) {
	const head = get(tables, "head").slice();
	const hv = new DataView(head.buffer);
	const long = hv.getInt16(50) === 1;
	const loca = get(tables, "loca");
	const lv = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
	const glyf = get(tables, "glyf");
	const gv = new DataView(glyf.buffer, glyf.byteOffset, glyf.byteLength);
	const at = (g: number) =>
		long ? lv.getUint32(4 * g) : lv.getUint16(2 * g) * 2;
	for (const g of keep) {
		if (at(g + 1) <= at(g) || gv.getInt16(at(g)) >= 0) continue;
		let o = at(g) + 10;
		let flags: number;
		do {
			flags = gv.getUint16(o);
			const component = gv.getUint16(o + 2);
			if (component >= count) throw new Error("no such component");
			keep.add(component);
			o += 6 + (flags & 1 ? 2 : 0);
			o += flags & 0x8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0;
		} while (flags & 0x20);
	}
	const pieces: Uint8Array[] = [];
	const starts = [0];
	for (let g = 0; g < count; g++) {
		const piece = keep.has(g)
			? glyf.subarray(at(g), at(g + 1))
			: glyf.subarray(0, 0);
		if (piece.length !== (keep.has(g) ? at(g + 1) - at(g) : 0))
			throw new Error("glyph past the end");
		pieces.push(piece);
		starts.push((starts[g] as number) + ((piece.length + 3) & ~3));
	}
	const size = starts[count] as number;
	const wide = long || size > 0x1fffe;
	const newLoca = new Uint8Array(starts.length * (wide ? 4 : 2));
	const nv = new DataView(newLoca.buffer);
	starts.forEach((s, i) =>
		wide ? nv.setUint32(4 * i, s) : nv.setUint16(2 * i, s / 2),
	);
	const newGlyf = new Uint8Array(size);
	pieces.forEach((piece, g) => newGlyf.set(piece, starts[g]));
	hv.setInt16(50, wide ? 1 : 0);
	out.set("head", head);
	out.set("loca", newLoca);
	out.set("glyf", newGlyf);
}

// The sfnt of `tables`, with the directory, table padding, checksums and the
// head checksum adjustment a font file needs.
function assemble(version: string, tables: Tables): Uint8Array {
	const tags = [...tables.keys()].sort();
	const head = get(tables, "head").slice();
	new DataView(head.buffer).setUint32(8, 0);
	tables.set("head", head);
	let size = 12 + 16 * tags.length;
	const starts = tags.map((tag) => {
		const at = size;
		size += (get(tables, tag).length + 3) & ~3;
		return at;
	});
	const out = new Uint8Array(size);
	const dv = new DataView(out.buffer);
	for (let i = 0; i < 4; i++) out[i] = version.charCodeAt(i);
	const entry = Math.floor(Math.log2(tags.length));
	dv.setUint16(4, tags.length);
	dv.setUint16(6, 16 << entry);
	dv.setUint16(8, entry);
	dv.setUint16(10, 16 * tags.length - (16 << entry));
	tags.forEach((tag, i) => {
		const table = get(tables, tag);
		const o = 12 + 16 * i;
		for (let k = 0; k < 4; k++) out[o + k] = tag.charCodeAt(k);
		dv.setUint32(o + 4, checksum(table));
		dv.setUint32(o + 8, starts[i] as number);
		dv.setUint32(o + 12, table.length);
		out.set(table, starts[i]);
	});
	const at = starts[tags.indexOf("head")] as number;
	dv.setUint32(at + 8, (0xb1b0afba - checksum(out)) >>> 0);
	return out;
}

type Entry = { op: number; args: number[]; raw: Uint8Array };

// A CFF DICT's entries, a two-byte operator 12 n as 1200 + n.
function dict(b: Uint8Array): Entry[] {
	const entries: Entry[] = [];
	let args: number[] = [];
	let start = 0;
	for (let i = 0; i < b.length; ) {
		const c = b[i++] as number;
		const next = () => b[i++] as number;
		if (c <= 21) {
			entries.push({
				op: c === 12 ? 1200 + next() : c,
				args,
				raw: b.subarray(start, i),
			});
			args = [];
			start = i;
		} else if (c === 28) args.push((((next() << 8) | next()) << 16) >> 16);
		else if (c === 29)
			args.push((next() << 24) | (next() << 16) | (next() << 8) | next());
		else if (c === 30) {
			for (let v = 0; (v & 15) !== 15 && v >> 4 !== 15; ) v = next();
			args.push(Number.NaN);
		} else if (c >= 32 && c <= 246) args.push(c - 139);
		else if (c >= 247 && c <= 250) args.push((c - 247) * 256 + next() + 108);
		else if (c >= 251 && c <= 254) args.push(-(c - 251) * 256 - next() - 108);
		else throw new Error("bad dict");
	}
	if (start !== b.length) throw new Error("bad dict");
	return entries;
}

// A CFF INDEX: where each item lies in the table, and where the INDEX ends.
function index(dv: DataView, o: number) {
	const count = dv.getUint16(o);
	if (count === 0) return { items: [] as Array<[number, number]>, end: o + 2 };
	const size = dv.getUint8(o + 2);
	const offset = (i: number) => {
		let v = 0;
		for (let k = 0; k < size; k++)
			v = v * 256 + dv.getUint8(o + 3 + i * size + k);
		return v;
	};
	const base = o + 2 + (count + 1) * size;
	const items = Array.from({ length: count }, (_, i): [number, number] => [
		base + offset(i),
		base + offset(i + 1),
	]);
	const end = base + offset(count);
	if (end > dv.byteLength || items.some(([s, e]) => e < s))
		throw new Error("bad index");
	return { items, end };
}

function writeIndex(items: Uint8Array[]): Uint8Array {
	const total = items.reduce((n, p) => n + p.length, 1);
	const size =
		total < 0x100 ? 1 : total < 0x10000 ? 2 : total < 0x1000000 ? 3 : 4;
	const head = new Uint8Array(3 + (items.length + 1) * size);
	const hv = new DataView(head.buffer);
	hv.setUint16(0, items.length);
	head[2] = size;
	let at = 1;
	for (let i = 0; i <= items.length; i++) {
		for (let k = 0; k < size; k++)
			head[3 + i * size + k] = at / 256 ** (size - 1 - k);
		at += items[i]?.length ?? 0;
	}
	return concat([head, ...items]);
}

// A DICT integer that takes five bytes whatever its value.
const int = (v: number) => [29, v >>> 24, v >>> 16, v >>> 8, v];

function charsetEnd(dv: DataView, o: number, count: number): number {
	const format = dv.getUint8(o);
	if (format === 0) return o + 1 + 2 * (count - 1);
	if (format > 2) throw new Error("bad charset");
	let p = o + 1;
	for (let covered = 0; covered < count - 1; p += 2 + format) {
		const left = format === 1 ? dv.getUint8(p + 2) : dv.getUint16(p + 2);
		covered += 1 + left;
	}
	return p;
}

function encodingEnd(dv: DataView, o: number): number {
	const format = dv.getUint8(o);
	if ((format & 0x7f) > 1) throw new Error("bad encoding");
	let p = o + 2 + (format & 0x7f ? 2 : 1) * dv.getUint8(o + 1);
	if (format & 0x80) p += 1 + 3 * dv.getUint8(p);
	return p;
}

// A name-keyed CFF table with the charstrings of the glyphs not kept replaced
// by a bare endchar. Everything else is copied, moved as its offsets need.
function subsetCff(
	cff: Uint8Array,
	count: number,
	keep: Set<number>,
): Uint8Array {
	const dv = new DataView(cff.buffer, cff.byteOffset, cff.byteLength);
	const names = index(dv, dv.getUint8(2));
	const tops = index(dv, names.end);
	const shared = index(dv, index(dv, tops.end).end);
	const [top] = tops.items;
	if (tops.items.length !== 1 || !top) throw new Error("not one font");
	const entries = dict(cff.subarray(...top));
	const arg = (op: number) => entries.find((e) => e.op === op)?.args;
	if (arg(1230) || arg(1236) || arg(1237)) throw new Error("CID-keyed");
	if ((arg(1206)?.[0] ?? 2) !== 2) throw new Error("not Type 2");
	const [charStrings] = arg(17) ?? [];
	if (charStrings === undefined) throw new Error("no charstrings");
	const glyphs = index(dv, charStrings);
	if (glyphs.items.length !== count) throw new Error("glyph count");
	const slice = (o: number, end: number) => cff.subarray(o, end);
	const charset = arg(15)?.[0] ?? 0;
	const encoding = arg(16)?.[0] ?? 0;
	const [privateSize = 0, privateAt = 0] = arg(18) ?? [];
	let priv: Uint8Array = new Uint8Array(0);
	let privSize = 0;
	if (arg(18)) {
		const rest = dict(slice(privateAt, privateAt + privateSize));
		const body = concat(rest.filter((e) => e.op !== 19).map((e) => e.raw));
		const subrs = rest.find((e) => e.op === 19)?.args[0];
		privSize = body.length;
		priv = body;
		if (subrs !== undefined) {
			const local = index(dv, privateAt + subrs);
			privSize += 6;
			priv = concat([
				body,
				int(privSize),
				[19],
				slice(privateAt + subrs, local.end),
			]);
		}
	}
	const blobs = [
		charset > 2
			? slice(charset, charsetEnd(dv, charset, glyphs.items.length))
			: null,
		encoding > 1 ? slice(encoding, encodingEnd(dv, encoding)) : null,
		writeIndex(
			glyphs.items.map(([s, e], g) => (keep.has(g) ? slice(s, e) : ENDCHAR)),
		),
		priv,
	];
	const topDict = (at: number[]) =>
		concat(
			entries.map((e) =>
				e.op === 15 && charset > 2
					? [...int(at[0] as number), 15]
					: e.op === 16 && encoding > 1
						? [...int(at[1] as number), 16]
						: e.op === 17
							? [...int(at[2] as number), 17]
							: e.op === 18
								? [...int(privSize), ...int(at[3] as number), 18]
								: e.raw,
			),
		);
	const head = slice(0, names.end);
	const tail = slice(tops.end, shared.end);
	let at =
		head.length + writeIndex([topDict([0, 0, 0, 0])]).length + tail.length;
	const starts = blobs.map((blob) => {
		const o = at;
		at += blob?.length ?? 0;
		return o;
	});
	return concat([
		head,
		writeIndex([topDict(starts)]),
		tail,
		...blobs.map((b) => b ?? []),
	]);
}
