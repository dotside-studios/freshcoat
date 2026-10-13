import {
	type BleedMm,
	type CardSizeMm,
	cardSizeMm,
	MM_PER_INCH,
	resolveBleedMm,
} from "@freshcoat-js/coatfile";
import {
	type OutputIntent,
	type ResolvedOutputIntent,
	resolveOutputIntent,
	SRGB_PROFILE,
} from "@freshcoat-js/engine/icc";
import {
	iccComponents,
	jpegFrame,
	jpegIccProfile,
	rgbIdat,
} from "@freshcoat-js/engine/image";
import { mergeFontSubsets, subsetTag } from "@freshcoat-js/engine/pdf";
import { normalizePath } from "@freshcoat-js/engine/svg";
import { crc32 } from "./crc";
import { CUT_KINDS, CUT_STYLES, type ItemCuts } from "./cut";
import { cropMarks, imposeSheets } from "./impose";
import type { PdfLayout, PdfPage } from "./types";

export { rgbIdat };

type PdfLib = typeof import("pdf-lib");
type PDFDocument = import("pdf-lib").PDFDocument;
type PDFPage = import("pdf-lib").PDFPage;
type PDFRef = import("pdf-lib").PDFRef;
type PDFDict = import("pdf-lib").PDFDict;
type PDFRawStream = import("pdf-lib").PDFRawStream;
type PDFObject = import("pdf-lib").PDFObject;
type PDFArray = import("pdf-lib").PDFArray;
type PDFEmbeddedPage = import("pdf-lib").PDFEmbeddedPage;

/** An embedded page image, or a vector page drawn as a form. */
type Embedded = PDFRef | PDFEmbeddedPage;

export type AssemblePdfOptions = {
	/** pixels per inch: a page is `widthPx / dpi` inches wide */
	dpi: number;
	title?: string;
	/** creation and modification date; fixing it makes the bytes repeatable */
	date?: Date;
	/** default one image per page */
	layout?: PdfLayout;
	/** on sheets, the trim size every card is drawn at; defaults to the first
	 *  page's pixels at `dpi`, less any bleed */
	cardMm?: CardSizeMm;
	/** the bleed every image carries around its trim. On sheets, each card is
	 *  placed by its trim with the bleed outside it; one per page, each page
	 *  gets a trim box inside its bleed box */
	bleedMm?: number | BleedMm;
	/** called after each image is embedded */
	onProgress?: (done: number, total: number) => void;
	/** what the PDF declares it was prepared for: by default sRGB, a profile
	 *  of the press's condition instead, false for none. While one is
	 *  declared, every page reads its RGB as sRGB */
	outputIntent?: OutputIntent | false;
};

const CROP_MARK_WIDTH_PT = 0.25;
const CUT_LINE_WIDTH_PT = 0.25;
const CUT_GROUP_NAME = "Cut";

const POINTS_PER_INCH = 72;
const PT_PER_MM = POINTS_PER_INCH / MM_PER_INCH;

/** Page size in points for an image of this many pixels at this DPI. */
export function pageSizePt(
	widthPx: number,
	heightPx: number,
	dpi: number,
): [number, number] {
	return [
		(widthPx / dpi) * POINTS_PER_INCH,
		(heightPx / dpi) * POINTS_PER_INCH,
	];
}

/** One page per image, each filled edge to edge by it and sized by its own
 *  image, so pages of different sizes can share a document. With a sheet
 *  layout, the images are imposed on sheets of paper instead, each drawn at
 *  the card's size, with crop marks at the trim on the pages that aren't
 *  backs. A page given as a one-page PDF is drawn as its vectors, sized as an
 *  image of `widthPx` by `heightPx` would be. A page with `cut` lines gets
 *  them stroked over its image, in an optional content group named Cut that a
 *  viewer can hide. */
