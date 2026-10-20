import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { zlibSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import { readFontMetrics } from "../src/font-metrics";
import { readSfnt, tagAt } from "../src/pdf/sfnt";
import { sfntBytes } from "../src/woff";

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const geist = testFontBytes("Geist-Regular.ttf");
const vend = testFontBytes("VendSans-Variable-latin.woff2");

function tables(sfnt: Uint8Array): Map<string, Uint8Array> {
	const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
	const out = new Map<string, Uint8Array>();
	for (let i = 0; i < dv.getUint16(4); i++) {
		const o = 12 + i * 16;
		const at = dv.getUint32(o + 8);
		out.set(tagAt(sfnt, o), sfnt.subarray(at, at + dv.getUint32(o + 12)));
	}
	return out;
}

function woff(sfnt: Uint8Array): Uint8Array {
	const entries = [...tables(sfnt)].map(([tag, data]) => {
		const packed = zlibSync(data);
		return { tag, data, stored: packed.length < data.length ? packed : data };
	});
	let size = 44 + 20 * entries.length;
	const starts = entries.map((e) => {
		const at = size;
		size += (e.stored.length + 3) & ~3;
		return at;
	});
	const out = new Uint8Array(size);
	const dv = new DataView(out.buffer);
	out.set(new TextEncoder().encode("wOFF"));
	out.set(sfnt.subarray(0, 4), 4);
	dv.setUint32(8, size);
	dv.setUint16(12, entries.length);
	entries.forEach((e, i) => {
		const o = 44 + 20 * i;
		out.set(new TextEncoder().encode(e.tag), o);
		dv.setUint32(o + 4, starts[i] as number);
		dv.setUint32(o + 8, e.stored.length);
		dv.setUint32(o + 12, e.data.length);
		out.set(e.stored, starts[i]);
	});
	return out;
}

const glyphIds = (bytes: Uint8Array, text: string) => {
	const typeface = ck.Typeface.MakeTypefaceFromData(
		bytes.slice().buffer as ArrayBuffer,
	);
	const ids = [...typeface.getGlyphIDs(text)];
	typeface.delete();
	return ids;
};

describe("sfntBytes", () => {
	test("returns a TrueType or OpenType file as given", () => {
		expect(sfntBytes(geist)).toBe(geist);
	});

	test("unpacks WOFF to the tables it wraps", () => {
		const unpacked = sfntBytes(woff(geist));
		expect(readSfnt(unpacked)?.outlines).toBe("truetype");
		const want = tables(geist);
		const got = tables(unpacked);
		expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
		for (const [tag, data] of want)
			if (tag !== "head") expect(got.get(tag)).toEqual(data);
	});

	test("unpacks WOFF2, rebuilding glyf, loca and hmtx", () => {
		const unpacked = sfntBytes(vend);
		const info = readSfnt(unpacked);
		expect(info?.outlines).toBe("truetype");
		expect(info?.axes.map((a) => a.tag)).toEqual(["wght"]);
		expect(tables(unpacked).has("glyf")).toBe(true);
		const text = "Fresh coat AZ az 09";
		expect(glyphIds(unpacked, text)).toEqual(glyphIds(vend, text));
		expect(glyphIds(unpacked, text).every((id) => id > 0)).toBe(true);
	});

	test("decodes the same bytes once", () => {
		expect(sfntBytes(vend)).toBe(sfntBytes(vend));
	});

	test("throws on a truncated WOFF2 file", () => {
		expect(() => sfntBytes(vend.slice(0, 200))).toThrow();
	});
});

describe("readFontMetrics", () => {
	test("reads WOFF and WOFF2 files", () => {
		expect(readFontMetrics(woff(geist))).toEqual(readFontMetrics(geist));
		const metrics = readFontMetrics(vend);
		expect(metrics).not.toBeNull();
		expect(metrics?.capHeight).toBeGreaterThan(0);
	});
});
