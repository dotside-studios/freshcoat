import { createFrame, createRenderer, createText } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/node";
import { jpegHeader, testFontBytes } from "@freshcoat-js/test-utils";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFHexString,
	PDFName,
	type PDFPage,
	PDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ItemCuts } from "./cut";
import { imposeSheets } from "./impose";
import { assemblePdf, pageSizePt, rgbIdat } from "./pdf";
import { makePng, makeRgbaPng } from "./test-fixtures";
import type { PdfPage, SheetLayout } from "./types";

const png = "png" as const;

describe("assemblePdf", () => {
	it("makes one page per PNG at its physical size", async () => {
		const pages = [
			{ bytes: makePng(30, 20), format: png, widthPx: 1012, heightPx: 638 },
			{ bytes: makePng(20, 30), format: png, widthPx: 638, heightPx: 1012 },
			{ bytes: makePng(3, 3), format: png, widthPx: 300, heightPx: 300 },
		];
		const bytes = await assemblePdf(pages, { dpi: 300, title: "Members" });
		const doc = await PDFDocument.load(bytes, { updateMetadata: false });
		expect(doc.getPageCount()).toBe(3);
		const sizes = doc.getPages().map((p) => {
			const box = p.getMediaBox();
			return [box.x, box.y, box.width, box.height];
		});
		expect(sizes[0]?.[2]).toBeCloseTo((1012 / 300) * 72, 3);
		expect(sizes[0]?.[3]).toBeCloseTo((638 / 300) * 72, 3);
		expect(sizes[1]?.[2]).toBeCloseTo(153.12, 3);
		expect(sizes[2]).toEqual([0, 0, 72, 72]);
		expect(doc.getTitle()).toBe("Members");
		expect(doc.getCreator()).toBe("Freshcoat Studio");
		expect(doc.getProducer()).toMatch(/Freshcoat/);
	});

	it("is repeatable with a fixed date", async () => {
		const pages = [
			{ bytes: makePng(2, 2), format: png, widthPx: 96, heightPx: 96 },
		];
		const date = new Date("2026-01-01T00:00:00Z");
		const a = await assemblePdf(pages, { dpi: 96, date });
		const b = await assemblePdf(pages, { dpi: 96, date });
		expect(b).toEqual(a);
		expect(pageSizePt(96, 48, 96)).toEqual([72, 36]);
	});

	it("embeds JPEG pages as JPEGs, each page at its own size", async () => {
		const jpeg = jpegHeader({ width: 40, height: 30 });
		const bytes = await assemblePdf(
			[
				{ bytes: jpeg, format: "jpeg", widthPx: 4000, heightPx: 3000 },
				{ bytes: makePng(2, 3), format: png, widthPx: 200, heightPx: 300 },
			],
			{ dpi: 100 },
		);
		const doc = await PDFDocument.load(bytes, { updateMetadata: false });
		const sizes = doc.getPages().map((p) => [p.getWidth(), p.getHeight()]);
		expect(sizes).toEqual([
			[2880, 2160],
			[144, 216],
		]);
		// the JPEG's own bytes are the stream, with the DCT filter
		expect(new TextDecoder("latin1").decode(bytes)).toContain("/DCTDecode");
	});

	it("passes an RGB PNG's IDAT through with the PNG predictor", async () => {
		const bytes = makePng(30, 20);
		const pdf = await assemblePdf(
			[{ bytes, format: png, widthPx: 30, heightPx: 20 }],
			{ dpi: 300 },
		);
		const doc = await PDFDocument.load(pdf, { updateMetadata: false });
		const [image] = images(doc.getPage(0));
		expect(image?.dict.get(PDFName.of("Width"))?.toString()).toBe("30");
		expect(image?.dict.get(PDFName.of("Height"))?.toString()).toBe("20");
		expect(image?.dict.get(PDFName.of("ColorSpace"))?.toString()).toBe(
			"/DeviceRGB",
		);
		expect(image?.dict.get(PDFName.of("DecodeParms"))?.toString()).toMatch(
			/\/Predictor 15[\s\S]*\/Colors 3[\s\S]*\/Columns 30/,
		);
		expect(image?.getContents()).toEqual(rgbIdat(bytes)?.data);
	});

	it("falls back to embedPng for an RGBA PNG", async () => {
		const bytes = makeRgbaPng(8, 6);
		expect(rgbIdat(bytes)).toBeUndefined();
		const pdf = await assemblePdf(
			[{ bytes, format: png, widthPx: 8, heightPx: 6 }],
			{ dpi: 300 },
		);
		const doc = await PDFDocument.load(pdf, { updateMetadata: false });
		const [image] = images(doc.getPage(0));
		expect(image?.dict.get(PDFName.of("Width"))?.toString()).toBe("8");
		expect(image?.dict.get(PDFName.of("Height"))?.toString()).toBe("6");
		expect(image?.dict.has(PDFName.of("DecodeParms"))).toBe(false);
		expect(image?.dict.has(PDFName.of("SMask"))).toBe(true);
	});

	it("draws a one-page PDF as its vectors, sized by its pixels", async () => {
		const source = await PDFDocument.create();
		const [w, h] = [(1012 / 300) * 72, (638 / 300) * 72];
		source
			.addPage([w / 2, h / 2])
			.drawRectangle({ x: 4, y: 4, width: 20, height: 10 });
		const vector = await source.save();
		const pdf = await assemblePdf(
			[
				{ bytes: vector, format: "pdf", widthPx: 1012, heightPx: 638 },
				{ bytes: makePng(2, 2), format: png, widthPx: 1012, heightPx: 638 },
			],
			{ dpi: 300 },
		);
		const doc = await PDFDocument.load(pdf, { updateMetadata: false });
		expect(doc.getPageCount()).toBe(2);
		const page = doc.getPage(0);
		expect(page.getWidth()).toBeCloseTo(w, 3);
		expect(page.getHeight()).toBeCloseTo(h, 3);
		expect(
			images(page).map((x) => x.dict.get(PDFName.of("Subtype"))?.toString()),
		).toEqual(["/Form"]);
		const [m] = placements(page);
		expect(m?.[0]).toBeCloseTo(2, 4);
		expect(m?.[3]).toBeCloseTo(2, 4);
	});

	it("rejects a non-positive dpi", async () => {
		await expect(assemblePdf([], { dpi: 0 })).rejects.toThrow(/dpi/);
	});
});

