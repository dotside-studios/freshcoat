import { loadCanvasKit, testFontBytes, type TestFont } from "@freshcoat-js/test-utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type GlyphPath, readOutlines } from "../src/pdf/outlines";
import { sfntBytes } from "../src/woff";

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit instance
let ck: any;
// biome-ignore lint/suspicious/noExplicitAny: CanvasKit surface
let surface: any;
// biome-ignore lint/suspicious/noExplicitAny: CanvasKit paint
let paint: any;
const SIZE = 64;
const EDGE = 128;

beforeAll(async () => {
	ck = await loadCanvasKit();
	surface = ck.MakeSurface(EDGE, EDGE);
	paint = new ck.Paint();
	paint.setColor(ck.BLACK);
	paint.setAntiAlias(true);
});

afterAll(() => {
	paint.delete();
	surface.delete();
});

// biome-ignore lint/suspicious/noExplicitAny: CanvasKit canvas
function pixels(draw: (canvas: any) => void): Uint8Array {
	const canvas = surface.getCanvas();
	canvas.clear(ck.WHITE);
	draw(canvas);
	const image = surface.makeImageSnapshot();
	const out = image.readPixels(0, 0, {
		width: EDGE,
		height: EDGE,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	}) as Uint8Array;
	image.delete();
	return out;
}

function drawPath(glyph: GlyphPath, unitsPerEm: number) {
	const k = SIZE / unitsPerEm;
	const verbs = [ck.MOVE_VERB, ck.LINE_VERB, ck.CUBIC_VERB, ck.CLOSE_VERB];
	const cmds: number[] = [];
	for (let i = 0; i < glyph.length; ) {
		const op = glyph[i++] as number;
		cmds.push(verbs[op]);
		for (let p = 0; p < (op === 2 ? 3 : op === 3 ? 0 : 1); p++)
			cmds.push(32 + (glyph[i++] as number) * k, 96 - (glyph[i++] as number) * k);
	}
	const path = ck.Path.MakeFromCmds(cmds);
	try {
		return pixels((canvas) => canvas.drawPath(path, paint));
	} finally {
		path.delete();
	}
}

// Pixels that differ by more than antialiasing does.
function off(a: Uint8Array, b: Uint8Array): number {
	let n = 0;
	for (let i = 0; i < a.length; i += 4)
		if (Math.abs((a[i] as number) - (b[i] as number)) > 160) n++;
	return n;
}

describe("readOutlines", () => {
	// Each glyph of `text` as CanvasKit draws it from the font, against its
	// outline filled as a path.
	const matches = (bytes: Uint8Array, text: string) => {
		const outlines = readOutlines(bytes);
		expect(outlines).not.toBeNull();
		if (!outlines) return;
		const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		const typeface = ck.Typeface.MakeTypefaceFromData(data);
		const font = new ck.Font(typeface, SIZE);
		font.setHinting(ck.FontHinting.None);
		font.setSubpixel(true);
		try {
			for (const id of font.getGlyphIDs(text)) {
				const glyph = outlines.glyph(id);
				expect(glyph).not.toBeNull();
				const drawn = pixels((canvas) => canvas.drawGlyphs([id], [0, 0], 32, 96, font, paint));
				expect(off(drawn, drawPath(glyph as GlyphPath, outlines.unitsPerEm))).toBe(0);
			}
		} finally {
			font.delete();
			typeface.delete();
		}
	};
	const latin = "AaBbGgQq@&%$ÅÉ0123fi";

	test.each<[TestFont, string]>([
		["Geist-Regular.ttf", latin],
		["NotoSansHebrew-Regular.ttf", "שָׁלוֹם"],
		["VendSans-Regular-CFF.otf", latin],
		["VendSans-Variable-CFF2.otf", latin],
	])("reads the glyphs of %s as CanvasKit draws them", (file, text) => {
		matches(testFontBytes(file), text);
	});

	test("reads the first face of a collection", () => {
		const sfnt = testFontBytes("Geist-Regular.ttf");
		const ttc = new Uint8Array(16 + sfnt.length);
		const dv = new DataView(ttc.buffer);
		ttc.set(new TextEncoder().encode("ttcf"), 0);
		dv.setUint32(4, 0x00010000);
		dv.setUint32(8, 1);
		dv.setUint32(12, 16);
		ttc.set(sfnt, 16);
		for (let i = 0; i < dv.getUint16(20); i++) {
			const o = 16 + 12 + 16 * i + 8;
			dv.setUint32(o, dv.getUint32(o) + 16);
		}
		matches(ttc, latin);
	});

	// The CFF2 font was built from the TrueType font's instances at 300 and
	// 700, so between them it blends to the shapes the TrueType font varies to.
	test.each([300, 500, 700])("blends CFF2 outlines at wght %d", (wght) => {
		const vend = sfntBytes(testFontBytes("VendSans-Variable-latin.woff2"));
		const cff2Bytes = testFontBytes("VendSans-Variable-CFF2.otf");
		const truetype = readOutlines(vend, { wght });
		const cff2 = readOutlines(cff2Bytes, { wght });
		const light = readOutlines(cff2Bytes, { wght: 300 });
		if (!truetype || !cff2 || !light) throw new Error("no outlines");
		const glyphIds = (bytes: Uint8Array) => {
			const typeface = ck.Typeface.MakeTypefaceFromData(bytes.slice().buffer);
			const ids = [...typeface.getGlyphIDs("RgQ&8É")] as number[];
			typeface.delete();
			return ids;
		};
		const trueIds = glyphIds(vend);
		glyphIds(cff2Bytes).forEach((id, i) => {
			const blended = drawPath(cff2.glyph(id) as GlyphPath, cff2.unitsPerEm);
			const varied = drawPath(truetype.glyph(trueIds[i] as number) as GlyphPath, truetype.unitsPerEm);
			expect(off(blended, varied)).toBe(0);
			if (wght > 300)
				expect(off(blended, drawPath(light.glyph(id) as GlyphPath, light.unitsPerEm))).toBeGreaterThan(0);
		});
	});

	test("reads nothing from bytes that are not a font, and no glyph past the last", () => {
		expect(readOutlines(new Uint8Array(64))).toBeNull();
		const outlines = readOutlines(testFontBytes("Geist-Regular.ttf"));
		expect(outlines?.glyph(100000)).toBeNull();
		expect(outlines?.glyph(0)).not.toBeNull();
	});
});
