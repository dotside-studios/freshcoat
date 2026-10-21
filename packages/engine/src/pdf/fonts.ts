// Text drawn with the font files themselves: CanvasKit shapes it and reports
// glyph ids and positions, and the page embeds the glyphs used from the
// TrueType or OpenType file the run used, so the glyphs stay vector and the
// text selectable. A WOFF or WOFF2 file is unwrapped first, and a variable
// TrueType font is fixed at the instance the run was drawn at. A file that
// cannot be cut down is embedded whole. A face a PDF cannot carry, in a
// collection or with CFF2 outlines, is drawn with its glyph outlines instead.

import type { CanvasKit, GlyphRun, Typeface } from "canvaskit-wasm";
import { fontArrayBuffer } from "../font-bytes";
import type { FontVariations } from "../types";
import { sfntBytes } from "../woff";
import { instanceFont } from "./instance";
import { type GlyphOutlines, readOutlines } from "./outlines";
import {
	embeddable,
	embeddingRestricted,
	readSfnt,
	type SfntInfo,
} from "./sfnt";
import { subsetFont } from "./subset";
import { name, type PdfDict, type PdfRef, type PdfWriter } from "./writer";

export type FontFile = {
	registered: string;
	bytes: Uint8Array;
	info: SfntInfo | null;
	family: string;
	typeface: Typeface | null;
};

export type EmbeddedFace = {
	// The font's resource name on the page.
	id: string;
	ref: PdfRef;
	info: SfntInfo;
	file: FontFile;
	// Each glyph drawn, with the text it stands for.
	used: Map<number, string>;
};

export type FaceRequest = {
	weight: number;
	italic: boolean;
	variations?: FontVariations;
};

// Why a font is not embedded, and the family whose license forbids it when
// that is the reason.
export type Unembeddable = { reason: string; restricted?: string };

// The file a run was shaped with, and the axis values it was drawn at where
// they are not the font's defaults.
export type FaceMatch = { file: FontFile; coords: Record<string, number> };

const coordsKey = (coords: Record<string, number>) =>
	Object.entries(coords)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([t, v]) => `${t}=${v}`)
		.join(",");

export class FontEmbedder {
	private files = new Map<string, FontFile[]>();
	private faces = new Map<FontFile, EmbeddedFace>();
	private instances = new Map<FontFile, Map<string, FontFile | null>>();
	private outlineSets = new Map<FontFile, Map<string, GlyphOutlines | null>>();

	constructor(
		private ck: CanvasKit,
		private byFamily: Map<string, Uint8Array[]>,
		private w: PdfWriter,
	) {}

	// The embeddable file CanvasKit shaped `run` with, or why there is none.
	// `clusters` holds the text of each cluster by its UTF-8 offset.
	file(
		run: GlyphRun,
		req: FaceRequest,
		clusters: Map<number, string>,
	): FontFile | Unembeddable {
		const m = this.match(run, req, clusters);
		return "reason" in m ? m : this.embeddable(m);
	}