export async function assemblePdf(
	pages: readonly PdfPage[],
	options: AssemblePdfOptions,
): Promise<Uint8Array> {
	if (!(options.dpi > 0))
		throw new Error(`dpi must be positive: ${options.dpi}`);
	const intent = resolveOutputIntent(options.outputIntent);
	const lib = await import("pdf-lib");
	const { PDFDocument, rgb } = lib;
	// Left to itself, pdf-lib names itself the producer and stamps the time.
	const doc = await PDFDocument.create({ updateMetadata: false });
	const date = options.date ?? new Date();
	if (options.title !== undefined) doc.setTitle(options.title);
	doc.setCreator("Freshcoat Studio");
	doc.setProducer("Freshcoat Studio (pdf-lib)");
	doc.setCreationDate(date);
	doc.setModificationDate(date);
	const bleed = resolveBleedMm(options.bleedMm);
	const profiles: IccProfiles = new Map();
	let embedded = 0;
	const cache = new Map<PdfPage, Promise<Embedded>>();
	const embed = (page: PdfPage): Promise<Embedded> => {
		let ref = cache.get(page);
		if (!ref) {
			ref = embedOnce(page);
			cache.set(page, ref);
		}
		return ref;
	};
	const embedOnce = async (page: PdfPage): Promise<Embedded> => {
		const ref =
			page.format === "pdf"
				? ((await doc.embedPdf(page.bytes))[0] as PDFEmbeddedPage)
				: page.format === "jpeg"
					? (embedProfiledJpeg(lib, doc, page.bytes, profiles) ??
						(await doc.embedJpg(page.bytes)).ref)
					: (embedRgbPng(lib, doc, page.bytes) ??
						(await doc.embedPng(page.bytes)).ref);
		options.onProgress?.(++embedded, pages.length);
		return ref;
	};
	let cutGroup: PDFRef | undefined;
	const drawCut = (
		out: PDFPage,
		cut: ItemCuts,
		rect: { x: number; y: number; width: number; height: number },
	) => {
		if (cut.lines.length === 0) return;
		const { PDFName, PDFOperator, PDFOperatorNames } = lib;
		if (!cutGroup) {
			cutGroup = doc.context.register(
				doc.context.obj({
					Type: "OCG",
					Name: lib.PDFHexString.fromText(CUT_GROUP_NAME),
				}),
			);
			doc.catalog.set(
				PDFName.of("OCProperties"),
				doc.context.obj({
					OCGs: [cutGroup],
					D: { Order: [cutGroup], ON: [cutGroup] },
				}),
			);
		}
		const resources = out.node.Resources();
		if (!resources) return;
		let properties = resources.lookupMaybe(
			PDFName.of("Properties"),
			lib.PDFDict,
		);
		if (!properties) {
			properties = doc.context.obj({});
			resources.set(PDFName.of("Properties"), properties);
		}
		properties.set(PDFName.of(CUT_GROUP_NAME), cutGroup);
		const sx = rect.width / cut.width;
		const sy = rect.height / cut.height;
		const at = (x: number, y: number) => ({
			x: rect.x + x * sx,
			y: rect.y + rect.height - y * sy,
		});
		const ops = [
			PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
				PDFName.of("OC"),
				PDFName.of(CUT_GROUP_NAME),
			]),
			lib.pushGraphicsState(),
			lib.setLineWidth(CUT_LINE_WIDTH_PT),
		];
		for (const kind of CUT_KINDS) {
			const [r, g, b] = CUT_STYLES[kind].rgb;
			const color = lib.setStrokingColor(rgb(r, g, b));
			for (const line of cut.lines) {
				if (line.kind !== kind) continue;
				ops.push(color);
				for (const s of normalizePath(line.path)) {
					if (s.op === "M") {
						const p = at(s.x, s.y);
						ops.push(lib.moveTo(p.x, p.y));
					} else if (s.op === "L") {
						const p = at(s.x, s.y);
						ops.push(lib.lineTo(p.x, p.y));
					} else if (s.op === "C") {
						const a = at(s.x1, s.y1);
						const b = at(s.x2, s.y2);
						const p = at(s.x, s.y);
						ops.push(lib.appendBezierCurve(a.x, a.y, b.x, b.y, p.x, p.y));
					} else ops.push(lib.closePath());
				}
				ops.push(lib.stroke());
			}
		}
		ops.push(
			lib.popGraphicsState(),
			PDFOperator.of(PDFOperatorNames.EndMarkedContent),
		);
		out.pushOperators(...ops);
	};
	const draw = (
		out: PDFPage,
		ref: Embedded,
		rect: { x: number; y: number; width: number; height: number },
	) => {
		if (!(ref instanceof lib.PDFRef)) {
			out.drawPage(ref, rect);
			return;
		}
		const name = out.node.newXObject("Image", ref);
		out.pushOperators(
			...lib.drawImage(name, {
				...rect,
				rotate: lib.degrees(0),
				xSkew: lib.degrees(0),
				ySkew: lib.degrees(0),
			}),
		);
	};
	if (options.layout?.kind === "sheet") {
		const first = pages[0];
		const card = options.cardMm ?? trimOf(first, options.dpi, bleed);
		const imposition = imposeSheets(pages, card, options.layout, {
			bleedMm: bleed,
		});
		const width = imposition.paper.widthMm * PT_PER_MM;
		const height = imposition.paper.heightMm * PT_PER_MM;
		const marks = options.layout.cropMarks ? cropMarks(imposition) : [];
		for (const sheet of imposition.pages) {
			const out = doc.addPage([width, height]);
			for (const slot of sheet.slots) {
				const image = await embed(slot.item);
				// pdf-lib measures up from the bottom-left corner.
				const art = {
					x: (slot.xMm - bleed.left) * PT_PER_MM,
					y: height - (slot.yMm + card.heightMm + bleed.bottom) * PT_PER_MM,
					width: (card.widthMm + bleed.left + bleed.right) * PT_PER_MM,
					height: (card.heightMm + bleed.top + bleed.bottom) * PT_PER_MM,
				};
				draw(out, image, art);
				if (slot.item.cut) drawCut(out, slot.item.cut, art);
			}
			if (sheet.side === "back") continue;
			for (const mark of marks) {
				out.drawLine({
					start: { x: mark.x1 * PT_PER_MM, y: height - mark.y1 * PT_PER_MM },
					end: { x: mark.x2 * PT_PER_MM, y: height - mark.y2 * PT_PER_MM },
					thickness: CROP_MARK_WIDTH_PT,
					color: rgb(0, 0, 0),
				});
			}
		}
		await finishDocument(lib, doc, intent, profiles);
		return doc.save();
	}
	for (const page of pages) {
		const image = await embed(page);
		const [width, height] = pageSizePt(
			page.widthPx,
			page.heightPx,
			options.dpi,
		);
		const out = doc.addPage([width, height]);
		draw(out, image, { x: 0, y: 0, width, height });
		if (page.cut) drawCut(out, page.cut, { x: 0, y: 0, width, height });
		if (Object.values(bleed).some((n) => n > 0)) {
			out.setBleedBox(0, 0, width, height);
			out.setTrimBox(
				bleed.left * PT_PER_MM,
				bleed.bottom * PT_PER_MM,
				width - (bleed.left + bleed.right) * PT_PER_MM,
				height - (bleed.top + bleed.bottom) * PT_PER_MM,
			);
		}
	}
	await finishDocument(lib, doc, intent, profiles);
	return doc.save();
}

