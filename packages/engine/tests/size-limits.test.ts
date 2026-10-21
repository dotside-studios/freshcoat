// Untrusted bytes are checked against size limits before they are decoded: an
// image's declared pixels, and the sizes a WOFF or WOFF2 file says it unpacks to.
import { loadCanvasKit, testFontBytes } from "@freshcoat-js/test-utils";
import { compress } from "brotli/compress";
import { zlibSync } from "fflate";
import { beforeAll, describe, expect, test } from "vitest";
import { decodePixels } from "../src/decode";
import {
	assertDecodableImage,
	DEFAULT_MAX_IMAGE_DECODE_PIXELS,
} from "../src/image-info";
import { createFrame, createImage } from "../src/node";
import { createRenderer } from "../src/renderer";
import { MAX_UNPACKED_FONT_BYTES, sfntBytes } from "../src/woff";

let ck: any;
beforeAll(async () => {
	ck = await loadCanvasKit();
});

function pngHeader(width: number, height: number): Uint8Array {
	const b = new Uint8Array(33);
	const dv = new DataView(b.buffer);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	dv.setUint32(8, 13);
	b.set(new TextEncoder().encode("IHDR"), 12);
	dv.setUint32(16, width);
	dv.setUint32(20, height);
	b.set([8, 6, 0, 0, 0], 24);
	return b;
}

function smallPng(): Uint8Array {
	const image = ck.MakeImage(
		{
			width: 2,
			height: 2,
			alphaType: ck.AlphaType.Unpremul,
			colorType: ck.ColorType.RGBA_8888,
			colorSpace: ck.ColorSpace.SRGB,
		},
		new Uint8Array(16).fill(255),
		8,
	);
	const bytes = image.encodeToBytes() as Uint8Array;
	image.delete();
	return bytes;
}

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

describe("image pixel limit", () => {
	test("the default admits 100+ MP camera files", () => {
		expect(DEFAULT_MAX_IMAGE_DECODE_PIXELS).toBe(200_000_000);
	});

	test("a tiny PNG declaring 30000x30000 is refused with a warning", async () => {
		const huge = pngHeader(30000, 30000);
		const renderer = await createRenderer({ ck });
		const frame = await renderer.render(scene("huge.png"), {
			width: 20,
			height: 20,
			images: new Map([["huge.png", huge]]),
		});
		expect(frame.bytes.length).toBeGreaterThan(0);
		expect(frame.warnings).toHaveLength(1);
		expect(frame.warnings[0]).toMatchObject({
			kind: "image_load_failed",
			src: "huge.png",
		});
		expect((frame.warnings[0] as { error: string }).error).toContain(
			"30000x30000",
		);
		renderer.dispose();
	});

	test("an image under the limit still paints", async () => {
		const renderer = await createRenderer({ ck });
		const frame = await renderer.render(scene("ok.png"), {
			width: 20,
			height: 20,
			images: new Map([["ok.png", smallPng()]]),
		});
		expect(frame.warnings).toEqual([]);
		renderer.dispose();
	});

	test("the limit is configurable on the renderer", async () => {
		const renderer = await createRenderer({ ck, maxImageDecodePixels: 3 });
		const frame = await renderer.render(scene("ok.png"), {
			width: 20,
			height: 20,
			images: new Map([["ok.png", smallPng()]]),
		});
		expect(frame.warnings).toMatchObject([
			{ kind: "image_load_failed", src: "ok.png" },
		]);
		renderer.dispose();
	});

	test("a header that cannot be read is refused", async () => {
		const renderer = await createRenderer({ ck });
		for (const [src, bytes] of [
			["garbage.png", new Uint8Array(64).fill(7)],
			["truncated.png", smallPng().slice(0, 16)],
		] as const) {
			const frame = await renderer.render(scene(src), {
				width: 20,
				height: 20,
				images: new Map([[src, bytes]]),
			});
			expect(frame.warnings).toMatchObject([
				{ kind: "image_load_failed", src },
			]);
			expect((frame.warnings[0] as { error: string }).error).toContain(
				"header",
			);
		}
		renderer.dispose();
	});

	test("decodePixels checks before decoding", () => {
		expect(() => decodePixels(ck, pngHeader(30000, 30000))).toThrow(
			/30000x30000/,
		);
		expect(() => decodePixels(ck, new Uint8Array(8))).toThrow(/header/);
		expect(decodePixels(ck, smallPng())?.width).toBe(2);
		expect(() => assertDecodableImage(smallPng(), 3)).toThrow();
	});
});

const vend = testFontBytes("VendSans-Variable-latin.woff2");

