// BMP, ICO, WBMP and AVIF sizes read from hand-built headers, and what the
// renderer does with the real files CanvasKit can and cannot decode.

import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCanvasKit, pngHeader } from "@freshcoat-js/test-utils";
import {
	assertDecodableImage,
	parseImageInfo,
	readImageInfo,
	sniffImageType,
} from "../src/image-info";
import { createFrame, createImage } from "../src/node";
import { createRenderer } from "../src/renderer";

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function bmp(dibSize: number, width: number, height: number): Uint8Array {
	const b = new Uint8Array(Math.max(26, 14 + dibSize));
	const dv = new DataView(b.buffer);
	b.set(ascii("BM"));
	dv.setUint32(14, dibSize, true);
	if (dibSize === 12) {
		dv.setUint16(18, width, true);
		dv.setUint16(20, height, true);
	} else {
		dv.setInt32(18, width, true);
		dv.setInt32(22, height, true);
	}
	return b;
}

type IcoEntry = { w: number; h: number; data: Uint8Array };

function ico(entries: IcoEntry[], type = 1): Uint8Array {
	const dirEnd = 6 + 16 * entries.length;
	const size = entries.reduce((n, e) => n + e.data.length, dirEnd);
	const b = new Uint8Array(size);
	const dv = new DataView(b.buffer);
	dv.setUint16(2, type, true);
	dv.setUint16(4, entries.length, true);
	let offset = dirEnd;
	entries.forEach((e, i) => {
		const at = 6 + 16 * i;
		b[at] = e.w & 0xff;
		b[at + 1] = e.h & 0xff;
		dv.setUint32(at + 8, e.data.length, true);
		dv.setUint32(at + 12, offset, true);
		b.set(e.data, offset);
		offset += e.data.length;
	});
	return b;
}

const dib = new Uint8Array(40).fill(1);

