import {
	type BleedMm,
	type CardSizeMm,
	cardSizeMm,
	MM_PER_INCH,
	resolveBleedMm,
} from "@freshcoat-js/coatfile";
import { parseImageInfo } from "./image-info";
import { cropMarks, imposeSheets } from "./impose";
import type { PdfLayout, PdfPage } from "./types";

type PdfLib = typeof import("pdf-lib");
type PDFDocument = import("pdf-lib").PDFDocument;
type PDFPage = import("pdf-lib").PDFPage;
type PDFRef = import("pdf-lib").PDFRef;

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
};

const CROP_MARK_WIDTH_PT = 0.25;

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
 *  backs. */
export async function assemblePdf(
	pages: readonly PdfPage[],
	options: AssemblePdfOptions,
): Promise<Uint8Array> {
	if (!(options.dpi > 0))
		throw new Error(`dpi must be positive: ${options.dpi}`);
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
	let embedded = 0;
	const embed = async (page: PdfPage): Promise<PDFRef> => {
		const ref =
			page.format === "jpeg"
				? (await doc.embedJpg(page.bytes)).ref
				: (embedRgbPng(lib, doc, page.bytes) ??
					(await doc.embedPng(page.bytes)).ref);
		options.onProgress?.(++embedded, pages.length);
		return ref;
	};
	const draw = (
		out: PDFPage,
		ref: PDFRef,
		rect: { x: number; y: number; width: number; height: number },
	) => {
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
				draw(out, image, {
					x: (slot.xMm - bleed.left) * PT_PER_MM,
					y: height - (slot.yMm + card.heightMm + bleed.bottom) * PT_PER_MM,
					width: (card.widthMm + bleed.left + bleed.right) * PT_PER_MM,
					height: (card.heightMm + bleed.top + bleed.bottom) * PT_PER_MM,
				});
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
	return doc.save();
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

/** The concatenated IDAT data of a PNG `embedRgbPng` can pass through. */
export function rgbIdat(
	bytes: Uint8Array,
): { width: number; height: number; data: Uint8Array } | undefined {
	const info = parseImageInfo(bytes);
	if (info?.contentType !== "image/png") return undefined;
	const { width, height } = info;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const parts: Uint8Array[] = [];
	let size = 0;
	for (let at = 8; at + 8 <= bytes.length; ) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		const start = at + 8;
		const end = start + length;
		if (end + 4 > bytes.length) return undefined;
		if (type === "IHDR") {
			if (length < 13) return undefined;
			const [depth, colour, compression, filter, interlace] = bytes.subarray(
				start + 8,
				start + 13,
			);
			if (
				depth !== 8 ||
				colour !== 2 ||
				compression !== 0 ||
				filter !== 0 ||
				interlace !== 0
			)
				return undefined;
		} else if (type === "IDAT") {
			parts.push(bytes.subarray(start, end));
			size += length;
		} else if (type === "tRNS" || type === "acTL") {
			return undefined;
		} else if (type === "IEND") {
			break;
		}
		at = end + 4;
	}
	if (!(width > 0 && height > 0) || parts.length === 0) return undefined;
	if (parts.length === 1) return { width, height, data: parts[0] };
	const data = new Uint8Array(size);
	let at = 0;
	for (const part of parts) {
		data.set(part, at);
		at += part.length;
	}
	return { width, height, data };
}
