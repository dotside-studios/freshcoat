import {
	gifHeader,
	jpegHeader,
	pngHeader,
	webpVp8,
	webpVp8l,
	webpVp8x,
} from "@freshcoat-js/test-utils";
import { describe, expect, it } from "vitest";
import {
	iccComponents,
	jpegIccProfile,
	orientedSize,
	parseImageInfo,
	readImageInfo,
	rgbIdat,
	sniffImageType,
} from "../src/image-info";
import { encodePng } from "../src/png";

const blob = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);

describe("image-info", () => {
	it("reads PNG, GIF and every WebP flavour", async () => {
		expect(parseImageInfo(pngHeader(4000, 3000))).toEqual({
			contentType: "image/png",
			width: 4000,
			height: 3000,
		});
		expect(await readImageInfo(blob(pngHeader(2, 2)))).toMatchObject({
			contentType: "image/png",
		});
		expect(parseImageInfo(gifHeader(320, 200))).toEqual({
			contentType: "image/gif",
			width: 320,
			height: 200,
		});
		for (const [make, w, h] of [
			[webpVp8, 1024, 768],
			[webpVp8l, 16383, 1],
			[webpVp8x, 16384, 9000],
		] as const) {
			expect(await readImageInfo(blob(make(w, h)))).toEqual({
				contentType: "image/webp",
				width: w,
				height: h,
			});
		}
	});

	it("reads a JPEG's size from every kind of frame header", () => {
		for (const sof of [
			0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
			0xcf,
		]) {
			expect(
				parseImageInfo(jpegHeader({ width: 640, height: 480, sof })),
			).toEqual({ contentType: "image/jpeg", width: 640, height: 480 });
		}
	});

	it("reads all eight orientations in both byte orders", () => {
		for (const littleEndian of [true, false]) {
			for (let orientation = 1; orientation <= 8; orientation++) {
				const info = parseImageInfo(
					jpegHeader({ width: 60, height: 40, orientation, littleEndian }),
				);
				expect(info).toEqual({
					contentType: "image/jpeg",
					width: 60,
					height: 40,
					orientation,
				});
				expect(orientedSize(info as NonNullable<typeof info>)).toEqual(
					orientation >= 5
						? { width: 40, height: 60 }
						: { width: 60, height: 40 },
				);
			}
		}
	});

	it("reads DateTimeOriginal in both byte orders", () => {
		for (const littleEndian of [true, false]) {
			expect(
				parseImageInfo(
					jpegHeader({
						width: 8,
						height: 8,
						orientation: 6,
						dateTimeOriginal: "2024:05:01 13:22:10",
						littleEndian,
					}),
				),
			).toEqual({
				contentType: "image/jpeg",
				width: 8,
				height: 8,
				orientation: 6,
				takenAt: "2024-05-01T13:22:10",
			});
		}
		// Cameras write zeros when the clock was never set.
		expect(
			parseImageInfo(
				jpegHeader({
					width: 8,
					height: 8,
					dateTimeOriginal: "0000:00:00 00:00:00",
				}),
			)?.takenAt,
		).toBeUndefined();
	});

	it("reads further into a Blob when the frame header is far in", async () => {
		const bytes = jpegHeader({
			width: 6000,
			height: 4000,
			orientation: 8,
			padding: 300_000,
		});
		expect(parseImageInfo(bytes.subarray(0, 64 * 1024))).toBeNull();
		expect(await readImageInfo(blob(bytes))).toEqual({
			contentType: "image/jpeg",
			width: 6000,
			height: 4000,
			orientation: 8,
		});
	});

	it("says null for what it does not know or cannot finish", async () => {
		expect(parseImageInfo(new TextEncoder().encode("hello there"))).toBeNull();
		expect(parseImageInfo(new Uint8Array())).toBeNull();
		expect(await readImageInfo(new Blob([]))).toBeNull();
		const truncated = jpegHeader({ width: 5, height: 5 }).subarray(0, 24);
		expect(await readImageInfo(blob(truncated))).toBeNull();
		// A JPEG that reaches its scan without a frame header.
		expect(
			parseImageInfo(
				Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]),
			),
		).toBeNull();
	});
});

// A profile header of `size` bytes in colour space `space`, the rest a counter.
function profile(size: number, space = "RGB "): Uint8Array {
	const p = new Uint8Array(size);
	for (let i = 0; i < size; i++) p[i] = i & 0xff;
	new DataView(p.buffer).setUint32(0, size);
	p.set(new TextEncoder().encode(space), 16);
	p.set(new TextEncoder().encode("acsp"), 36);
	return p;
}

