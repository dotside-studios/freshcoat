// Image headers built byte by byte: enough of each format for a header
// reader, not decodable images.

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
	const arrays = parts.map((p) =>
		p instanceof Uint8Array ? p : Uint8Array.from(p),
	);
	const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
	let at = 0;
	for (const a of arrays) {
		out.set(a, at);
		at += a.length;
	}
	return out;
}

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const be32 = (n: number) => [
	(n >>> 24) & 0xff,
	(n >>> 16) & 0xff,
	(n >>> 8) & 0xff,
	n & 0xff,
];
const le32 = (n: number) => be32(n).reverse();
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

function segment(marker: number, body: Uint8Array | number[]): Uint8Array {
	return concat([[0xff, marker, ...be16(body.length + 2)], body]);
}

/** A TIFF block with IFD0 holding an orientation and a pointer to an Exif
 *  IFD holding DateTimeOriginal. */
export function tiff(opts: {
	littleEndian: boolean;
	orientation?: number;
	dateTimeOriginal?: string;
}): Uint8Array {
	const u16 = opts.littleEndian ? le16 : be16;
	const u32 = opts.littleEndian ? le32 : be32;
	const ifd0: number[][] = [];
	if (opts.orientation !== undefined)
		ifd0.push([
			...u16(0x0112),
			...u16(3),
			...u32(1),
			...u16(opts.orientation),
			0,
			0,
		]);
	const hasDate = opts.dateTimeOriginal !== undefined;
	// header 8, IFD0 2 + 12n + 4, then the Exif IFD, then the date string.
	const ifd0Size = 2 + 12 * (ifd0.length + (hasDate ? 1 : 0)) + 4;
	const exifAt = 8 + ifd0Size;
	const exifSize = 2 + 12 + 4;
	const dateAt = exifAt + exifSize;
	if (hasDate)
		ifd0.push([...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt)]);
	const parts: number[][] = [
		opts.littleEndian ? text("II") : text("MM"),
		u16(42),
		u32(8),
		u16(ifd0.length),
		...ifd0,
		u32(0),
	];
	if (hasDate) {
		const date = [...text(opts.dateTimeOriginal as string), 0];
		parts.push(
			u16(1),
			[...u16(0x9003), ...u16(2), ...u32(date.length), ...u32(dateAt)],
			u32(0),
			date,
		);
	}
	return concat(parts);
}

export function jpegHeader(opts: {
	width: number;
	height: number;
	orientation?: number;
	dateTimeOriginal?: string;
	littleEndian?: boolean;
	/** the SOF marker, 0xc0 (baseline) by default */
	sof?: number;
	/** bytes of an APP2 segment placed before the frame header */
	padding?: number;
}): Uint8Array {
	const parts: Uint8Array[] = [
		Uint8Array.from([0xff, 0xd8]),
		segment(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
	];
	if (opts.orientation !== undefined || opts.dateTimeOriginal !== undefined)
		parts.push(
			segment(
				0xe1,
				concat([
					[...text("Exif"), 0, 0],
					tiff({
						littleEndian: opts.littleEndian ?? false,
						orientation: opts.orientation,
						dateTimeOriginal: opts.dateTimeOriginal,
					}),
				]),
			),
		);
	let padding = opts.padding ?? 0;
	while (padding > 0) {
		const n = Math.min(padding, 65000);
		parts.push(segment(0xe2, new Uint8Array(n)));
		padding -= n;
	}
	parts.push(
		segment(opts.sof ?? 0xc0, [
			8,
			...be16(opts.height),
			...be16(opts.width),
			3,
			1,
			0x22,
			0,
			2,
			0x11,
			1,
			3,
			0x11,
			1,
		]),
		Uint8Array.from([0xff, 0xda, 0, 2, 0xff, 0xd9]),
	);
	return concat(parts);
}

export function pngHeader(width: number, height: number): Uint8Array {
	return concat([
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		be32(13),
		text("IHDR"),
		be32(width),
		be32(height),
		[8, 6, 0, 0, 0],
		be32(0),
	]);
}

export function gifHeader(width: number, height: number): Uint8Array {
	return concat([text("GIF89a"), le16(width), le16(height), [0, 0, 0, 0x3b]]);
}

function riff(chunk: string, body: number[]): Uint8Array {
	const data = [...text(chunk), ...le32(body.length), ...body];
	return concat([text("RIFF"), le32(4 + data.length), text("WEBP"), data]);
}

export function webpVp8(width: number, height: number): Uint8Array {
	return riff("VP8 ", [
		0x10,
		0x02,
		0x00,
		0x9d,
		0x01,
		0x2a,
		...le16(width),
		...le16(height),
		0,
		0,
	]);
}

export function webpVp8l(width: number, height: number): Uint8Array {
	const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
	return riff("VP8L", [0x2f, ...le32(bits >>> 0), 0, 0, 0, 0]);
}

export function webpVp8x(width: number, height: number): Uint8Array {
	return riff("VP8X", [0x08, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
}
