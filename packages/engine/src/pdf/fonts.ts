// Text drawn with the font files themselves: CanvasKit shapes it and reports
// glyph ids and positions, and the page embeds the TrueType or OpenType file
// the run used, so the glyphs stay vector and the text selectable. A run whose
// file a PDF cannot carry as is has no face here and is drawn as pixels.

import type { CanvasKit, GlyphRun, Typeface } from "canvaskit-wasm";
import { fontArrayBuffer } from "../font-bytes";
import type { FontVariations } from "../types";
import { readSfnt, type SfntInfo } from "./sfnt";
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

export class FontEmbedder {
	private files = new Map<string, FontFile[]>();
	private faces = new Map<FontFile, EmbeddedFace>();

	constructor(
		private ck: CanvasKit,
		private byFamily: Map<string, Uint8Array[]>,
		private w: PdfWriter,
	) {}

	// The embeddable file CanvasKit shaped `run` with, or why there is none.
	file(
		run: GlyphRun,
		req: FaceRequest,
		text: string,
	): FontFile | { reason: string } {
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
			const cp = text.codePointAt(run.offsets[i] ?? 0);
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
			wght: req.weight,
			...req.variations,
		};
		const instanced = info.axes.some((a) => {
			const v = settings[a.tag];
			return (
				v !== undefined && Math.min(a.max, Math.max(a.min, v)) !== a.default
			);
		});
		if (instanced) return { reason: `variable font ${family}` };
		return file;
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
				list.push({
					registered,
					bytes,
					info: readSfnt(bytes),
					family: typeface?.getFamilyName() ?? registered,
					typeface,
				});
			}
		}
		return list;
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
	const base = name(
		`${file.family.replace(/[^A-Za-z0-9-]/g, "") || "Font"}-${face.id}`,
	);
	const program =
		info.outlines === "truetype"
			? { FontFile2: w.flate({ Length1: file.bytes.length }, file.bytes) }
			: {
					FontFile3: w.flate({ Subtype: name("OpenType") }, file.bytes),
				};
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
