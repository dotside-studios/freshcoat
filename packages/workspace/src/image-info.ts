// An image's size, EXIF orientation and capture time, read from its header
// without decoding it. Only the first few kilobytes of a file are read, more
// only when a JPEG's frame header sits behind large metadata segments.

export type ImageInfo = {
	contentType: string;
	/** pixels as stored, before any EXIF orientation is applied */
	width: number;
	height: number;
	/** EXIF orientation 1..8, JPEG only, and only when the file says */
	orientation?: number;
	/** EXIF DateTimeOriginal as a local ISO date-time, "2024-05-01T13:22:10" */
	takenAt?: string;
};

/** What a parser says about a buffer: the answer, not an image it knows, or
 *  that the answer lies past the end of what it was given. */
type Parsed = ImageInfo | null | "more";

const FIRST_READ = 64 * 1024;

/** The header facts of an image Blob, or null for anything this does not
 *  recognise as a PNG, JPEG, GIF or WebP. */
export async function readImageInfo(blob: Blob): Promise<ImageInfo | null> {
	let length = Math.min(blob.size, FIRST_READ);
	for (;;) {
		const bytes = new Uint8Array(await blob.slice(0, length).arrayBuffer());
		const parsed = parse(bytes);
		if (parsed !== "more") return parsed;
		if (length >= blob.size) return null;
		length = Math.min(blob.size, length * 4);
	}
}

/** The header facts of an image held in memory. */
export function parseImageInfo(bytes: Uint8Array): ImageInfo | null {
	const parsed = parse(bytes);
	return parsed === "more" ? null : parsed;
}

/** Width and height as the image is meant to be seen: EXIF orientations 5 to
 *  8 turn it a quarter, so they swap. */
export function orientedSize(info: {
	width: number;
	height: number;
	orientation?: number;
}): { width: number; height: number } {
	return (info.orientation ?? 1) >= 5
		? { width: info.height, height: info.width }
		: { width: info.width, height: info.height };
}

function parse(b: Uint8Array): Parsed {
	if (b.length < 4) return b.length === 0 ? null : "more";
	if (b[0] === 0xff && b[1] === 0xd8) return parseJpeg(b);
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
		return parsePng(b);
	if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
		return parseGif(b);
	if (ascii(b, 0, 4) === "RIFF") {
		if (b.length < 12) return "more";
		if (ascii(b, 8, 4) === "WEBP") return parseWebp(b);
	}
	return null;
}

function ascii(b: Uint8Array, at: number, length: number): string {
	let out = "";
	for (let i = at; i < at + length && i < b.length; i++)
		out += String.fromCharCode(b[i] as number);
	return out;
}

const u16be = (b: Uint8Array, i: number) =>
	((b[i] as number) << 8) | (b[i + 1] as number);
const u16le = (b: Uint8Array, i: number) =>
	(b[i] as number) | ((b[i + 1] as number) << 8);
const u24le = (b: Uint8Array, i: number) =>
	u16le(b, i) | ((b[i + 2] as number) << 16);
const u32be = (b: Uint8Array, i: number) =>
	((b[i] as number) * 0x1000000 +
		(((b[i + 1] as number) << 16) |
			((b[i + 2] as number) << 8) |
			(b[i + 3] as number))) >>>
	0;

function parsePng(b: Uint8Array): Parsed {
	if (b.length < 24) return "more";
	if (ascii(b, 12, 4) !== "IHDR") return null;
	return {
		contentType: "image/png",
		width: u32be(b, 16),
		height: u32be(b, 20),
	};
}