/** The operators of a page's content streams, as text. */
function content(page: PDFPage): string {
	const contents = page.node.Contents();
	const streams =
		contents instanceof PDFArray
			? contents.asArray().map((ref) => page.doc.context.lookup(ref))
			: [contents];
	return streams
		.map((stream) => {
			if (!(stream instanceof PDFRawStream)) throw new Error("not a stream");
			return new TextDecoder("latin1").decode(
				decodePDFRawStream(stream).decode(),
			);
		})
		.join("\n");
}

/** The image XObjects a page's resources name. */
function images(page: PDFPage): PDFRawStream[] {
	const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
	if (!(xobjects instanceof PDFDict)) return [];
	return xobjects
		.values()
		.map((ref) => page.doc.context.lookup(ref))
		.filter((obj) => obj instanceof PDFRawStream);
}

type Matrix = [number, number, number, number, number, number];

/** The transform each `Do` draws with, following `q`, `Q` and `cm`. */
function placements(page: PDFPage): Matrix[] {
	const tokens = content(page).split(/\s+/).filter(Boolean);
	let ctm: Matrix = [1, 0, 0, 1, 0, 0];
	const stack: Matrix[] = [];
	const out: Matrix[] = [];
	tokens.forEach((token, i) => {
		if (token === "q") stack.push(ctm);
		else if (token === "Q") ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
		else if (token === "cm") {
			const [a, b, c, d, e, f] = tokens.slice(i - 6, i).map(Number) as Matrix;
			const [A, B, C, D, E, F] = ctm;
			ctm = [
				a * A + b * C,
				a * B + b * D,
				c * A + d * C,
				c * B + d * D,
				e * A + f * C + E,
				e * B + f * D + F,
			];
		} else if (token === "Do") out.push(ctm);
	});
	return out;
}

