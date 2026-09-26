import {
	type CardSizeMm,
	cardSizeMm,
	cropMarks,
	imposeSheets,
	MM_PER_INCH,
} from "./impose";
import type { PdfLayout, PdfPage } from "./types";

export type AssemblePdfOptions = {
	/** pixels per inch: a page is `widthPx / dpi` inches wide */
	dpi: number;
	title?: string;
	/** creation and modification date; fixing it makes the bytes repeatable */
	date?: Date;
	/** default one image per page */
	layout?: PdfLayout;
	/** on sheets, the size every image is drawn at; defaults to the first
	 *  page's pixels at `dpi` */
	cardMm?: CardSizeMm;
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
 *  the card's size, with crop marks on the pages that aren't backs. */
export async function assemblePdf(
	pages: readonly PdfPage[],
	options: AssemblePdfOptions,
): Promise<Uint8Array> {
	if (!(options.dpi > 0))
		throw new Error(`dpi must be positive: ${options.dpi}`);
	const { PDFDocument, rgb } = await import("pdf-lib");
	// Left to itself, pdf-lib names itself the producer and stamps the time.
	const doc = await PDFDocument.create({ updateMetadata: false });
	const date = options.date ?? new Date();
	if (options.title !== undefined) doc.setTitle(options.title);
	doc.setCreator("Freshcoat Studio");
	doc.setProducer("Freshcoat Studio (pdf-lib)");
	doc.setCreationDate(date);
	doc.setModificationDate(date);
	if (options.layout?.kind === "sheet") {
		const first = pages[0];
		const card =
			options.cardMm ??
			(first
				? cardSizeMm(first.widthPx, first.heightPx, options.dpi)
				: { widthMm: 1, heightMm: 1 });
		const imposition = imposeSheets(pages, card, options.layout);
		const width = imposition.paper.widthMm * PT_PER_MM;
		const height = imposition.paper.heightMm * PT_PER_MM;
		const marks = options.layout.cropMarks ? cropMarks(imposition) : [];
		for (const sheet of imposition.pages) {
			const out = doc.addPage([width, height]);
			for (const slot of sheet.slots) {
				const page = slot.item;
				const image =
					page.format === "jpeg"
						? await doc.embedJpg(page.bytes)
						: await doc.embedPng(page.bytes);
				// pdf-lib measures up from the bottom-left corner.
				out.drawImage(image, {
					x: slot.xMm * PT_PER_MM,
					y: height - (slot.yMm + card.heightMm) * PT_PER_MM,
					width: card.widthMm * PT_PER_MM,
					height: card.heightMm * PT_PER_MM,
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
		const image =
			page.format === "jpeg"
				? await doc.embedJpg(page.bytes)
				: await doc.embedPng(page.bytes);
		const [width, height] = pageSizePt(
			page.widthPx,
			page.heightPx,
			options.dpi,
		);
		doc.addPage([width, height]).drawImage(image, {
			x: 0,
			y: 0,
			width,
			height,
		});
	}
	return doc.save();
}