type Table = { tag: string; stored: Uint8Array; origLength: number };

function woff1(tables: Table[]): Uint8Array {
	let size = 44 + 20 * tables.length;
	const starts = tables.map((t) => {
		const at = size;
		size += (t.stored.length + 3) & ~3;
		return at;
	});
	const out = new Uint8Array(size);
	const dv = new DataView(out.buffer);
	out.set(new TextEncoder().encode("wOFF"));
	dv.setUint32(4, 0x00010000);
	dv.setUint32(8, size);
	dv.setUint16(12, tables.length);
	tables.forEach((t, i) => {
		const o = 44 + 20 * i;
		out.set(new TextEncoder().encode(t.tag), o);
		dv.setUint32(o + 4, starts[i] as number);
		dv.setUint32(o + 8, t.stored.length);
		dv.setUint32(o + 12, t.origLength);
		out.set(t.stored, starts[i]);
	});
	return out;
}

describe("WOFF unpacked size limits", () => {
	const real = new Uint8Array(4000).fill(9);
	const packed = zlibSync(real);

	test("a table that inflates to its declared length unpacks", () => {
		const font = woff1([{ tag: "head", stored: packed, origLength: 4000 }]);
		expect(sfntBytes(font).length).toBeGreaterThan(4000);
	});

	test("an origLength smaller than the inflated data is rejected", () => {
		const font = woff1([{ tag: "name", stored: packed, origLength: 3999 }]);
		expect(() => sfntBytes(font)).toThrow();
		const tiny = woff1([
			{ tag: "name", stored: packed, origLength: packed.length + 1 },
		]);
		expect(() => sfntBytes(tiny)).toThrow();
	});

	test("an origLength above the cap is rejected without allocating it", () => {
		const font = woff1([
			{ tag: "name", stored: packed, origLength: MAX_UNPACKED_FONT_BYTES + 1 },
		]);
		expect(() => sfntBytes(font)).toThrow(/too large/);
		const huge = woff1([
			{ tag: "name", stored: packed, origLength: 0xffffffff },
		]);
		expect(() => sfntBytes(huge)).toThrow(/too large/);
	});

	test("the total across tables is capped", () => {
		const half = Math.floor(MAX_UNPACKED_FONT_BYTES / 2) + 1;
		const font = woff1([
			{ tag: "name", stored: packed, origLength: half },
			{ tag: "post", stored: packed, origLength: half },
		]);
		expect(() => sfntBytes(font)).toThrow();
	});
});

function base128(n: number): number[] {
	const out = [n & 0x7f];
	for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128))
		out.unshift((v & 0x7f) | 0x80);
	return out;
}

describe("WOFF2 unpacked size limits", () => {
	const real = new Uint8Array(100).fill(5);
	let stream: Uint8Array;
	beforeAll(async () => {
		stream = (await compress(real)) as Uint8Array;
	});

	test("the real file unpacks", () => {
		expect(sfntBytes(vend).length).toBeGreaterThan(1000);
	});

	test("a table length above the cap is rejected", () => {
		const out = woff2Single(
			MAX_UNPACKED_FONT_BYTES + 1,
			MAX_UNPACKED_FONT_BYTES + 1,
			stream,
		);
		expect(() => sfntBytes(out)).toThrow(/too large/);
	});

	test("the sum of the tables is capped", () => {
		const half = Math.floor(MAX_UNPACKED_FONT_BYTES / 2) + 1;
		expect(() => sfntBytes(woff2Tables([half, half], stream))).toThrow(
			/too large/,
		);
	});

	test("declared sizes larger than the stream are rejected", () => {
		expect(() => sfntBytes(woff2Single(200, 200, stream))).toThrow();
	});

	test("declared sizes smaller than the stream are rejected", () => {
		expect(() => sfntBytes(woff2Single(50, 50, stream))).toThrow();
	});
});

function woff2Tables(lengths: number[], payload: Uint8Array): Uint8Array {
	const entries = lengths.flatMap((n, i) => [
		0x3f,
		...new TextEncoder().encode(`TS${String.fromCharCode(65 + i)}_`),
		...base128(n),
	]);
	const out = new Uint8Array(48 + entries.length + payload.length);
	const dv = new DataView(out.buffer);
	out.set(new TextEncoder().encode("wOF2"));
	dv.setUint32(4, 0x00010000);
	dv.setUint16(12, lengths.length);
	dv.setUint32(20, payload.length);
	out.set(entries, 48);
	out.set(payload, 48 + entries.length);
	return out;
}

const woff2Single = (
	origLength: number,
	_length: number,
	payload: Uint8Array,
) => woff2Tables([origLength], payload);