async function finishDocument(
	lib: PdfLib,
	doc: PDFDocument,
	intent: ResolvedOutputIntent | null,
	profiles: IccProfiles,
) {
	shareFontFiles(lib, doc);
	if (intent) declareOutputIntent(lib, doc, intent, profiles);
	await doc.flush();
	shareIccProfiles(lib, doc, profiles);
}

/** Adds the intent to the catalog, and tags every page's RGB as sRGB. */
function declareOutputIntent(
	lib: PdfLib,
	doc: PDFDocument,
	intent: ResolvedOutputIntent,
	profiles: IccProfiles,
) {
	const { context } = doc;
	const { PDFHexString, PDFName } = lib;
	const text = (s: string) => PDFHexString.fromText(s);
	const dict = context.obj({
		Type: "OutputIntent",
		S: "GTS_PDFX",
		DestOutputProfile: embedIccProfile(
			doc,
			intent.profile,
			intent.components,
			profiles,
		),
	});
	dict.set(PDFName.of("OutputConditionIdentifier"), text(intent.identifier));
	dict.set(PDFName.of("Info"), text(intent.info));
	if (intent.registry)
		dict.set(PDFName.of("RegistryName"), text(intent.registry));
	doc.catalog.set(PDFName.of("OutputIntents"), context.obj([dict]));
	const srgb = embedIccProfile(doc, SRGB_PROFILE, 3, profiles);
	for (const page of doc.getPages()) {
		const { Resources } = page.node.normalizedEntries();
		Resources.set(
			PDFName.of("ColorSpace"),
			context.obj({ DefaultRGB: [PDFName.of("ICCBased"), srgb] }),
		);
	}
}