	// The file CanvasKit shaped `run` with, or why it is not known.
	match(
		run: GlyphRun,
		req: FaceRequest,
		clusters: Map<number, string>,
	): FaceMatch | { reason: string } {
		const family = run.typeface?.getFamilyName() ?? "";
		const named = [...this.open(family)];
		if (named.length === 0)
			for (const registered of this.byFamily.keys())
				named.push(...this.open(registered).filter((f) => f.family === family));
		if (named.length === 0) return { reason: `font ${family || "unknown"}` };
		if (named.some((f) => !f.info))
			return { reason: `font ${family} is not TrueType or OpenType` };
		const ranked = named
			.map((f) => ({ f, score: score(f.info as SfntInfo, req) }))
			.sort((a, b) => a.score - b.score)
			.map(({ f }) => f);
		const probes: Array<[string, number]> = [];
		for (let i = 0; i < run.glyphs.length && probes.length < 4; i++) {
			const cp = clusters.get(run.offsets[i] ?? 0)?.codePointAt(0);
			if (cp === undefined || cp <= 0x20) continue;
			const ch = String.fromCodePoint(cp);
			const id = run.typeface?.getGlyphIDs(ch)[0];
			if (id !== undefined && id === run.glyphs[i]) probes.push([ch, id]);
		}
		const file = ranked.find((f) =>
			probes.every(([ch, id]) => f.typeface?.getGlyphIDs(ch)[0] === id),
		);
		if (!file) return { reason: `font ${family}` };
		const info = file.info as SfntInfo;
		const settings: Record<string, number> = {
			wght: req.weight || 400,
			...req.variations,
		};
		const coords: Record<string, number> = {};
		for (const a of info.axes) {
			const v = settings[a.tag];
			if (v === undefined) continue;
			const c = Math.min(a.max, Math.max(a.min, v));
			if (c !== a.default) coords[a.tag] = c;
		}
		return { file, coords };
	}

	// The file a PDF embeds for `m`, fixed at its instance.
	embeddable({ file, coords }: FaceMatch): FontFile | Unembeddable {
		const info = file.info as SfntInfo;
		if (embeddingRestricted(info))
			return {
				reason: `font ${file.family} does not allow embedding`,
				restricted: file.family,
			};
		if (!embeddable(info))
			return {
				reason: info.collection
					? `font ${file.family} is in a collection`
					: `font ${file.family} has CFF2 outlines`,
			};
		if (Object.keys(coords).length === 0) return file;
		return (
			this.instance(file, coords) ?? { reason: `variable font ${file.family}` }
		);
	}

	// The glyph outlines of `m` at its instance, read once per instance.
	outlines({ file, coords }: FaceMatch): GlyphOutlines | null {
		let byKey = this.outlineSets.get(file);
		if (!byKey) {
			byKey = new Map();
			this.outlineSets.set(file, byKey);
		}
		const key = coordsKey(coords);
		if (!byKey.has(key)) byKey.set(key, readOutlines(file.bytes, coords));
		return byKey.get(key) ?? null;
	}

	// `file` fixed at `coords`, made once per instance.
	private instance(
		file: FontFile,
		coords: Record<string, number>,
	): FontFile | null {
		let byKey = this.instances.get(file);
		if (!byKey) {
			byKey = new Map();
			this.instances.set(file, byKey);
		}
		const key = coordsKey(coords);
		if (byKey.has(key)) return byKey.get(key) ?? null;
		const bytes = instanceFont(file.bytes, coords);
		const info = bytes ? readSfnt(bytes) : null;
		const made = bytes && info ? { ...file, bytes, info } : null;
		byKey.set(key, made);
		return made;
	}

	// The page's font for `file`, embedded with the page.
	embed(file: FontFile): EmbeddedFace {
		const info = file.info as SfntInfo;
		let face = this.faces.get(file);
		if (!face) {
			face = {
				id: `F${this.faces.size}`,
				ref: this.w.reserve(),
				info,
				file,
				used: new Map(),
			};
			this.faces.set(file, face);
		}
		return face;
	}

	// The Font resources the page names, written once every glyph is known.
	write(): Record<string, PdfRef> {
		const out: Record<string, PdfRef> = {};
		for (const face of this.faces.values()) {
			writeFace(this.w, face);
			out[face.id] = face.ref;
		}
		return out;
	}

	dispose() {
		for (const list of this.files.values())
			for (const f of list) f.typeface?.delete();
		this.files.clear();
	}

	// The files registered under `registered`, made on first use.
	private open(registered: string): FontFile[] {
		let list = this.files.get(registered);
		if (!list) {
			list = [];
			this.files.set(registered, list);
			for (const bytes of this.byFamily.get(registered) ?? []) {
				const typeface = this.ck.Typeface.MakeTypefaceFromData(
					fontArrayBuffer(bytes),
				);
				const sfnt = unpack(bytes);
				list.push({
					registered,
					bytes: sfnt,
					info: readSfnt(sfnt),
					family: typeface?.getFamilyName() ?? registered,
					typeface,
				});
			}
		}
		return list;
	}
}

