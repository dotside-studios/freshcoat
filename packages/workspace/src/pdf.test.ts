import { createFrame, createRenderer, createText } from "@freshcoat-js/engine";
import { SRGB_PROFILE } from "@freshcoat-js/engine/icc";
import { loadCanvasKit } from "@freshcoat-js/engine/node";
import {
	iccProfile,
	jpegHeader,
	testFontBytes,
} from "@freshcoat-js/test-utils";
import {
	decodePDFRawStream,
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFHexString,
	PDFName,
	type PDFPage,
	PDFRawStream,
	type PDFRef,
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

	it("draws a JPEG page carrying an ICC profile in that profile", async () => {
		const profile = new Uint8Array(200).map((_, i) => i);
		new DataView(profile.buffer).setUint32(0, profile.length);
		profile.set(new TextEncoder().encode("RGB "), 16);
		profile.set(new TextEncoder().encode("acsp"), 36);
		const head = [...new TextEncoder().encode("ICC_PROFILE"), 0, 1, 1];
		const length = 2 + head.length + profile.length;
		const plain = jpegHeader({ width: 40, height: 30 });
		const tagged = new Uint8Array([
			0xff,
			0xd8,
			0xff,
			0xe2,
			length >> 8,
			length & 0xff,
			...head,
			...profile,
			...plain.subarray(2),
		]);
		const page = { format: "jpeg" as const, widthPx: 40, heightPx: 30 };
		const pdf = await assemblePdf(
			[
				{ ...page, bytes: tagged },
				{ ...page, bytes: tagged.slice() },
				{ ...page, bytes: plain },
			],
			{ dpi: 72 },
		);
		const doc = await PDFDocument.load(pdf, { updateMetadata: false });
		const spaces = doc
			.getPages()
			.map((p) => images(p)[0]?.dict.lookup(PDFName.of("ColorSpace")));
		expect(spaces[2]?.toString()).toBe("/DeviceRGB");
		const [a, b] = spaces;
		expect(a).toBeInstanceOf(PDFArray);
		expect(a?.toString()).toBe(b?.toString());
		const ref = (a as PDFArray).get(1);
		expect((a as PDFArray).get(0)).toBe(PDFName.of("ICCBased"));
		const stream = doc.context.lookup(ref) as PDFRawStream;
		expect(stream.dict.get(PDFName.of("N"))?.toString()).toBe("3");
		expect(decodePDFRawStream(stream).decode()).toEqual(profile);
		expect(images(doc.getPage(0))[0]?.getContents()).toEqual(tagged);
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

	it("draws registration targets, a colour bar and a slug when asked", async () => {
		const bytes = await assemblePdf(cards(3, 2), {
			dpi: 300,
			title: "Members",
			date: new Date("2026-10-13T12:00:00Z"),
			layout: sheet({
				duplex: "long-edge",
				cropMarks: false,
				registrationMarks: true,
				colorBar: true,
				slug: true,
			}),
			cardMm: card,
		});
		const doc = await PDFDocument.load(bytes);
		const text = (page: PDFPage) =>
			[...content(page).matchAll(/<([0-9A-F]+)> Tj/g)]
				.map(([, hex]) =>
					new TextDecoder("latin1").decode(
						Uint8Array.from(hex?.match(/../g) ?? [], (h) => parseInt(h, 16)),
					),
				)
				.join("");
		for (const [i, side] of ["Front", "Back"].entries()) {
			const page = doc.getPage(i);
			// a circle and two lines for each of four targets, and the bar's outline
			expect(strokes(page)).toBe(4 * 3 + 1);
			expect(
				content(page)
					.split(/\s+/)
					.filter((t) => t === "f"),
			).toHaveLength(12);
			expect(text(page)).toBe(`Members · Sheet 1 of 1 · ${side} · 2026-10-13`);
		}
	});

	it("builds and paints every mark's path inside one graphics state", async () => {
		const bytes = await assemblePdf(cards(3, 2), {
			dpi: 300,
			title: "Members",
			bleedMm: 3,
			layout: sheet({
				duplex: "long-edge",
				gapMm: 10,
				registrationMarks: true,
				colorBar: true,
				slug: true,
			}),
			cardMm: card,
		});
		const doc = await PDFDocument.load(bytes);
		const construct = new Set(["m", "l", "c", "v", "y", "h", "re"]);
		const paint = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"]);
		for (const page of doc.getPages()) {
			const ops = content(page)
				.split(/\s+/)
				.filter((t) => /^[A-Za-z*']+$/.test(t));
			let open = false;
			for (const op of ops) {
				if (construct.has(op)) open = true;
				else if (paint.has(op)) open = false;
				else if (op === "q" || op === "Q") expect(open).toBe(false);
			}
			expect(ops).toContain("c");
			expect(ops).toContain("Tj");
		}
	});

	it("draws every mark but the colour patches in a Separation /All", async () => {
		const bytes = await assemblePdf(cards(1), {
			dpi: 300,
			title: "Members",
			layout: sheet({ registrationMarks: true, colorBar: true, slug: true }),
			cardMm: card,
		});
		const doc = await PDFDocument.load(bytes);
		const page = doc.getPage(0);
		const spaces = page.node
			.Resources()
			?.lookup(PDFName.of("ColorSpace"), PDFDict);
		const space = spaces?.lookup(PDFName.of("Registration"), PDFArray);
		expect(space?.lookup(0, PDFName).decodeText()).toBe("Separation");
		expect(space?.lookup(1, PDFName).decodeText()).toBe("All");
		expect(space?.lookup(2, PDFName).decodeText()).toBe("DeviceRGB");
		expect(spaces?.has(PDFName.of("DefaultRGB"))).toBe(true);
		const text = content(page);
		expect(text).toMatch(/\/Registration CS\n1 SCN\n/);
		expect(text).toMatch(/BT\n\/Registration cs\n1 scn\n[\s\S]*Tj\nET/);
		expect(text).toMatch(/^1 0 0 rg$/m);
		expect(text).not.toMatch(/ RG$/m);
	});

	it("cuts a long slug to its margin", async () => {
		const bytes = await assemblePdf(cards(1), {
			dpi: 300,
			title: `Ünïcode ✓ ${"x".repeat(200)}`,
			layout: sheet({ slug: true }),
			cardMm: card,
		});
		const page = (await PDFDocument.load(bytes)).getPage(0);
		expect(content(page)).toContain("Tj");
		expect(content(page)).toContain("85> Tj");
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

	it("embeds each image once however many copies it fills", async () => {
		const progress: [number, number][] = [];
		const bytes = await assemblePdf(cards(1), {
			dpi: 300,
			layout: sheet({ copies: "fill" }),
			cardMm: card,
			onProgress: (done, total) => progress.push([done, total]),
		});
		const doc = await PDFDocument.load(bytes);
		expect(placements(doc.getPage(0))).toHaveLength(10);
		expect(progress).toEqual([[1, 1]]);
		expect(
			new TextDecoder("latin1").decode(bytes).match(/\/Subtype \/Image/g),
		).toHaveLength(1);
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
	it("strokes each line over the art in its kind's spot at a quarter point", async () => {
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
		expect(ops).toContain("/CutThrough CS\n1 SCN\n");
		expect(ops).toContain("/CutPerforate CS\n1 SCN\n");
		expect(ops).not.toMatch(/ RG\n/);
		expect(ops).toContain("0.25 w");
		expect(ops).toContain("c\n");
		expect(ops.indexOf(" Do")).toBeLessThan(ops.indexOf(" CS"));
		expect(strokes(page)).toBe(2);
		// one point to a design unit at 72 dpi, measured up from the bottom
		expect(moves(page)).toEqual([
			[100, 540 - 100],
			[0, 540 - 300],
		]);
	});

	it("closes only the subpaths that are closed", async () => {
		const bytes = await assemblePdf(
			[
				{
					bytes: makePng(4, 3),
					format: png,
					widthPx: 856,
					heightPx: 540,
					cut: {
						width: 856,
						height: 540,
						lines: [
							{
								kind: "score",
								name: "a",
								path: "M0 10L50 10",
								fillRule: "nonzero",
							},
						],
					},
				},
			],
			{ dpi: 72 },
		);
		const doc = await PDFDocument.load(bytes);
		const [page] = doc.getPages() as [PDFPage];
		expect(content(page)).not.toMatch(/\bh\n/);
		expect(strokes(page)).toBe(1);
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

	describe("as spot colours", () => {
		const one = (options: Partial<Parameters<typeof assemblePdf>[1]> = {}) =>
			assemblePdf(
				[
					{
						bytes: makePng(4, 3),
						format: png,
						widthPx: 856,
						heightPx: 540,
						cut,
					},
				],
				{ dpi: 72, ...options },
			);
		const separation = (page: PDFPage, key: string) => {
			const spaces = page.node
				.Resources()
				?.lookup(PDFName.of("ColorSpace"), PDFDict);
			const space = spaces?.lookup(PDFName.of(key), PDFArray);
			if (!space) throw new Error(`no ${key}`);
			const tint = space.lookup(3, PDFDict);
			return {
				family: space.lookup(0, PDFName).decodeText(),
				name: space.lookup(1, PDFName).decodeText(),
				alternate: space.lookup(2, PDFName).decodeText(),
				c0: tint.lookup(PDFName.of("C0"), PDFArray).asArray().map(String),
				c1: tint.lookup(PDFName.of("C1"), PDFArray).asArray().map(String),
			};
		};

		it("names each kind's Separation after the RIP defaults, its alternate the kind's colour", async () => {
			const doc = await PDFDocument.load(await one());
			const [page] = doc.getPages() as [PDFPage];
			expect(separation(page, "CutThrough")).toEqual({
				family: "Separation",
				name: "CutContour",
				alternate: "DeviceRGB",
				c0: ["1", "1", "1"],
				c1: ["1", "0", "0"],
			});
			expect(separation(page, "CutPerforate").name).toBe("Perfcut");
			const spaces = page.node
				.Resources()
				?.lookup(PDFName.of("ColorSpace"), PDFDict);
			expect(spaces?.has(PDFName.of("CutKiss"))).toBe(false);
			expect(spaces?.has(PDFName.of("DefaultRGB"))).toBe(true);
		});

		it("overprints through an ExtGState set inside the Cut group", async () => {
			const doc = await PDFDocument.load(await one());
			const [page] = doc.getPages() as [PDFPage];
			const gs = page.node
				.Resources()
				?.lookup(PDFName.of("ExtGState"), PDFDict)
				.lookup(PDFName.of("CutOverprint"), PDFDict);
			expect(String(gs?.get(PDFName.of("OP")))).toBe("true");
			expect(String(gs?.get(PDFName.of("op")))).toBe("true");
			expect(String(gs?.get(PDFName.of("OPM")))).toBe("1");
			expect(content(page)).toMatch(
				/\/OC \/Cut BDC\nq\n\/CutOverprint gs\n0\.25 w\n\/CutThrough CS\n1 SCN\n[\s\S]*S\n[\s\S]*Q\nEMC/,
			);
		});

		it("takes the names a caller gives, escaping what a name cannot hold", async () => {
			const bytes = await one({
				cutSpots: { through: "Thru Cut", perforate: "  " },
			});
			const doc = await PDFDocument.load(bytes);
			const [page] = doc.getPages() as [PDFPage];
			expect(separation(page, "CutThrough").name).toBe("Thru Cut");
			expect(separation(page, "CutPerforate").name).toBe("Perfcut");
			const plain = await doc.save({ useObjectStreams: false });
			expect(new TextDecoder("latin1").decode(plain)).toContain("/Thru#20Cut");
		});

		it("writes one Separation per kind for the whole document", async () => {
			const page = {
				bytes: makePng(4, 3),
				format: png,
				widthPx: 856,
				heightPx: 540,
				cut,
			};
			const bytes = await assemblePdf(
				[page, { ...page, bytes: makePng(5, 3) }],
				{
					dpi: 72,
				},
			);
			const doc = await PDFDocument.load(bytes);
			const separations = doc.context
				.enumerateIndirectObjects()
				.filter(
					([, obj]) =>
						obj instanceof PDFArray && obj.get(0) === PDFName.of("Separation"),
				);
			expect(separations.length).toBe(2);
		});
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

describe("assemblePdf output intent", () => {
	const load = async (bytes: Uint8Array) =>
		PDFDocument.load(bytes, { updateMetadata: false });
	const intentOf = (doc: PDFDocument) => {
		const list = doc.catalog.lookup(PDFName.of("OutputIntents"));
		if (!(list instanceof PDFArray)) return undefined;
		expect(list.size()).toBe(1);
		return list.lookup(0, PDFDict);
	};
	const textOf = (dict: PDFDict, key: string) =>
		(dict.lookup(PDFName.of(key)) as PDFHexString).decodeText();
	const profileOf = (doc: PDFDocument, ref: unknown) => {
		const stream = doc.context.lookup(ref as PDFRef) as PDFRawStream;
		return {
			n: stream.dict.get(PDFName.of("N"))?.toString(),
			bytes: decodePDFRawStream(stream).decode(),
		};
	};
	/** Every stream an ICCBased space names, by object number. */
	const iccStreams = (doc: PDFDocument) => {
		const refs = new Set<string>();
		const text = doc.context
			.enumerateIndirectObjects()
			.map(([, obj]) => obj.toString())
			.join("\n");
		for (const m of text.matchAll(/\/ICCBased (\d+ \d+ R)/g))
			refs.add(m[1] as string);
		return refs;
	};
	const pages = [
		{ bytes: makePng(4, 3), format: png, widthPx: 40, heightPx: 30 },
		{ bytes: makePng(4, 3), format: png, widthPx: 40, heightPx: 30 },
	];

	it("declares sRGB by default and tags every page's RGB as sRGB", async () => {
		const doc = await load(await assemblePdf(pages, { dpi: 72 }));
		const intent = intentOf(doc) as PDFDict;
		expect(intent.get(PDFName.of("Type"))).toBe(PDFName.of("OutputIntent"));
		expect(intent.get(PDFName.of("S"))).toBe(PDFName.of("GTS_PDFX"));
		expect(textOf(intent, "OutputConditionIdentifier")).toBe(
			"sRGB IEC61966-2.1",
		);
		expect(textOf(intent, "Info")).toBe("sRGB IEC61966-2.1");
		expect(textOf(intent, "RegistryName")).toBe("http://www.color.org");
		const dest = intent.get(PDFName.of("DestOutputProfile"));
		expect(profileOf(doc, dest)).toEqual({ n: "3", bytes: SRGB_PROFILE });
		for (const page of doc.getPages()) {
			const spaces = page.node
				.Resources()
				?.lookup(PDFName.of("ColorSpace"), PDFDict);
			expect(spaces?.get(PDFName.of("DefaultRGB"))?.toString()).toBe(
				`[ /ICCBased ${dest?.toString()} ]`,
			);
		}
		expect(iccStreams(doc)).toEqual(new Set([dest?.toString()]));
	});

	it("declares a caller's CMYK profile once", async () => {
		const cmyk = iccProfile({ description: "Coated FOGRA39" });
		const doc = await load(
			await assemblePdf(pages, {
				dpi: 72,
				outputIntent: { profile: cmyk, identifier: "FOGRA39" },
			}),
		);
		const intent = intentOf(doc) as PDFDict;
		expect(textOf(intent, "OutputConditionIdentifier")).toBe("FOGRA39");
		expect(textOf(intent, "Info")).toBe("Coated FOGRA39");
		expect(intent.has(PDFName.of("RegistryName"))).toBe(false);
		expect(profileOf(doc, intent.get(PDFName.of("DestOutputProfile")))).toEqual(
			{ n: "4", bytes: cmyk },
		);
		// The CMYK profile is the intent's; content is tagged sRGB.
		expect(iccStreams(doc).size).toBe(1);
		const streams = doc.context
			.enumerateIndirectObjects()
			.filter(
				([, obj]) =>
					obj instanceof PDFRawStream && obj.dict.has(PDFName.of("N")),
			);
		expect(streams.length).toBe(2);
	});

	it("keeps one sRGB profile across vector pages that each carry one", async () => {
		const renderer = await createRenderer({
			ck: await loadCanvasKit("full"),
			fonts: { Geist: [testFontBytes("Geist-Regular.ttf")] },
		});
		const card = (value: string) =>
			createFrame({
				pos: { x: 0, y: 0 },
				size: { width: 120, height: 60 },
				children: [
					createText({
						pos: { x: 8, y: 8 },
						size: { width: 104, height: 40 },
						text: value,
						font: {
							family: "Geist",
							weight: 400,
							style: "normal",
							size: 20,
							lineHeight: 1.2,
						},
						color: "#1d3557",
					}),
				],
			});
		const vector = async (value: string) => ({
			bytes: (await renderer.renderPdf(card(value), { width: 120, height: 60 }))
				.bytes,
			format: "pdf" as const,
			widthPx: 120,
			heightPx: 60,
		});
		const doc = await load(
			await assemblePdf([await vector("one"), await vector("two"), ...pages], {
				dpi: 72,
			}),
		);
		const dest = intentOf(doc)?.get(PDFName.of("DestOutputProfile"));
		expect(iccStreams(doc)).toEqual(new Set([dest?.toString()]));
		const profiles = doc.context
			.enumerateIndirectObjects()
			.filter(
				([, obj]) =>
					obj instanceof PDFRawStream && obj.dict.has(PDFName.of("N")),
			);
		expect(profiles.length).toBe(1);
		renderer.dispose();
	});

	it("false leaves the intent and the tagging out", async () => {
		const doc = await load(
			await assemblePdf(pages, { dpi: 72, outputIntent: false }),
		);
		expect(intentOf(doc)).toBeUndefined();
		expect(iccStreams(doc).size).toBe(0);
		expect(doc.getPage(0).node.Resources()?.has(PDFName.of("ColorSpace"))).toBe(
			false,
		);
	});

	it("rejects a profile that cannot describe the output", async () => {
		await expect(
			assemblePdf(pages, {
				dpi: 72,
				outputIntent: { profile: iccProfile({ space: "Lab " }) },
			}),
		).rejects.toThrow(/output intent profile: .*not gray, RGB or CMYK/);
		await expect(
			assemblePdf(pages, {
				dpi: 72,
				outputIntent: { profile: new Uint8Array(64) },
			}),
		).rejects.toThrow(/too short/);
	});
});