/** Points every ICCBased space at one stream per distinct profile, the
 *  first this document wrote, and drops the copies that vector pages bring
 *  with them. */
function shareIccProfiles(
	lib: PdfLib,
	doc: PDFDocument,
	profiles: IccProfiles,
) {
	const { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, PDFStream } = lib;
	const { context } = doc;
	const iccBased = PDFName.of("ICCBased");
	const ours = new Set<PDFRef>();
	for (const list of profiles.values()) for (const p of list) ours.add(p.ref);
	const found = new Set<PDFRef>();
	const walk = (obj: PDFObject | undefined, visit: (a: PDFArray) => void) => {
		if (obj instanceof PDFArray) {
			visit(obj);
			for (const item of obj.asArray()) walk(item, visit);
		} else if (obj instanceof PDFDict) {
			for (const [, value] of obj.entries()) walk(value, visit);
		} else if (obj instanceof PDFStream) walk(obj.dict, visit);
	};
	const each = (visit: (a: PDFArray) => void) => {
		for (const [, obj] of context.enumerateIndirectObjects()) walk(obj, visit);
	};
	each((array) => {
		const ref = array.get(1);
		if (array.get(0) === iccBased && ref instanceof PDFRef && !ours.has(ref))
			found.add(ref);
	});
	const replaced = new Map<PDFRef, PDFRef>();
	for (const ref of found) {
		const stream = context.lookup(ref);
		if (!(stream instanceof PDFRawStream)) continue;
		let bytes: Uint8Array;
		try {
			bytes = lib.decodePDFRawStream(stream).decode();
		} catch {
			continue;
		}
		const key = crc32(bytes);
		const same = profiles.get(key) ?? [];
		const first = same.find((p) => sameBytes(p.bytes, bytes));
		if (first) replaced.set(ref, first.ref);
		else profiles.set(key, [...same, { bytes, ref }]);
	}
	if (replaced.size === 0) return;
	each((array) => {
		array.asArray().forEach((item, i) => {
			const to = item instanceof PDFRef ? replaced.get(item) : undefined;
			if (to) array.set(i, to);
		});
	});
	for (const ref of replaced.keys()) context.delete(ref);
}

/** Points every font descriptor at one copy of each embedded font file and
 *  drops the others. Each vector page carries the glyphs it uses, so pages
 *  that draw the same ones share a file, and the subsets of one font that
 *  differ are merged into one file with the glyphs of them all. */
function shareFontFiles(lib: PdfLib, doc: PDFDocument) {
	const { PDFDict, PDFName, PDFRawStream, PDFRef } = lib;
	const type = PDFName.of("Type");
	const descriptor = PDFName.of("FontDescriptor");
	const seen = new Map<string, Array<{ ref: PDFRef; bytes: Uint8Array }>>();
	for (const [, obj] of doc.context.enumerateIndirectObjects()) {
		if (!(obj instanceof PDFDict) || obj.get(type) !== descriptor) continue;
		for (const key of ["FontFile2", "FontFile3"].map((k) => PDFName.of(k))) {
			const ref = obj.get(key);
			if (!(ref instanceof PDFRef)) continue;
			const file = doc.context.lookup(ref);
			if (!(file instanceof PDFRawStream)) continue;
			const bytes = file.getContents();
			const hash = `${key.asString()}:${bytes.length}:${crc32(bytes)}`;
			const same = seen.get(hash) ?? [];
			const first = same.find(
				(s) => s.ref === ref || sameBytes(s.bytes, bytes),
			);
			if (!first) {
				seen.set(hash, [...same, { ref, bytes }]);
				continue;
			}
			if (first.ref === ref) continue;
			obj.set(key, first.ref);
			doc.context.delete(ref);
		}
	}
	mergeFontSubsetFiles(lib, doc);
}