/** Stroked paths: every crop mark is one. */
const strokes = (page: PDFPage) =>
	content(page)
		.split(/\s+/)
		.filter((t) => t === "S").length;

const K = 72 / 25.4;
const A4 = [210 * K, 297 * K] as const;

function sheet(overrides: Partial<SheetLayout> = {}): SheetLayout {
	return {
		kind: "sheet",
		paper: "a4",
		orientation: "portrait",
		marginMm: 10,
		gapMm: 0,
		cropMarks: true,
		duplex: "none",
		...overrides,
	};
}

function cards(count: number, sides = 1): PdfPage[] {
	return Array.from({ length: count * sides }, (_, i) => ({
		bytes: makePng(4, 3, [i * 10, 0, 0]),
		format: png,
		widthPx: 1011,
		heightPx: 638,
		recordId: `r_${Math.floor(i / sides)}`,
	}));
}

const card = { widthMm: 85.6, heightMm: 54 };

function expectPlacement(m: Matrix | undefined, xMm: number, yMm: number) {
	if (!m) throw new Error("no image");
	const [a, b, c, d, e, f] = m;
	expect(a).toBeCloseTo(85.6 * K, 2);
	expect(d).toBeCloseTo(54 * K, 2);
	expect(b).toBeCloseTo(0, 2);
	expect(c).toBeCloseTo(0, 2);
	expect(e).toBeCloseTo(xMm * K, 2);
	// from the bottom-left corner, to the card's bottom edge
	expect(f).toBeCloseTo(A4[1] - (yMm + 54) * K, 2);
}