const app2 = (
	data: Uint8Array,
	seq: number,
	count: number,
	length?: number,
) => {
	const head = [...new TextEncoder().encode("ICC_PROFILE"), 0, seq, count];
	const len = length ?? 2 + head.length + data.length;
	return [0xff, 0xe2, len >> 8, len & 0xff, ...head, ...data];
};

const jpegWith = (...segments: number[][]) =>
	new Uint8Array([
		0xff,
		0xd8,
		...segments.flat(),
		0xff,
		0xc0,
		0,
		11,
		8,
		0,
		1,
		0,
		1,
		1,
		1,
		0x11,
		0,
		0xff,
		0xda,
	]);

describe("jpegIccProfile", () => {
	const icc = profile(300);

	it("joins a profile split across segments in sequence order", () => {
		const parts = [
			icc.subarray(0, 100),
			icc.subarray(100, 250),
			icc.subarray(250),
		];
		const out = jpegIccProfile(
			jpegWith(
				app2(parts[2], 3, 3),
				app2(parts[0], 1, 3),
				app2(parts[1], 2, 3),
			),
		);
		expect(out).toEqual(icc);
		expect(iccComponents(out as Uint8Array)).toBe(3);
		expect(jpegIccProfile(jpegWith(app2(icc, 1, 1)))).toEqual(icc);
	});

	it("says none for a JPEG without one, or a profile after the scan", () => {
		expect(jpegIccProfile(jpegHeader({ width: 4, height: 4 }))).toBe("none");
		const late = new Uint8Array([...jpegWith(), ...app2(icc, 1, 1)]);
		expect(jpegIccProfile(late)).toBe("none");
		expect(jpegIccProfile(pngHeader(2, 2))).toBe("none");
	});

	it("rejects missing, repeated, truncated and inconsistent segments", () => {
		const a = icc.subarray(0, 150);
		const b = icc.subarray(150);
		for (const bytes of [
			jpegWith(app2(a, 1, 2)),
			jpegWith(app2(a, 1, 2), app2(a, 1, 2)),
			jpegWith(app2(a, 1, 2), app2(b, 2, 3)),
			jpegWith(app2(a, 0, 2), app2(b, 2, 2)),
			jpegWith(app2(a, 3, 2), app2(b, 2, 2)),
			jpegWith(app2(icc, 1, 1, 15)),
			new Uint8Array([0xff, 0xd8, ...app2(icc, 1, 1)].slice(0, 200)),
		])
			expect(jpegIccProfile(bytes)).toBe("invalid");
	});
});

describe("iccComponents", () => {
	it("counts the components of the profile's colour space", () => {
		expect(iccComponents(profile(128, "GRAY"))).toBe(1);
		expect(iccComponents(profile(128, "RGB "))).toBe(3);
		expect(iccComponents(profile(128, "CMYK"))).toBe(4);
		expect(iccComponents(profile(128, "Lab "))).toBeNull();
	});

	it("rejects what is not a profile", () => {
		expect(iccComponents(profile(64))).toBeNull();
		expect(iccComponents(profile(300).subarray(0, 200))).toBeNull();
		const unsigned = profile(128);
		unsigned[36] = 0;
		expect(iccComponents(unsigned)).toBeNull();
	});
});

describe("sniffImageType", () => {
	it("knows AVIF by its ftyp brand", () => {
		const avif = Uint8Array.from([
			0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
		]);
		expect(sniffImageType(avif)).toBe("image/avif");
		expect(parseImageInfo(avif)).toBeNull();
	});
});

describe("rgbIdat", () => {
	it("passes through what encodePng writes for an opaque image", async () => {
		const pixels = new Uint8Array(3 * 2 * 4).fill(255);
		const idat = rgbIdat(await encodePng(pixels, 3, 2));
		expect(idat).toMatchObject({ width: 3, height: 2 });
		expect(idat?.data.length).toBeGreaterThan(0);
	});

	it("refuses a translucent image or another format", async () => {
		const pixels = new Uint8Array(3 * 2 * 4).fill(128);
		expect(rgbIdat(await encodePng(pixels, 3, 2))).toBeUndefined();
		expect(rgbIdat(gifHeader(3, 2))).toBeUndefined();
	});
});