/** Replaces the files of the subsets of one font by a file with all their
 *  glyphs, renaming the fonts that name it. Subsets are of one font when
 *  `mergeFontSubsets` takes them; a name alone does not say, as the engine
 *  numbers a page's faces from `F0` and the order differs between pages. Each
 *  page keeps its own widths and text map, which list that page's glyphs, and
 *  glyph ids are the same in every subset. */
function mergeFontSubsetFiles(lib: PdfLib, doc: PDFDocument) {
	const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef } = lib;
	const field = (dict: PDFDict, key: string) => dict.get(PDFName.of(key));
	const parents = new Map<PDFRef, PDFDict>();
	const cids = new Map<PDFRef, { ref: PDFRef; dict: PDFDict }>();
	const descriptors: Array<{ ref: PDFRef; dict: PDFDict }> = [];
	for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
		if (!(obj instanceof PDFDict)) continue;
		const kind = field(obj, "Type");
		if (kind === PDFName.of("FontDescriptor"))
			descriptors.push({ ref, dict: obj });
		if (kind !== PDFName.of("Font")) continue;
		const fonts = field(obj, "DescendantFonts");
		if (fonts instanceof PDFArray)
			for (const font of fonts.asArray())
				if (font instanceof PDFRef) parents.set(font, obj);
		const owned = field(obj, "FontDescriptor");
		if (owned instanceof PDFRef) cids.set(owned, { ref, dict: obj });
	}
	type Group = {
		key: string;
		rest: string;
		stream: PDFRawStream;
		merged: Uint8Array;
		files: Map<PDFRef, Array<{ ref: PDFRef; dict: PDFDict }>>;
	};
	const groups = new Map<string, Group[]>();
	const decoded = new Map<PDFRef, Uint8Array | null>();
	for (const entry of descriptors) {
		const name = field(entry.dict, "FontName");
		const rest =
			name instanceof PDFName &&
			/^[A-Z]{6}\+(.+)$/.exec(name.decodeText())?.[1];
		if (!rest) continue;
		for (const key of ["FontFile2", "FontFile3"]) {
			const ref = field(entry.dict, key);
			if (!(ref instanceof PDFRef)) continue;
			const stream = doc.context.lookup(ref);
			if (!(stream instanceof PDFRawStream)) continue;
			let bytes = decoded.get(ref);
			if (bytes === undefined) {
				try {
					bytes = lib.decodePDFRawStream(stream).decode();
				} catch {
					bytes = null;
				}
				decoded.set(ref, bytes);
			}
			if (!bytes) continue;
			const family = `${key}:${rest.replace(/-F\d+$/, "")}`;
			const list = groups.get(family) ?? [];
			groups.set(family, list);
			const owners = list.find((g) => g.files.has(ref));
			if (owners) {
				owners.files.get(ref)?.push(entry);
				continue;
			}
			const files = new Map([[ref, [entry]]]);
			let joined = false;
			for (const group of list) {
				const merged = mergeFontSubsets([group.merged, bytes]);
				if (!merged) continue;
				group.merged = merged;
				group.files.set(ref, [entry]);
				joined = true;
				break;
			}
			if (!joined) list.push({ key, rest, stream, merged: bytes, files });
		}
	}
	for (const group of [...groups.values()].flat()) {
		if (group.files.size < 2) continue;
		const extra: Record<string, PDFObject> = {};
		for (const [k, v] of group.stream.dict.entries()) {
			const entry = k.decodeText();
			if (!["Length", "Filter", "DecodeParms"].includes(entry))
				extra[entry] = v;
		}
		if (extra.Length1) extra.Length1 = PDFNumber.of(group.merged.length);
		const file = doc.context.register(
			doc.context.flateStream(group.merged, extra),
		);
		const base = PDFName.of(`${subsetTag(group.merged)}+${group.rest}`);
		for (const [old, owners] of group.files) {
			for (const { dict } of owners) {
				dict.set(PDFName.of(group.key), file);
				dict.set(PDFName.of("FontName"), base);
			}
			doc.context.delete(old);
		}
		for (const owners of group.files.values())
			for (const { ref } of owners) {
				const cid = cids.get(ref);
				cid?.dict.set(PDFName.of("BaseFont"), base);
				if (cid) parents.get(cid.ref)?.set(PDFName.of("BaseFont"), base);
			}
	}
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function trimOf(
	page: PdfPage | undefined,
	dpi: number,
	bleed: BleedMm,
): CardSizeMm {
	if (!page) return { widthMm: 1, heightMm: 1 };
	const full = cardSizeMm(page.widthPx, page.heightPx, dpi);
	return {
		widthMm: full.widthMm - bleed.left - bleed.right,
		heightMm: full.heightMm - bleed.top - bleed.bottom,
	};
}