describe("assemblePdf on sheets", () => {
	it("imposes cards on A4 pages at their slots, with crop marks", async () => {
		const bytes = await assemblePdf(cards(12), {
			dpi: 300,
			title: "Members",
			layout: sheet(),
			cardMm: card,
		});
		const doc = await PDFDocument.load(bytes, { updateMetadata: false });
		expect(doc.getTitle()).toBe("Members");
		expect(doc.getPageCount()).toBe(2);
		for (const page of doc.getPages()) {
			expect(page.getWidth()).toBeCloseTo(A4[0], 2);
			expect(page.getHeight()).toBeCloseTo(A4[1], 2);
			expect(page.getWidth()).toBeCloseTo(595.28, 2);
			expect(page.getHeight()).toBeCloseTo(841.89, 2);
		}
		const [first, second] = doc.getPages() as [PDFPage, PDFPage];
		const one = placements(first);
		expect(one).toHaveLength(10);
		expectPlacement(one[0], 19.4, 13.5);
		expectPlacement(one[1], 105, 13.5);
		expectPlacement(one[2], 19.4, 67.5);
		expectPlacement(one[9], 105, 229.5);
		const two = placements(second);
		expect(two).toHaveLength(2);
		expectPlacement(two[1], 105, 13.5);
		// 3 vertical cut lines and 6 horizontal, a mark at each end
		expect(strokes(first)).toBe(18);
		expect(strokes(second)).toBe(18);
	});

	it("leaves crop marks off when asked, and off back pages", async () => {
		const plain = await PDFDocument.load(
			await assemblePdf(cards(1), {
				dpi: 300,
				layout: sheet({ cropMarks: false }),
				cardMm: card,
			}),
		);
		expect(strokes(plain.getPage(0))).toBe(0);
		const duplex = await PDFDocument.load(
			await assemblePdf(cards(3, 2), {
				dpi: 300,
				layout: sheet({ duplex: "long-edge", gapMm: 10 }),
				cardMm: card,
			}),
		);
		expect(duplex.getPageCount()).toBe(2);
		// 2 × 4 with a 10 mm gap: marks in the margin and in the gaps
		expect(strokes(duplex.getPage(0))).toBe(4 * 8 + 8 * 4);
		expect(strokes(duplex.getPage(1))).toBe(0);
	});

	it("puts duplex backs in the mirrored slots, shifted by the offset", async () => {
		const bytes = await assemblePdf(cards(3, 2), {
			dpi: 300,
			layout: sheet({ duplex: "long-edge", backOffsetMm: { x: 1, y: 2 } }),
			cardMm: card,
		});
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(2);
		const front = placements(doc.getPage(0));
		const back = placements(doc.getPage(1));
		expectPlacement(front[0], 19.4, 13.5);
		expectPlacement(front[2], 19.4, 67.5);
		expectPlacement(back[0], 106, 15.5);
		expectPlacement(back[1], 20.4, 15.5);
		expectPlacement(back[2], 106, 69.5);
	});

	it("sizes cards from the first page when not told", async () => {
		const pages = cards(1).map((p) => ({ ...p, widthPx: 1200, heightPx: 900 }));
		const doc = await PDFDocument.load(
			await assemblePdf(pages, { dpi: 300, layout: sheet() }),
		);
		const [m] = placements(doc.getPage(0));
		expect(m?.[0]).toBeCloseTo(4 * 72, 2);
		expect(m?.[3]).toBeCloseTo(3 * 72, 2);
	});

	it("rejects a layout the card doesn't fit", async () => {
		await expect(
			assemblePdf(cards(1), {
				dpi: 300,
				layout: sheet({ marginMm: 80 }),
				cardMm: card,
			}),
		).rejects.toThrow(/too wide/);
	});

	it("draws each card with its bleed around the trim", async () => {
		const bleed = 3;
		const doc = await PDFDocument.load(
			await assemblePdf(cards(2), {
				dpi: 300,
				layout: sheet(),
				cardMm: card,
				bleedMm: bleed,
			}),
		);
		const imposition = imposeSheets(cards(2), card, sheet(), {
			bleedMm: bleed,
		});
		const [a, b] = placements(doc.getPage(0));
		for (const [m, slot] of [
			[a, imposition.pages[0]?.slots[0]],
			[b, imposition.pages[0]?.slots[1]],
		] as const) {
			if (!m || !slot) throw new Error("no image");
			expect(m[0]).toBeCloseTo((85.6 + 2 * bleed) * K, 2);
			expect(m[3]).toBeCloseTo((54 + 2 * bleed) * K, 2);
			expect(m[4]).toBeCloseTo((slot.xMm - bleed) * K, 2);
			expect(m[5]).toBeCloseTo(A4[1] - (slot.yMm + 54 + bleed) * K, 2);
		}
		// 2 × 4 with the gap widened to 6 mm: marks in the margin only
		expect(strokes(doc.getPage(0))).toBe(4 * 2 + 8 * 2);
	});

	it("takes the bleed off the first page's size when not told the card", async () => {
		const pages = cards(1).map((p) => ({ ...p, widthPx: 1200, heightPx: 900 }));
		const doc = await PDFDocument.load(
			await assemblePdf(pages, {
				dpi: 300,
				layout: sheet(),
				bleedMm: 25.4 / 6,
			}),
		);
		const [m] = placements(doc.getPage(0));
		expect(m?.[0]).toBeCloseTo(4 * 72, 2);
		expect(m?.[3]).toBeCloseTo(3 * 72, 2);
	});

	it("gives a single page with bleed a trim box inside its bleed box", async () => {
		const doc = await PDFDocument.load(
			await assemblePdf(cards(1), {
				dpi: 300,
				bleedMm: { top: 1, right: 2, bottom: 3, left: 4 },
			}),
		);
		const page = doc.getPage(0);
		const media = page.getMediaBox();
		const bleedBox = page.getBleedBox();
		const trim = page.getTrimBox();
		expect([bleedBox.width, bleedBox.height]).toEqual([
			media.width,
			media.height,
		]);
		expect(trim.x).toBeCloseTo(4 * K, 3);
		expect(trim.y).toBeCloseTo(3 * K, 3);
		expect(trim.width).toBeCloseTo(media.width - 6 * K, 3);
		expect(trim.height).toBeCloseTo(media.height - 4 * K, 3);
	});

	it("reads a single layout as one image per page", async () => {
		const doc = await PDFDocument.load(
			await assemblePdf(cards(2), { dpi: 300, layout: { kind: "single" } }),
		);
		expect(doc.getPageCount()).toBe(2);
		expect(doc.getPage(0).getWidth()).toBeCloseTo((1011 / 300) * 72, 3);
		const [m] = placements(doc.getPage(0));
		expect(m?.[4]).toBe(0);
		expect(m?.[5]).toBe(0);
	});
});

