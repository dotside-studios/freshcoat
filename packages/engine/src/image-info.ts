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

/** Default most pixels an image may declare before it is decoded: a square at
 *  the export edge cap, 8192 by 8192. */
export const DEFAULT_MAX_IMAGE_DECODE_PIXELS = 8192 * 8192;

/** Throws unless the header of `bytes` names a PNG, JPEG, GIF or WebP of at
 *  most `maxPixels` pixels (default DEFAULT_MAX_IMAGE_DECODE_PIXELS). Meant to
 *  run before the bytes reach a decoder, which allocates what the header says. */
export function assertDecodableImage(
	bytes: Uint8Array,
	maxPixels = DEFAULT_MAX_IMAGE_DECODE_PIXELS,
): void {
	const info = parseImageInfo(bytes);
	if (!info) throw new Error("image size could not be read from its header");
	if (info.width * info.height > maxPixels)
		throw new Error(
			`image is ${info.width}x${info.height}, over the limit of ${maxPixels} pixels`,
		);
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

/** The media type of a PNG, JPEG, GIF, WebP or AVIF from its magic number. */
export function sniffImageType(b: Uint8Array): string | null {
	const at = (i: number, ...values: number[]) =>
		values.every((v, j) => b[i + j] === v);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
		return "image/webp";
	if (at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66))
		return "image/avif";
	return null;
}

/** The concatenated IDAT data of an 8-bit RGB PNG without transparency or
 *  interlacing, which a PDF can carry as is, or undefined for any other image. */
export function rgbIdat(
	bytes: Uint8Array,
): { width: number; height: number; data: Uint8Array } | undefined {
	const info = parseImageInfo(bytes);
	if (info?.contentType !== "image/png") return undefined;
	const { width, height } = info;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const parts: Uint8Array[] = [];
	let size = 0;
	for (let at = 8; at + 8 <= bytes.length; ) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		const start = at + 8;
		const end = start + length;
		if (end + 4 > bytes.length) return undefined;
		if (type === "IHDR") {
			if (length < 13) return undefined;
			const [depth, colour, compression, filter, interlace] = bytes.subarray(
				start + 8,
				start + 13,
			);
			if (
				depth !== 8 ||
				colour !== 2 ||
				compression !== 0 ||
				filter !== 0 ||
				interlace !== 0
			)
				return undefined;
		} else if (type === "IDAT") {
			parts.push(bytes.subarray(start, end));
			size += length;
		} else if (type === "tRNS" || type === "acTL") {
			return undefined;
		} else if (type === "IEND") {
			break;
		}
		at = end + 4;
	}
	if (!(width > 0 && height > 0) || parts.length === 0) return undefined;
	if (parts.length === 1) return { width, height, data: parts[0] };
	const data = new Uint8Array(size);
	let at = 0;
	for (const part of parts) {
		data.set(part, at);
		at += part.length;
	}
	return { width, height, data };
}

/** The size and component count of a baseline or progressive JPEG, the
 *  frames a PDF can carry as DCTDecode, or null for any other. */
export function jpegFrame(
	b: Uint8Array,
): { width: number; height: number; components: number } | null {
	if (b[0] !== 0xff || b[1] !== 0xd8) return null;
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) return null;
		const marker = b[i + 1] as number;
		if (
			marker === 0xd8 ||
			(marker >= 0xd0 && marker <= 0xd7) ||
			marker === 0x01
		) {
			i += 2;
			continue;
		}
		const length = ((b[i + 2] as number) << 8) | (b[i + 3] as number);
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			if (marker !== 0xc0 && marker !== 0xc1 && marker !== 0xc2) return null;
			return {
				height: ((b[i + 5] as number) << 8) | (b[i + 6] as number),
				width: ((b[i + 7] as number) << 8) | (b[i + 8] as number),
				components: b[i + 9] as number,
			};
		}
		i += 2 + length;
	}
	return null;
}

/** The ICC profile a JPEG embeds in its APP2 ICC_PROFILE segments, joined in
 *  sequence order. "none" when it carries no profile, "invalid" when a segment
 *  is truncated, missing, repeated or disagrees on how many there are. */
export function jpegIccProfile(b: Uint8Array): Uint8Array | "none" | "invalid" {
	if (sniffImageType(b) !== "image/jpeg") return "none";
	const chunks: Uint8Array[] = [];
	let count = 0;
	let i = 2;
	for (;;) {
		while (i < b.length && b[i] !== 0xff) i++;
		while (i < b.length && b[i] === 0xff) i++;
		if (i >= b.length) break;
		const marker = b[i] as number;
		i++;
		if (
			marker === 0xd8 ||
			marker === 0x01 ||
			(marker >= 0xd0 && marker <= 0xd7)
		)
			continue;
		if (marker === 0xd9 || marker === 0xda) break;
		if (i + 2 > b.length) break;
		const end = i + u16be(b, i);
		if (marker === 0xe2 && ascii(b, i + 2, 12) === "ICC_PROFILE\0") {
			if (end > b.length || end < i + 16) return "invalid";
			const seq = b[i + 14] as number;
			const total = b[i + 15] as number;
			if (count === 0) count = total;
			if (total !== count || seq < 1 || seq > count || chunks[seq - 1])
				return "invalid";
			chunks[seq - 1] = b.subarray(i + 16, end);
		}
		i = end;
	}
	if (count === 0) return "none";
	let size = 0;
	for (let n = 0; n < count; n++) {
		const chunk = chunks[n];
		if (!chunk) return "invalid";
		size += chunk.length;
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

/** How many components an ICC profile's colour space has: 1 for gray, 3 for
 *  RGB, 4 for CMYK, or null when the header is not a profile's or names
 *  another space. */
export function iccComponents(profile: Uint8Array): number | null {
	if (profile.length < 128 || u32be(profile, 0) !== profile.length) return null;
	if (ascii(profile, 36, 4) !== "acsp") return null;
	switch (ascii(profile, 16, 4)) {
		case "GRAY":
			return 1;
		case "RGB ":
			return 3;
		case "CMYK":
			return 4;
		default:
			return null;
	}
}

function parse(b: Uint8Array): Parsed {
	if (b.length < 4) return b.length === 0 ? null : "more";
	if (b.length < 12 && ascii(b, 0, 4) === "RIFF") return "more";
	switch (sniffImageType(b)) {
		case "image/jpeg":
			return parseJpeg(b);
		case "image/png":
			return parsePng(b);
		case "image/gif":
			return parseGif(b);
		case "image/webp":
			return parseWebp(b);
		default:
			return null;
	}
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