/** Embeds an 8-bit RGB, non-interlaced PNG by passing its zlib stream through
 *  with the PNG predictor, skipping the decode and re-deflate `embedPng` does.
 *  Returns undefined for any other PNG, which `embedPng` handles instead. */
export function embedRgbPng(
	lib: PdfLib,
	doc: PDFDocument,
	bytes: Uint8Array,
): PDFRef | undefined {
	const idat = rgbIdat(bytes);
	if (!idat) return undefined;
	const { context } = doc;
	const dict = context.obj({
		Type: "XObject",
		Subtype: "Image",
		Width: idat.width,
		Height: idat.height,
		ColorSpace: "DeviceRGB",
		BitsPerComponent: 8,
		Filter: "FlateDecode",
		DecodeParms: {
			Predictor: 15,
			Colors: 3,
			BitsPerComponent: 8,
			Columns: idat.width,
		},
	});
	return context.register(lib.PDFRawStream.of(dict, idat.data));
}

/** The ICC profiles a document already holds, by checksum. */
export type IccProfiles = Map<
	number,
	Array<{ bytes: Uint8Array; ref: PDFRef }>
>;

/** Embeds a gray or RGB JPEG that carries an ICC profile as it is, drawn in
 *  that profile, which is written once per document however many images
 *  share it. Returns undefined for a JPEG without a usable profile, which
 *  `embedJpg` handles instead. */
export function embedProfiledJpeg(
	lib: PdfLib,
	doc: PDFDocument,
	bytes: Uint8Array,
	profiles: IccProfiles,
): PDFRef | undefined {
	const frame = jpegFrame(bytes);
	if (!frame || (frame.components !== 1 && frame.components !== 3))
		return undefined;
	const profile = jpegIccProfile(bytes);
	if (
		typeof profile === "string" ||
		iccComponents(profile) !== frame.components
	)
		return undefined;
	const { context } = doc;
	const ref = embedIccProfile(doc, profile, frame.components, profiles);
	const dict = context.obj({
		Type: "XObject",
		Subtype: "Image",
		Width: frame.width,
		Height: frame.height,
		ColorSpace: [lib.PDFName.of("ICCBased"), ref],
		BitsPerComponent: 8,
		Filter: "DCTDecode",
	});
	return context.register(lib.PDFRawStream.of(dict, bytes));
}

/** The stream holding this profile, written the first time a document asks
 *  for it. */
export function embedIccProfile(
	doc: PDFDocument,
	profile: Uint8Array,
	components: number,
	profiles: IccProfiles,
): PDFRef {
	const { context } = doc;
	const key = crc32(profile);
	const same = profiles.get(key) ?? [];
	let entry = same.find((p) => sameBytes(p.bytes, profile));
	if (!entry) {
		entry = {
			bytes: profile,
			ref: context.register(context.flateStream(profile, { N: components })),
		};
		profiles.set(key, [...same, entry]);
	}
	return entry.ref;
}