describe("assemblePdf with font subsets", () => {
	const text = (family: string, value: string) =>
		createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 300, height: 60 },
			children: [
				createText({
					pos: { x: 8, y: 8 },
					size: { width: 284, height: 40 },
					text: value,
					font: {
						family,
						weight: 400,
						style: "normal",
						size: 22,
						lineHeight: 1.2,
					},
					color: "#1d3557",
				}),
			],
		});

	const page = (bytes: Uint8Array): PdfPage => ({
		bytes,
		format: "pdf",
		widthPx: 300,
		heightPx: 60,
	});

	const fontFiles = async (bytes: Uint8Array) => {
		const doc = await PDFDocument.load(bytes, { updateMetadata: false });
		const dicts = doc.context
			.enumerateIndirectObjects()
			.map(([, obj]) => obj)
			.filter((obj): obj is PDFDict => obj instanceof PDFDict);
		const names = (key: string) =>
			dicts
				.map((d) => d.get(PDFName.of(key))?.toString())
				.filter((n) => n !== undefined);
		return {
			files: names("FontFile2"),
			fontNames: names("FontName"),
			baseFonts: names("BaseFont"),
		};
	};

	it("keeps subsets of different fonts that share a name apart", async () => {
		const renderer = await createRenderer({
			ck: await loadCanvasKit("full"),
			fonts: {
				Geist: [testFontBytes("Geist-Regular.ttf")],
				Hebrew: [testFontBytes("NotoSansHebrew-Regular.ttf")],
			},
		});
		const draw = async (family: string, value: string) => {
			const size = { width: 300, height: 60 };
			return (await renderer.renderPdf(text(family, value), size)).bytes;
		};
		const [fresh, coat, hebrew] = [
			await draw("Geist", "Fresh"),
			await draw("Geist", "coat"),
			await draw("Hebrew", "שלום"),
		];
		renderer.dispose();
		const doc = await PDFDocument.load(hebrew);
		const clash = PDFName.of("QQQQQQ+Geist-F0");
		for (const [, obj] of doc.context.enumerateIndirectObjects())
			if (obj instanceof PDFDict)
				for (const key of ["FontName", "BaseFont"])
					if (obj.has(PDFName.of(key))) obj.set(PDFName.of(key), clash);
		const renamed = await doc.save();
		const out = await assemblePdf([page(fresh), page(coat), page(renamed)], {
			dpi: 300,
		});
		const separate = await assemblePdf([page(fresh), page(renamed)], {
			dpi: 300,
		});
		const { files, fontNames, baseFonts } = await fontFiles(out);
		expect(files).toHaveLength(3);
		expect(new Set(files).size).toBe(2);
		expect(new Set(fontNames).size).toBe(2);
		expect(fontNames).toContain(clash.toString());
		expect(new Set(baseFonts)).toEqual(new Set(fontNames));
		expect((await fontFiles(separate)).files).toHaveLength(2);
		expect(out.length).toBeLessThan(
			fresh.length + coat.length + renamed.length,
		);
	});
});

