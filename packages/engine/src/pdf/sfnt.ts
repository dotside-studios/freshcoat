// What embedding a font file in a PDF needs from it, read straight from its
// tables: the outline format, the metrics a font descriptor carries, each
// glyph's advance, and the axes of a variable font. A collection is read at
// its first face, the one CanvasKit draws.

export type SfntAxis = {
	tag: string;
	min: number;
	default: number;
	max: number;
};

export type SfntInfo = {
	// "truetype" outlines embed as FontFile2, "cff" as an OpenType FontFile3.
	// "cff2" has no PDF font type and is drawn as outlines.
	outlines: "truetype" | "cff" | "cff2";
	// A face of a collection, which a PDF cannot embed either.
	collection: boolean;
	unitsPerEm: number;
	bbox: [number, number, number, number];
	ascent: number;
	descent: number;
	capHeight: number;
	italicAngle: number;
	weight: number;
	italic: boolean;
	// The OS/2 licensing flags, or null when the font has no OS/2 table.
	fsType: number | null;
	axes: SfntAxis[];
	advance(glyph: number): number;
};

export const tagAt = (b: Uint8Array, o: number) =>
	String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);

// fsType bits 1 (restricted license), 8 (no subsetting) and 9 (bitmap
// embedding only) forbid what the writer does: embedding a subset as a vector
// font. Preview & print and editable licenses allow it, and so does a font
// with no OS/2 table.
const FS_TYPE_BLOCKS = 0x0302;

export const embeddingRestricted = (info: SfntInfo) =>
	((info.fsType ?? 0) & FS_TYPE_BLOCKS) !== 0;

export const embeddable = (info: SfntInfo) =>
	!info.collection && info.outlines !== "cff2" && !embeddingRestricted(info);

// Where a font's table directory starts: past the header of a collection.
export function faceOffset(bytes: Uint8Array): number {
	if (tagAt(bytes, 0) !== "ttcf") return 0;
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12);
}

// Null for WOFF and WOFF2 (see sfntBytes) and files whose tables do not read.
export function readSfnt(bytes: Uint8Array): SfntInfo | null {
	try {
		const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const base = faceOffset(bytes);
		const version = tagAt(bytes, base);
		const truetype = version === "\0\x01\0\0" || version === "true";
		if (!truetype && version !== "OTTO") return null;
		const tables = new Map<string, number>();
		const count = dv.getUint16(base + 4);
		for (let i = 0; i < count; i++) {
			const o = base + 12 + i * 16;
			tables.set(tagAt(bytes, o), dv.getUint32(o + 8));
		}
		const head = tables.get("head");
		const hhea = tables.get("hhea");
		const hmtx = tables.get("hmtx");
		if (head === undefined || hhea === undefined || hmtx === undefined)
			return null;
		const cff = tables.has("CFF ") ? "cff" : tables.has("CFF2") ? "cff2" : null;
		if (truetype ? !tables.has("glyf") : !cff) return null;
		const unitsPerEm = dv.getUint16(head + 18);
		if (!unitsPerEm) return null;
		const os2 = tables.get("OS/2");
		const post = tables.get("post");
		const fvar = tables.get("fvar");
		const metrics = dv.getUint16(hhea + 34);
		const axes: SfntAxis[] = [];
		if (fvar !== undefined) {
			const first = fvar + dv.getUint16(fvar + 4);
			const size = dv.getUint16(fvar + 10);
			for (let i = 0; i < dv.getUint16(fvar + 8); i++) {
				const o = first + i * size;
				axes.push({
					tag: tagAt(bytes, o).trim(),
					min: dv.getInt32(o + 4) / 65536,
					default: dv.getInt32(o + 8) / 65536,
					max: dv.getInt32(o + 12) / 65536,
				});
			}
		}
		return {
			outlines: truetype ? "truetype" : (cff as "cff" | "cff2"),
			collection: base > 0,
			unitsPerEm,
			bbox: [
				dv.getInt16(head + 36),
				dv.getInt16(head + 38),
				dv.getInt16(head + 40),
				dv.getInt16(head + 42),
			],
			ascent: dv.getInt16(hhea + 4),
			descent: dv.getInt16(hhea + 6),
			capHeight:
				os2 !== undefined && dv.getUint16(os2) >= 2
					? dv.getInt16(os2 + 88)
					: dv.getInt16(hhea + 4),
			italicAngle: post !== undefined ? dv.getInt32(post + 4) / 65536 : 0,
			weight: os2 !== undefined ? dv.getUint16(os2 + 4) : 400,
			italic:
				os2 !== undefined
					? (dv.getUint16(os2 + 62) & 1) === 1
					: (dv.getUint16(head + 44) & 2) === 2,
			fsType: os2 !== undefined ? dv.getUint16(os2 + 8) : null,
			axes,
			advance: (glyph) =>
				dv.getUint16(hmtx + 4 * Math.min(glyph, Math.max(0, metrics - 1))),
		};
	} catch {
		return null;
	}
}
