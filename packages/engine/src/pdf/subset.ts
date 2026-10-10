// Cuts a TrueType font file down to the glyphs a PDF draws. Glyph ids, glyph
// count and advances of the kept glyphs stay as they are, so the content
// streams, the widths and the ToUnicode map written for the whole font hold
// for the subset; the glyphs left out are empty. Anything unexpected returns
// null and the caller embeds the file whole.
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
	"OS/2",
	"post",
	"name",
];

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
		if (version !== "\0\x01\0\0" && version !== "true")
			throw new Error("not TrueType");
		subsetGlyf(tables, count, keep, out);
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
