import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { beforeAll, describe, expect, test } from "vitest";
import { createFrame, createText } from "../src/node";
import { readSfnt } from "../src/pdf/sfnt";
import { subsetFont } from "../src/pdf/subset";
import { createRenderer, type Renderer } from "../src/renderer";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
const geist = testFontBytes("Geist-Regular.ttf");
const hebrew = testFontBytes("NotoSansHebrew-Regular.ttf");

beforeAll(async () => {
	ck = await loadCanvasKit();
});

const arrayBuffer = (b: Uint8Array) =>
	b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function glyphsOf(bytes: Uint8Array, text: string): number[] {
	const typeface = ck.Typeface.MakeTypefaceFromData(arrayBuffer(bytes));
	const ids = [...new Set([...text].map((c) => typeface.getGlyphIDs(c)[0]))];
	typeface.delete();
	return ids;
}

// Each glyph drawn alone, unhinted, in a cell of its own.
function render(bytes: Uint8Array, glyphs: number[]): Uint8Array {
	const typeface = ck.Typeface.MakeTypefaceFromData(arrayBuffer(bytes));
	expect(typeface).toBeTruthy();
	const font = new ck.Font(typeface, 40);
	font.setHinting(ck.FontHinting.None);
	const cell = 56;
	const surface = ck.MakeSurface(cell * glyphs.length, cell);
	const canvas = surface.getCanvas();
	canvas.clear(ck.WHITE);
	const paint = new ck.Paint();
	paint.setAntiAlias(true);
	glyphs.forEach((g, i) => {
		const blob = ck.TextBlob.MakeFromGlyphs([g], font);
		canvas.drawTextBlob(blob, i * cell + 8, 44, paint);
		blob.delete();
	});
	const pixels = canvas.readPixels(0, 0, {
		width: cell * glyphs.length,
		height: cell,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	paint.delete();
	font.delete();
	surface.delete();
	typeface.delete();
	return new Uint8Array(pixels);
}

const blank = (pixels: Uint8Array) => pixels.every((v) => v === 255);

function checksum(b: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < b.length; i += 4)
		for (let k = 0; k < 4; k++) sum += (b[i + k] ?? 0) * 2 ** (24 - 8 * k);
	return sum % 2 ** 32;
}

// The tables of a font file, as a font reader finds them.
function tablesOf(bytes: Uint8Array): Map<string, Uint8Array> {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tables = new Map<string, Uint8Array>();
	for (let i = 0; i < dv.getUint16(4); i++) {
		const o = 12 + 16 * i;
		const tag = String.fromCharCode(...bytes.subarray(o, o + 4));
		const at = dv.getUint32(o + 8);
		tables.set(tag, bytes.slice(at, at + dv.getUint32(o + 12)));
	}
	return tables;
}

// The tables of a font file, after checking its directory, padding and
// checksums.
function checked(bytes: Uint8Array): Map<string, Uint8Array> {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const n = dv.getUint16(4);
	const entry = Math.floor(Math.log2(n));
	expect(dv.getUint16(6)).toBe(16 << entry);
	expect(dv.getUint16(8)).toBe(entry);
	expect(dv.getUint16(10)).toBe(n * 16 - (16 << entry));
	expect(checksum(bytes)).toBe(0xb1b0afba);
	const tables = tablesOf(bytes);
	let previous = "";
	let end = 12 + 16 * n;
	[...tables].forEach(([tag, table], i) => {
		const o = 12 + 16 * i;
		expect(tag > previous).toBe(true);
		previous = tag;
		expect(dv.getUint32(o + 8)).toBe(end);
		expect(dv.getUint32(o + 12)).toBe(table.length);
		end += (table.length + 3) & ~3;
		if (tag === "head") table.fill(0, 8, 12);
		expect(checksum(table)).toBe(dv.getUint32(o + 4));
	});
	expect(end).toBe(bytes.length);
	return tables;
}

const sameInfo = (a: Uint8Array, b: Uint8Array, glyphs: number[]) => {
	const [x, y] = [readSfnt(a), readSfnt(b)];
	if (!x || !y) throw new Error("not a font");
	const { advance: _a, ...xs } = x;
	const { advance: _b, ...ys } = y;
	expect(ys).toEqual(xs);
	for (const g of glyphs) expect(y.advance(g)).toBe(x.advance(g));
};

// A font file of `tables`, laid out as a reader needs but with no checksums.
function sfnt(version: string, tables: Record<string, ArrayLike<number>>) {
	const tags = Object.keys(tables).sort();
	const entry = Math.floor(Math.log2(tags.length));
	const u32 = (v: number) => [v >>> 24, v >>> 16, v >>> 8, v];
	const u16 = (v: number) => [v >>> 8, v];
	const dir = [
		...Buffer.from(version, "latin1"),
		...u16(tags.length),
		...u16(16 << entry),
		...u16(entry),
		...u16(16 * tags.length - (16 << entry)),
	];
	const body: number[] = [];
	for (const tag of tags) {
		const table = [...Array.from(tables[tag] as ArrayLike<number>)];
		dir.push(...Buffer.from(tag), ...u32(0));
		dir.push(...u32(12 + 16 * tags.length + body.length), ...u32(table.length));
		while (table.length % 4) table.push(0);
		body.push(...table);
	}
	return Uint8Array.from([...dir, ...body]);
}

// Geist with each glyph's data in a slot of `slot(length)` bytes, and a loca
// table of either format.
function respaced(slot: (length: number) => number, long: boolean) {
	const tables = tablesOf(geist);
	const loca = tables.get("loca") as Uint8Array;
	const glyf = tables.get("glyf") as Uint8Array;
	const lv = new DataView(loca.buffer, loca.byteOffset);
	const count = loca.length / 2 - 1;
	const starts = [0];
	const slots: number[] = [];
	for (let g = 0; g < count; g++) {
		const piece = glyf.subarray(
			lv.getUint16(2 * g) * 2,
			lv.getUint16(2 * g + 2) * 2,
		);
		slots.push(
			...piece,
			...new Array(slot(piece.length) - piece.length).fill(0),
		);
		starts.push(slots.length);
	}
	const head = (tables.get("head") as Uint8Array).slice();
	new DataView(head.buffer).setInt16(50, long ? 1 : 0);
	const newLoca = new Uint8Array(starts.length * (long ? 4 : 2));
	const nv = new DataView(newLoca.buffer);
	starts.forEach((s, i) =>
		long ? nv.setUint32(4 * i, s) : nv.setUint16(2 * i, s / 2),
	);
	return sfnt("\0\x01\0\0", {
		...Object.fromEntries(tables),
		head,
		loca: newLoca,
		glyf: slots,
	});
}

describe("subsetFont, TrueType outlines", () => {
	const dropped = ["GSUB", "GPOS", "GDEF", "cmap", "gasp", "meta"];

	test("keeps the glyphs used, and a composite's components", () => {
		const used = glyphsOf(geist, "Fresh éÅ");
		const subset = subsetFont(geist, used) as Uint8Array;
		expect(subset.length).toBeLessThan(geist.length / 5);
		const tables = checked(subset);
		for (const tag of dropped) expect(tables.has(tag)).toBe(false);
		for (const tag of ["head", "hhea", "hmtx", "maxp", "loca", "glyf"])
			expect(tables.has(tag)).toBe(true);
		for (const tag of ["cvt ", "fpgm", "prep", "OS/2", "post", "name"])
			expect(tables.has(tag)).toBe(true);
		const e = glyphsOf(geist, "e")[0] as number;
		const composite = glyphsOf(geist, "é")[0] as number;
		const parts = render(subset, [e, composite]);
		expect(blank(parts)).toBe(false);
		expect(parts).toEqual(render(geist, [e, composite]));
		sameInfo(geist, subset, used);
		expect(readSfnt(subset)?.outlines).toBe("truetype");
	});

	test("draws kept glyphs as the whole font does and leaves others empty", () => {
		const used = glyphsOf(geist, "Fresh éÅ");
		const subset = subsetFont(geist, used) as Uint8Array;
		expect(render(subset, used)).toEqual(render(geist, used));
		const others = glyphsOf(geist, "xyzQ");
		expect(blank(render(geist, others))).toBe(false);
		expect(blank(render(subset, others))).toBe(true);
		expect(blank(render(subset, [0]))).toBe(false);
	});

	test("keeps glyph ids and count whatever is dropped", () => {
		const subset = subsetFont(geist, glyphsOf(geist, "a")) as Uint8Array;
		const [orig, cut] = [tablesOf(geist), checked(subset)];
		expect(cut.get("maxp")).toEqual(orig.get("maxp"));
		const loca = cut.get("loca") as Uint8Array;
		expect(loca.length).toBe((orig.get("loca") as Uint8Array).length);
	});

	test("keeps a long loca, and moves to one when glyphs outgrow a short loca", () => {
		const sample = glyphsOf(geist, "Aé@gÖ");
		const all = Array.from({ length: 973 }, (_, i) => i);
		const format = (font: Uint8Array) => {
			const head = tablesOf(font).get("head") as Uint8Array;
			return new DataView(head.buffer, head.byteOffset).getInt16(50);
		};
		const roomy = respaced((n) => n + 100, true);
		const tight = respaced((n) => 4 * Math.floor((n * 1.68) / 4) + 2, false);
		expect(format(tight)).toBe(0);
		expect(tablesOf(tight).get("glyf")?.length).toBeLessThan(0x1fffe);
		for (const [font, wide] of [
			[roomy, 1],
			[tight, 1],
			[geist, 0],
		] as const) {
			const subset = subsetFont(font, all) as Uint8Array;
			const tables = checked(subset);
			expect(format(subset)).toBe(wide);
			expect(tables.get("loca")?.length).toBe(974 * (wide ? 4 : 2));
			expect(render(subset, sample)).toEqual(render(font, sample));
			const some = subsetFont(font, sample) as Uint8Array;
			expect(render(some, sample)).toEqual(render(font, sample));
			expect(format(some)).toBe(font === roomy ? 1 : 0);
		}
	});

	test("subsets a font without hinting and one with right-to-left glyphs", () => {
		const used = glyphsOf(hebrew, "שלום");
		const subset = subsetFont(hebrew, used) as Uint8Array;
		expect(subset.length).toBeLessThan(hebrew.length / 3);
		checked(subset);
		expect(render(subset, used)).toEqual(render(hebrew, used));
		sameInfo(hebrew, subset, used);
	});

	test("is deterministic", () => {
		const used = glyphsOf(geist, "Fresh");
		expect(subsetFont(geist, used)).toEqual(subsetFont(geist, used));
	});

	test("returns null for what it cannot cut down", () => {
		expect(subsetFont(geist.subarray(0, 5000), [1])).toBeNull();
		expect(subsetFont(geist, [100000])).toBeNull();
		expect(subsetFont(new Uint8Array(40), [1])).toBeNull();
		expect(
			subsetFont(testFontBytes("VendSans-Variable-latin.woff2"), [1]),
		).toBeNull();
	});
});

describe("subsets in a PDF", () => {
	let renderer: Renderer;
	beforeAll(async () => {
		renderer = await createRenderer({
			ck,
			fonts: { Geist: [geist], Hebrew: [hebrew] },
		});
	});

	const page = (family: string, value: string) =>
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
	const latin = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
	const run = (cmd: string, bytes: Uint8Array) => {
		const dir = mkdtempSync(join(tmpdir(), "freshcoat-subset-"));
		try {
			writeFileSync(join(dir, "page.pdf"), bytes);
			const out = spawnSync(
				cmd,
				[join(dir, "page.pdf")].concat(cmd === "pdftotext" ? ["-"] : []),
			);
			expect(out.status).toBe(0);
			return out.stdout.toString("utf8");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};
	const has = (cmd: string) => spawnSync(cmd, ["-v"]).status === 0;

	test("embeds a tagged subset a fraction of the font's size", async () => {
		const pdf = await renderer.renderPdf(page("Geist", "Fresh coat éÅ"), {
			width: 300,
			height: 60,
		});
		expect(pdf.bytes.length).toBeLessThan(geist.length / 4);
		const body = latin(pdf.bytes);
		expect(body).toMatch(/\/BaseFont \/[A-Z]{6}\+Geist-F0/);
		expect(body).toMatch(/\/FontName \/[A-Z]{6}\+Geist-F0/);
	});

	test("embeds the Hebrew glyphs used", async () => {
		const pdf = await renderer.renderPdf(page("Hebrew", "שלום"), {
			width: 300,
			height: 60,
		});
		expect(pdf.bytes.length).toBeLessThan(hebrew.length / 2);
	});

	test.skipIf(!has("pdftotext"))("keeps the text selectable", async () => {
		const pdf = await renderer.renderPdf(page("Geist", "Fresh coat éÅ"), {
			width: 300,
			height: 60,
		});
		expect(run("pdftotext", pdf.bytes)).toContain("Fresh coat éÅ");
	});

	test.skipIf(!has("pdffonts"))("is read as an embedded subset", async () => {
		const pdf = await renderer.renderPdf(page("Geist", "Fresh coat éÅ"), {
			width: 300,
			height: 60,
		});
		expect(run("pdffonts", pdf.bytes)).toMatch(
			/[A-Z]{6}\+Geist-F0\s+CID TrueType\s+Identity-H\s+yes yes yes/,
		);
	});
});