function unpack(bytes: Uint8Array): Uint8Array {
	try {
		return sfntBytes(bytes);
	} catch {
		return bytes;
	}
}

// CSS font matching's order: style first, then the distance in weight.
function score(info: SfntInfo, req: FaceRequest): number {
	const wght = info.axes.find((a) => a.tag === "wght");
	const [lo, hi] = wght ? [wght.min, wght.max] : [info.weight, info.weight];
	const distance =
		req.weight < lo ? lo - req.weight : req.weight > hi ? req.weight - hi : 0;
	return (info.italic === req.italic ? 0 : 10000) + distance;
}

function writeFace(w: PdfWriter, face: EmbeddedFace) {
	const { info, file } = face;
	const em = (v: number) => (v * 1000) / info.unitsPerEm;
	const subset = subsetFont(file.bytes, face.used.keys());
	const bytes = subset ?? file.bytes;
	const family = file.family.replace(/[^A-Za-z0-9-]/g, "") || "Font";
	const base = name(
		`${subset ? `${subsetTag(subset)}+` : ""}${family}-${face.id}`,
	);
	const program =
		info.outlines === "truetype"
			? { FontFile2: w.flate({ Length1: bytes.length }, bytes) }
			: { FontFile3: w.flate({ Subtype: name("OpenType") }, bytes) };
	const descriptor = w.add({
		Type: name("FontDescriptor"),
		FontName: base,
		Flags: 4,
		FontBBox: info.bbox.map(em),
		ItalicAngle: info.italicAngle,
		Ascent: em(info.ascent),
		Descent: em(info.descent),
		CapHeight: em(info.capHeight),
		StemV: 80,
		...program,
	});
	const glyphs = [...face.used.keys()].sort((a, b) => a - b);
	const widths: Array<number | number[]> = [];
	for (const g of glyphs) widths.push(g, [em(info.advance(g))]);
	const cid: PdfDict = {
		Type: name("Font"),
		Subtype: name(
			info.outlines === "truetype" ? "CIDFontType2" : "CIDFontType0",
		),
		BaseFont: base,
		CIDSystemInfo: { Registry: "Adobe", Ordering: "Identity", Supplement: 0 },
		FontDescriptor: descriptor,
		DW: 0,
		W: widths,
		...(info.outlines === "truetype" ? { CIDToGIDMap: name("Identity") } : {}),
	};
	w.set(face.ref, {
		Type: name("Font"),
		Subtype: name("Type0"),
		BaseFont: base,
		Encoding: name("Identity-H"),
		DescendantFonts: [w.add(cid)],
		ToUnicode: w.flate({}, toUnicode(face.used)),
	});
}

// Six capital letters from a hash of the subset, as the spec asks of its name.
export function subsetTag(bytes: Uint8Array): string {
	let h = 2166136261;
	for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
	let tag = "";
	for (let i = 0; i < 6; i++) {
		tag += String.fromCharCode(65 + (h % 26));
		h = Math.floor(h / 26);
	}
	return tag;
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();

function toUnicode(used: Map<number, string>): string {
	const entries = [...used].filter(([, text]) => text.length > 0);
	const blocks: string[] = [];
	for (let i = 0; i < entries.length; i += 100) {
		const chunk = entries.slice(i, i + 100);
		blocks.push(
			`${chunk.length} beginbfchar\n${chunk
				.map(
					([g, text]) =>
						`<${hex4(g)}> <${[...text]
							.flatMap((c) =>
								Array.from({ length: c.length }, (_, k) => c.charCodeAt(k)),
							)
							.map(hex4)
							.join("")}>`,
				)
				.join("\n")}\nendbfchar`,
		);
	}
	return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${blocks.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;
}