function box(type: string, ...body: (Uint8Array | number[])[]): Uint8Array {
	const parts = body.map((p) => Uint8Array.from(p));
	const size = 8 + parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(size);
	new DataView(out.buffer).setUint32(0, size);
	out.set(ascii(type), 4);
	let at = 8;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

const u32 = (...v: number[]) =>
	v.flatMap((n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const ispe = (w: number, h: number) => box("ispe", u32(0, w, h));
const ftyp = (major = "avif", ...compat: string[]) =>
	box("ftyp", ascii(major), u32(0), ...compat.map(ascii));
const pitm = (id: number) => box("pitm", u32(0), [id >> 8, id & 255]);
// version 0, flags 0: one entry per item, each association one byte.
const ipma = (items: Record<number, number[]>) =>
	box(
		"ipma",
		u32(0, Object.keys(items).length),
		...Object.entries(items).map(([id, idx]) => [
			0,
			Number(id),
			idx.length,
			...idx,
		]),
	);
const avif = (...meta: Uint8Array[]) =>
	Uint8Array.from([...ftyp(), ...box("meta", u32(0), ...meta)]);

function cat(...parts: Uint8Array[]): Uint8Array {
	return Uint8Array.from(parts.flatMap((p) => [...p]));
}

describe("BMP header", () => {
	it("reads the info header, whose height may be negative", () => {
		expect(parseImageInfo(bmp(40, 640, 480))).toEqual({
			contentType: "image/bmp",
			width: 640,
			height: 480,
		});
		expect(parseImageInfo(bmp(40, 640, -480))).toMatchObject({
			width: 640,
			height: 480,
		});
		for (const size of [52, 56, 64, 108, 124])
			expect(parseImageInfo(bmp(size, 3, 5))).toMatchObject({
				width: 3,
				height: 5,
			});
	});

	it("reads the core header", () => {
		expect(parseImageInfo(bmp(12, 300, 200))).toEqual({
			contentType: "image/bmp",
			width: 300,
			height: 200,
		});
	});

	it("refuses bad sizes, unknown headers and truncation", () => {
		expect(parseImageInfo(bmp(40, 0, 10))).toBeNull();
		expect(parseImageInfo(bmp(40, -4, 10))).toBeNull();
		expect(parseImageInfo(bmp(40, 10, 0))).toBeNull();
		expect(parseImageInfo(bmp(12, 0, 5))).toBeNull();
		expect(parseImageInfo(bmp(41, 10, 10))).toBeNull();
		expect(parseImageInfo(bmp(40, 10, 10).subarray(0, 22))).toBeNull();
		expect(parseImageInfo(bmp(12, 10, 10).subarray(0, 20))).toBeNull();
		expect(sniffImageType(bmp(41, 10, 10))).toBeNull();
	});

	it("is refused by assertDecodableImage when it declares too much", () => {
		expect(() => assertDecodableImage(bmp(40, 30000, 30000))).toThrow(
			/30000x30000/,
		);
		expect(() => assertDecodableImage(bmp(40, 30000, -30000))).toThrow(
			/30000x30000/,
		);
		expect(() => assertDecodableImage(bmp(40, 8, 8))).not.toThrow();
		expect(() => assertDecodableImage(bmp(40, 0, 8))).toThrow(/header/);
	});
});

describe("ICO header", () => {
	const entry = (w: number, h: number): IcoEntry => ({
		w,
		h,
		data: dib,
	});

	it("takes the largest entry, 0 meaning 256", () => {
		expect(parseImageInfo(ico([entry(16, 16)]))).toEqual({
			contentType: "image/x-icon",
			width: 16,
			height: 16,
		});
		expect(
			parseImageInfo(ico([entry(16, 16), entry(0, 0), entry(48, 48)])),
		).toMatchObject({ width: 256, height: 256 });
		expect(parseImageInfo(ico([entry(32, 8), entry(8, 16)]))).toMatchObject({
			width: 32,
			height: 8,
		});
		expect(parseImageInfo(ico([entry(0, 10)], 2))).toMatchObject({
			width: 256,
			height: 10,
		});
	});

	it("reads the PNG header of an embedded PNG", () => {
		const png = pngHeader(512, 300);
		expect(
			parseImageInfo(ico([entry(16, 16), { w: 0, h: 0, data: png }])),
		).toMatchObject({ width: 512, height: 300 });
		expect(
			parseImageInfo(ico([{ w: 1, h: 1, data: pngHeader(20000, 20000) }])),
		).toMatchObject({ width: 20000, height: 20000 });
	});

	it("is refused by assertDecodableImage when an embedded PNG is huge", () => {
		const huge = ico([{ w: 0, h: 0, data: pngHeader(30000, 30000) }]);
		expect(() => assertDecodableImage(huge)).toThrow(/30000x30000/);
	});

	it("asks for more when an entry or its data is past the buffer", () => {
		const file = ico([entry(16, 16), { w: 0, h: 0, data: pngHeader(9, 9) }]);
		expect(parseImageInfo(file.subarray(0, 20))).toBeNull();
		expect(parseImageInfo(file.subarray(0, file.length - 10))).toBeNull();
		expect(parseImageInfo(file)).toMatchObject({ width: 16, height: 16 });
	});

	it("refuses what is not a directory", () => {
		const good = ico([entry(16, 16)]);
		const mutate = (i: number, v: number) => {
			const c = good.slice();
			c[i] = v;
			return c;
		};
		expect(parseImageInfo(mutate(2, 3))).toBeNull();
		expect(parseImageInfo(mutate(4, 0))).toBeNull();
		expect(parseImageInfo(mutate(5, 9))).toBeNull();
		expect(parseImageInfo(mutate(9, 1))).toBeNull();
		expect(parseImageInfo(mutate(18, 0))).toBeNull();
		expect(parseImageInfo(mutate(14, 0))).toBeNull();
		expect(sniffImageType(mutate(9, 1))).toBeNull();
		expect(parseImageInfo(good.subarray(0, 4))).toBeNull();
	});
});

describe("WBMP header", () => {
	it("reads multi-byte sizes", () => {
		expect(parseImageInfo(Uint8Array.from([0, 0, 8, 4, 15]))).toEqual({
			contentType: "image/vnd.wap.wbmp",
			width: 8,
			height: 4,
		});
		expect(
			parseImageInfo(Uint8Array.from([0, 0, 0x82, 0x2c, 0x05])),
		).toMatchObject({ width: 300, height: 5 });
	});

	it("refuses zero sizes, extension headers and runaway integers", () => {
		expect(parseImageInfo(Uint8Array.from([0, 0, 0, 4, 1]))).toBeNull();
		expect(parseImageInfo(Uint8Array.from([0, 0, 8, 0, 1]))).toBeNull();
		expect(parseImageInfo(Uint8Array.from([0, 0x80, 8, 4, 1]))).toBeNull();
		expect(
			parseImageInfo(Uint8Array.from([0, 0, 0x81, 0x81, 0x81, 1, 2])),
		).toBeNull();
		expect(parseImageInfo(Uint8Array.from([0, 0, 0x82, 0x2c]))).toBeNull();
		expect(parseImageInfo(new Uint8Array(64))).toBeNull();
	});
});

describe("AVIF header", () => {
	it("knows avif and avis as a compatible brand", () => {
		expect(sniffImageType(ftyp("mif1", "miaf", "avif"))).toBe("image/avif");
		expect(sniffImageType(ftyp("mif1", "avis"))).toBe("image/avif");
		expect(sniffImageType(ftyp("heic", "mif1"))).toBeNull();
		expect(sniffImageType(ftyp("avif"))).toBe("image/avif");
	});

	it("reads ispe through meta, iprp and ipco", () => {
		const file = avif(box("iprp", box("ipco", ispe(640, 480))));
		expect(parseImageInfo(file)).toEqual({
			contentType: "image/avif",
			width: 640,
			height: 480,
		});
	});

	it("uses the ispe of the primary item among several", () => {
		const iprp = box(
			"iprp",
			box(
				"ipco",
				box("colr", [1, 2, 3]),
				ispe(4000, 3000),
				ispe(160, 120),
				ispe(2000, 1500),
			),
			ipma({ 1: [1, 2], 2: [1, 3], 3: [1, 4] }),
		);
		expect(parseImageInfo(avif(pitm(2), iprp))).toMatchObject({
			width: 160,
			height: 120,
		});
		expect(parseImageInfo(avif(pitm(3), iprp))).toMatchObject({
			width: 2000,
			height: 1500,
		});
		expect(parseImageInfo(avif(pitm(1), iprp))).toMatchObject({
			width: 4000,
			height: 3000,
		});
	});

	it("falls back to the largest ispe when the primary cannot be resolved", () => {
		const props = box("ipco", ispe(160, 120), ispe(4000, 3000), ispe(20, 20));
		const largest = { width: 4000, height: 3000 };
		expect(parseImageInfo(avif(box("iprp", props)))).toMatchObject(largest);
		expect(
			parseImageInfo(avif(pitm(9), box("iprp", props, ipma({ 1: [1] })))),
		).toMatchObject(largest);
		expect(
			parseImageInfo(avif(pitm(1), box("iprp", props, ipma({ 1: [7] })))),
		).toMatchObject(largest);
	});

	it("handles 64-bit and to-the-end box sizes", () => {
		const meta = box("meta", u32(0), box("iprp", box("ipco", ispe(7, 9))));
		const large = Uint8Array.from([
			...u32(1),
			...ascii("meta"),
			...u32(0, meta.length + 8),
			...meta.subarray(8),
		]);
		expect(parseImageInfo(cat(ftyp(), large))).toMatchObject({
			width: 7,
			height: 9,
		});
		const toEnd = meta.slice();
		toEnd.set(u32(0), 0);
		expect(parseImageInfo(cat(ftyp(), toEnd))).toMatchObject({ width: 7 });
		const free = box("free", new Array(30).fill(0));
		expect(parseImageInfo(cat(ftyp(), free, meta))).toMatchObject({ width: 7 });
	});

	it("refuses malformed and truncated files", () => {
		const whole = avif(box("iprp", box("ipco", ispe(640, 480))));
		expect(parseImageInfo(whole.subarray(0, whole.length - 5))).toBeNull();
		expect(parseImageInfo(ftyp())).toBeNull();
		expect(parseImageInfo(avif())).toBeNull();
		expect(
			parseImageInfo(avif(box("iprp", box("ipco", ispe(0, 480))))),
		).toBeNull();
		expect(
			parseImageInfo(avif(box("iprp", box("ipco", box("ispe", u32(0, 1)))))),
		).toBeNull();
		const small = (size: number) => {
			const c = whole.slice();
			new DataView(c.buffer).setUint32(ftyp().length, size);
			return c;
		};
		expect(parseImageInfo(small(4))).toBeNull();
		expect(parseImageInfo(small(7))).toBeNull();
		expect(parseImageInfo(small(1))).toBeNull();
		expect(parseImageInfo(small(0xffffffff))).toBeNull();
	});

	it("refuses a child box running past its parent", () => {
		const ipco = box("ipco", ispe(10, 10));
		const iprp = box("iprp", ipco);
		iprp[iprp.length - 1 - ipco.length + 3] = 0xff;
		new DataView(iprp.buffer).setUint32(8, 0xffff);
		expect(parseImageInfo(avif(iprp))).toBeNull();
	});

	it("bounds the walk: nesting is not followed and boxes are counted", () => {
		let nested = ispe(10, 10);
		for (let i = 0; i < 2000; i++) nested = box("meta", u32(0), nested);
		expect(parseImageInfo(cat(ftyp(), nested))).toBeNull();
		let deep = box("ipco", ispe(10, 10));
		for (let i = 0; i < 2000; i++) deep = box("iprp", deep);
		expect(parseImageInfo(avif(deep))).toBeNull();
		const filler = Array.from({ length: 1500 }, () => box("free", []));
		const file = cat(ftyp(), ...filler, avif().subarray(ftyp().length));
		expect(parseImageInfo(file)).toBeNull();
		const many = box(
			"ipco",
			...Array.from({ length: 2000 }, () => box("free", [])),
		);
		expect(parseImageInfo(avif(box("iprp", many)))).toBeNull();
	});

	it("asks readImageInfo for more when meta lies past the first read", async () => {
		const pad = box("free", new Array(80 * 1024).fill(0));
		const file = cat(
			ftyp(),
			pad,
			avif(box("iprp", box("ipco", ispe(33, 44)))).subarray(ftyp().length),
		);
		expect(parseImageInfo(file)).toMatchObject({ width: 33 });
		expect(await readImageInfo(new Blob([file as BlobPart]))).toMatchObject({
			width: 33,
			height: 44,
		});
		const unfinished = file.subarray(0, file.length - 6);
		expect(await readImageInfo(new Blob([unfinished as BlobPart]))).toBeNull();
	});

	it("is refused by assertDecodableImage when it declares too much", () => {
		const huge = avif(box("iprp", box("ipco", ispe(30000, 30000))));
		expect(() => assertDecodableImage(huge)).toThrow(/30000x30000/);
	});
});

describe("real files through the renderer", () => {
	const fixture = (name: string) =>
		new Uint8Array(
			readFileSync(join(import.meta.dirname, "fixtures", "images", name)),
		);
	const scene = (src: string) =>
		createFrame({
			pos: { x: 0, y: 0 },
			size: { width: 20, height: 20 },
			children: [
				createImage({
					pos: { x: 0, y: 0 },
					size: { width: 20, height: 20 },
					src,
					fit: "cover",
				}),
			],
		});
	const warnings = async (
		src: string,
		bytes: Uint8Array,
		maxPixels?: number,
	) => {
		const renderer = await createRenderer({
			ck,
			maxImageDecodePixels: maxPixels,
		});
		const frame = await renderer.render(scene(src), {
			width: 20,
			height: 20,
			images: new Map([[src, bytes]]),
		});
		renderer.dispose();
		return frame.warnings;
	};

	it("paints a BMP", async () => {
		const bytes = fixture("small.bmp");
		expect(parseImageInfo(bytes)).toEqual({
			contentType: "image/bmp",
			width: 8,
			height: 4,
		});
		expect(await warnings("small.bmp", bytes)).toEqual([]);
		expect(await warnings("small.bmp", bytes, 8)).toMatchObject([
			{ kind: "image_load_failed" },
		]);
	});

	it("paints an ICO and a CUR holding a BMP", async () => {
		const file = fixture("small.bmp");
		// An icon's BMP has no file header, twice the height and an AND mask.
		const data = new Uint8Array(file.length - 14 + 16);
		data.set(file.subarray(14));
		new DataView(data.buffer).setInt32(8, 4 * 2, true);
		for (const type of [1, 2]) {
			const bytes = ico([{ w: 8, h: 4, data }], type);
			expect(parseImageInfo(bytes)).toMatchObject({ width: 8, height: 4 });
			expect(ck.MakeImageFromEncoded(bytes)).not.toBeNull();
			expect(await warnings("small.ico", bytes)).toEqual([]);
		}
	});

	it("reads a real AVIF header, which this CanvasKit build cannot decode", async () => {
		const bytes = fixture("small.avif");
		expect(parseImageInfo(bytes)).toEqual({
			contentType: "image/avif",
			width: 8,
			height: 4,
		});
		expect(() => assertDecodableImage(bytes)).not.toThrow();
		expect(ck.MakeImageFromEncoded(bytes)).toBeNull();
		expect(await warnings("small.avif", bytes)).toMatchObject([
			{ kind: "image_load_failed", src: "small.avif" },
		]);
	});
});
