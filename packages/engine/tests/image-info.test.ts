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
	orientedSize,
	parseImageInfo,
	readImageInfo,
	sniffImageType,
} from "../src/image-info";

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

describe("sniffImageType", () => {
	it("knows AVIF by its ftyp brand", () => {
		const avif = Uint8Array.from([
			0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
		]);
		expect(sniffImageType(avif)).toBe("image/avif");
		expect(parseImageInfo(avif)).toBeNull();
	});
});