function parseGif(b: Uint8Array): Parsed {
	if (b.length < 10) return "more";
	return { contentType: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
}

function parseWebp(b: Uint8Array): Parsed {
	if (b.length < 25) return "more";
	const chunk = ascii(b, 12, 4);
	const webp = (width: number, height: number): ImageInfo => ({
		contentType: "image/webp",
		width,
		height,
	});
	if (chunk === "VP8 ") {
		if (b.length < 30) return "more";
		// A key frame: three tag bytes, the start code, then 14-bit sizes.
		if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
		return webp(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
	}
	if (chunk === "VP8L") {
		if (b[20] !== 0x2f) return null;
		const bits =
			((b[21] as number) |
				((b[22] as number) << 8) |
				((b[23] as number) << 16) |
				((b[24] as number) << 24)) >>>
			0;
		return webp((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}
	if (chunk === "VP8X")
		return b.length < 30 ? "more" : webp(u24le(b, 24) + 1, u24le(b, 27) + 1);
	return null;
}

function isSof(marker: number): boolean {
	return (
		marker >= 0xc0 &&
		marker <= 0xcf &&
		marker !== 0xc4 &&
		marker !== 0xc8 &&
		marker !== 0xcc
	);
}

function parseJpeg(b: Uint8Array): Parsed {
	let exif: { orientation?: number; takenAt?: string } = {};
	let i = 2;
	for (;;) {
		// Markers may be padded with any number of 0xff fill bytes.
		while (i < b.length && b[i] !== 0xff) i++;
		while (i < b.length && b[i] === 0xff) i++;
		if (i >= b.length) return "more";
		const marker = b[i] as number;
		i++;
		if (
			marker === 0xd8 ||
			marker === 0x01 ||
			(marker >= 0xd0 && marker <= 0xd7)
		)
			continue;
		// The image data starts, or the file ends, before a frame header.
		if (marker === 0xd9 || marker === 0xda) return null;
		if (i + 2 > b.length) return "more";
		const length = u16be(b, i);
		const end = i + length;
		if (isSof(marker)) {
			if (i + 7 > b.length) return "more";
			const info: ImageInfo = {
				contentType: "image/jpeg",
				width: u16be(b, i + 5),
				height: u16be(b, i + 3),
			};
			if (exif.orientation !== undefined) info.orientation = exif.orientation;
			if (exif.takenAt !== undefined) info.takenAt = exif.takenAt;
			return info;
		}
		if (marker === 0xe1 && ascii(b, i + 2, 6) === "Exif\0\0") {
			if (end > b.length) return "more";
			exif = readExif(b.subarray(i + 8, end));
		}
		i = end;
	}
}

/** Orientation and DateTimeOriginal from a TIFF structure, in either byte
 *  order. Anything malformed is ignored rather than failing the header. */
function readExif(t: Uint8Array): { orientation?: number; takenAt?: string } {
	const out: { orientation?: number; takenAt?: string } = {};
	if (t.length < 8) return out;
	const little = t[0] === 0x49 && t[1] === 0x49;
	if (!little && !(t[0] === 0x4d && t[1] === 0x4d)) return out;
	const u16 = (i: number) =>
		i + 2 <= t.length ? (little ? u16le(t, i) : u16be(t, i)) : -1;
	const u32 = (i: number) =>
		i + 4 <= t.length
			? little
				? (u16le(t, i) | (u16le(t, i + 2) << 16)) >>> 0
				: u32be(t, i)
			: -1;
	if (u16(2) !== 42) return out;

	const entries = (ifd: number, visit: (tag: number, at: number) => void) => {
		const count = u16(ifd);
		if (count < 0) return;
		for (let n = 0; n < count; n++) {
			const at = ifd + 2 + n * 12;
			if (at + 12 > t.length) return;
			visit(u16(at), at);
		}
	};

	let exifIfd = -1;
	entries(u32(4), (tag, at) => {
		if (tag === 0x0112) {
			const value = u16(at + 8);
			if (value >= 1 && value <= 8) out.orientation = value;
		} else if (tag === 0x8769) {
			exifIfd = u32(at + 8);
		}
	});
	if (exifIfd > 0) {
		entries(exifIfd, (tag, at) => {
			if (tag !== 0x9003) return;
			const count = u32(at + 4);
			const offset = count > 4 ? u32(at + 8) : at + 8;
			const text = ascii(t, offset, Math.min(count, 19));
			const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
			if (m && m[1] !== "0000")
				out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
		});
	}
	return out;
}