/** The first point each `m` moves to, in page points from the bottom-left. */
function moves(page: PDFPage): [number, number][] {
	return [...content(page).matchAll(/(-?[\d.]+) (-?[\d.]+) m\b/g)].map(
		(m) => [Number(m[1]), Number(m[2])] as [number, number],
	);
}

const cut: ItemCuts = {
	width: 856,
	height: 540,
	lines: [
		{
			kind: "through",
			name: "box",
			path: "M100 100L200 100L200 200L100 200Z",
			fillRule: "nonzero",
		},
		{
			kind: "perforate",
			name: "tear",
			path: "M0 300C10 300 20 310 30 320",
			fillRule: "nonzero",
		},
	],
};

describe("assemblePdf with cut lines", () => {
	it("strokes each line over the art in its kind's colour at a quarter point", async () => {
		const bytes = await assemblePdf(
			[
				{
					bytes: makePng(4, 3),
					format: png,
					widthPx: 856,
					heightPx: 540,
					cut,
				},
			],
			{ dpi: 72 },
		);
		const doc = await PDFDocument.load(bytes);
		const [page] = doc.getPages() as [PDFPage];
		const ops = content(page);
		expect(ops).toContain("1 0 0 RG");
		expect(ops).toContain("0 0.627 0 RG");
		expect(ops).toContain("0.25 w");
		expect(ops).toContain("c\n");
		expect(ops.indexOf(" Do")).toBeLessThan(ops.indexOf(" RG"));
		expect(strokes(page)).toBe(2);
		// one point to a design unit at 72 dpi, measured up from the bottom
		expect(moves(page)).toEqual([
			[100, 540 - 100],
			[0, 540 - 300],
		]);
	});

	it("puts the strokes in an optional content group named Cut", async () => {
		const bytes = await assemblePdf(
			[
				{
					bytes: makePng(4, 3),
					format: png,
					widthPx: 856,
					heightPx: 540,
					cut,
				},
			],
			{ dpi: 72 },
		);
		const doc = await PDFDocument.load(bytes);
		const props = doc.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
		const groups = props.lookup(PDFName.of("OCGs"), PDFArray);
		expect(groups.size()).toBe(1);
		const group = doc.context.lookup(groups.get(0), PDFDict);
		expect(group.lookup(PDFName.of("Name"), PDFHexString).decodeText()).toBe(
			"Cut",
		);
		const [page] = doc.getPages() as [PDFPage];
		expect(content(page)).toMatch(/\/OC \/Cut BDC[\s\S]*EMC/);
		const resources = page.node.Resources()?.lookup(PDFName.of("Properties"));
		expect(resources).toBeInstanceOf(PDFDict);
		expect((resources as PDFDict).get(PDFName.of("Cut"))).toBe(groups.get(0));
	});

	it("scales the lines to a page whose pixels are not the design units", async () => {
		const bytes = await assemblePdf(
			[
				{
					bytes: makePng(4, 3),
					format: png,
					widthPx: 1712,
					heightPx: 1080,
					cut,
				},
			],
			{ dpi: 144 },
		);
		const doc = await PDFDocument.load(bytes);
		const [page] = doc.getPages() as [PDFPage];
		expect(page.getWidth()).toBeCloseTo(856, 3);
		expect(moves(page)[0]).toEqual([100, 540 - 100]);
	});

	it("draws nothing for pages without lines, and no group", async () => {
		const bytes = await assemblePdf(
			[
				{
					bytes: makePng(4, 3),
					format: png,
					widthPx: 100,
					heightPx: 100,
					cut: { width: 100, height: 100, lines: [] },
				},
				{ bytes: makePng(4, 3), format: png, widthPx: 100, heightPx: 100 },
			],
			{ dpi: 72 },
		);
		const doc = await PDFDocument.load(bytes);
		for (const page of doc.getPages()) expect(strokes(page)).toBe(0);
		expect(doc.catalog.get(PDFName.of("OCProperties"))).toBeUndefined();
	});

	it("shares one group between pages", async () => {
		const page = {
			bytes: makePng(4, 3),
			format: png,
			widthPx: 856,
			heightPx: 540,
			cut,
		};
		const doc = await PDFDocument.load(
			await assemblePdf([page, page, page], { dpi: 72 }),
		);
		const props = doc.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
		expect(props.lookup(PDFName.of("OCGs"), PDFArray).size()).toBe(1);
	});

	it("is repeatable", async () => {
		const pages = [
			{ bytes: makePng(4, 3), format: png, widthPx: 856, heightPx: 540, cut },
		];
		const date = new Date("2026-01-01T00:00:00Z");
		expect(await assemblePdf(pages, { dpi: 72, date })).toEqual(
			await assemblePdf(pages, { dpi: 72, date }),
		);
	});

	describe("on sheets", () => {
		const withCut = (count: number) =>
			cards(count).map((page) => ({ ...page, cut }));

		it("positions each card's lines like its art", async () => {
			const bytes = await assemblePdf(withCut(2), {
				dpi: 300,
				layout: sheet({ cropMarks: false }),
				cardMm: card,
			});
			const doc = await PDFDocument.load(bytes);
			const [page] = doc.getPages() as [PDFPage];
			// 856 units across 85.6 mm: a tenth of a millimetre to a unit
			const at = (xMm: number, yMm: number): [number, number] => [
				(xMm + 10) * K,
				A4[1] - (yMm + 10) * K,
			];
			const [first, , second] = moves(page);
			expect(first?.[0]).toBeCloseTo(at(19.4, 13.5)[0], 2);
			expect(first?.[1]).toBeCloseTo(at(19.4, 13.5)[1], 2);
			expect(second?.[0]).toBeCloseTo(at(105, 13.5)[0], 2);
			expect(second?.[1]).toBeCloseTo(at(105, 13.5)[1], 2);
			expect(strokes(page)).toBe(4);
		});

		it("keeps the lines on the trimmed card when the art has bleed", async () => {
			const bleed = 3;
			const bled = cards(1).map((page) => ({
				...page,
				cut: { ...cut, width: 916, height: 600 },
			}));
			const doc = await PDFDocument.load(
				await assemblePdf(bled, {
					dpi: 300,
					layout: sheet({ cropMarks: false }),
					cardMm: card,
					bleedMm: bleed,
				}),
			);
			const [page] = doc.getPages() as [PDFPage];
			const [first] = moves(page);
			const slot = imposeSheets(bled, card, sheet({ cropMarks: false }), {
				bleedMm: bleed,
			}).pages[0]?.slots[0];
			if (!slot) throw new Error("no slot");
			// the art starts `bleed` left of the card, a tenth of a mm to a unit
			const mmPerUnit = 0.1;
			expect(first?.[0]).toBeCloseTo(
				(slot.xMm - bleed + 100 * mmPerUnit) * K,
				2,
			);
			expect(first?.[1]).toBeCloseTo(
				A4[1] - (slot.yMm - bleed + 100 * mmPerUnit) * K,
				2,
			);
		});

		it("draws the lines of back pages too", async () => {
			const doc = await PDFDocument.load(
				await assemblePdf(
					cards(1, 2).map((page) => ({ ...page, cut })),
					{
						dpi: 300,
						layout: sheet({ duplex: "long-edge", cropMarks: false }),
						cardMm: card,
					},
				),
			);
			const [front, back] = doc.getPages() as [PDFPage, PDFPage];
			expect(strokes(front)).toBe(2);
			expect(strokes(back)).toBe(2);
		});
	});
});
