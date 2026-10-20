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
 *  recognise as a PNG, JPEG, GIF, WebP, BMP, ICO, WBMP or AVIF. */
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

/** Throws unless the header of `bytes` names a PNG, JPEG, GIF, WebP, BMP, ICO,
 *  WBMP or AVIF of at most `maxPixels` pixels (default DEFAULT_MAX_IMAGE_DECODE_PIXELS). Meant to
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

/** The media type of a PNG, JPEG, GIF, WebP, BMP, ICO, WBMP or AVIF from its
 *  magic number. */
export function sniffImageType(b: Uint8Array): string | null {
	const at = (i: number, ...values: number[]) =>
		values.every((v, j) => b[i + j] === v);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
		return "image/webp";
	if (hasAvifBrand(b)) return "image/avif";
	if (at(0, 0x42, 0x4d) && bmpHeaderSize(b) !== null) return "image/bmp";
	if (icoCount(b) > 0) return "image/x-icon";
	if (wbmpHeader(b)) return "image/vnd.wap.wbmp";
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
	if (profile.length < 128 || u32be(profile, 0) !== profile.length)
		return null;
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
		case "image/bmp":
			return parseBmp(b);
		case "image/x-icon":
			return parseIco(b);
		case "image/vnd.wap.wbmp":
			return parseWbmp(b);
		case "image/avif":
			return parseAvif(b);
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
const u32le = (b: Uint8Array, i: number) =>
	(u16le(b, i) | (u16le(b, i + 2) << 16)) >>> 0;
const i32le = (b: Uint8Array, i: number) =>
	u16le(b, i) | (u16le(b, i + 2) << 16);
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

const BMP_HEADER_SIZES = [12, 40, 52, 56, 64, 108, 124];

function bmpHeaderSize(b: Uint8Array): number | null {
	if (b.length < 18) return null;
	const size = u32le(b, 14);
	return BMP_HEADER_SIZES.includes(size) ? size : null;
}

function parseBmp(b: Uint8Array): Parsed {
	const size = bmpHeaderSize(b);
	if (size === null) return null;
	let width: number;
	let height: number;
	if (size === 12) {
		if (b.length < 22) return "more";
		width = u16le(b, 18);
		height = u16le(b, 20);
	} else {
		if (b.length < 26) return "more";
		width = i32le(b, 18);
		// A negative height is a top-down bitmap.
		height = Math.abs(i32le(b, 22));
	}
	if (width <= 0 || height <= 0) return null;
	return { contentType: "image/bmp", width, height };
}

const ICO_MAX_ENTRIES = 256;

/** The entry count of an ICO or CUR directory, or 0 when `b` does not open
 *  like one. */
function icoCount(b: Uint8Array): number {
	if (b.length < 6 || b[0] !== 0 || b[1] !== 0 || b[3] !== 0) return 0;
	if (b[2] !== 1 && b[2] !== 2) return 0;
	const count = u16le(b, 4);
	if (count < 1 || count > ICO_MAX_ENTRIES) return 0;
	if (b.length >= 22) {
		if (b[9] !== 0 || u32le(b, 18) < 6 + 16 * count) return 0;
	}
	return count;
}

function parseIco(b: Uint8Array): Parsed {
	const count = icoCount(b);
	const dirEnd = 6 + 16 * count;
	if (count === 0) return null;
	if (b.length < dirEnd) return "more";
	let best = { width: 0, height: 0 };
	for (let n = 0; n < count; n++) {
		const at = 6 + 16 * n;
		if (b[at + 3] !== 0) return null;
		const size = u32le(b, at + 8);
		const offset = u32le(b, at + 12);
		if (size === 0 || offset < dirEnd) return null;
		let width = b[at] || 256;
		let height = b[at + 1] || 256;
		// An entry holds either a BMP without its file header or a whole PNG.
		if (offset + 8 > b.length) return "more";
		if (at32(b, offset) === PNG_SIGNATURE) {
			if (size < 24) return null;
			if (offset + 24 > b.length) return "more";
			if (ascii(b, offset + 12, 4) !== "IHDR") return null;
			width = u32be(b, offset + 16);
			height = u32be(b, offset + 20);
		}
		if (width * height > best.width * best.height) best = { width, height };
	}
	if (best.width <= 0 || best.height <= 0) return null;
	return { contentType: "image/x-icon", ...best };
}

const PNG_SIGNATURE = "\x89PNG\r\n\x1a\n";
const at32 = (b: Uint8Array, i: number) => ascii(b, i, 8);

/** The size in a WBMP header: two zero bytes, then width and height as
 *  multi-byte integers of 7 bits per byte. */
function wbmpHeader(b: Uint8Array): { width: number; height: number } | null {
	if (b.length < 4 || b[0] !== 0 || b[1] !== 0) return null;
	const sizes: number[] = [];
	let at = 2;
	for (let k = 0; k < 2; k++) {
		let value = 0;
		for (let n = 0; ; n++) {
			if (at >= b.length || n === 3) return null;
			const byte = b[at++] as number;
			value = value * 128 + (byte & 0x7f);
			if (!(byte & 0x80)) break;
		}
		if (value < 1 || value > 0xffff) return null;
		sizes.push(value);
	}
	return { width: sizes[0] as number, height: sizes[1] as number };
}

function parseWbmp(b: Uint8Array): Parsed {
	const size = wbmpHeader(b);
	return size && { contentType: "image/vnd.wap.wbmp", ...size };
}

/** Whether the ftyp box names avif or avis as its major or a compatible brand. */
function hasAvifBrand(b: Uint8Array): boolean {
	if (b.length < 12 || ascii(b, 4, 4) !== "ftyp") return false;
	const isAvif = (i: number) => {
		const brand = ascii(b, i, 4);
		return brand === "avif" || brand === "avis";
	};
	if (isAvif(8)) return true;
	const end = Math.min(u32be(b, 0), b.length, 512);
	for (let i = 16; i + 4 <= end; i += 4) if (isAvif(i)) return true;
	return false;
}

const AVIF_MAX_BOXES = 1024;

type IsoBox = { type: string; body: number; end: number };

/** The boxes in b[start, end). `open` when `end` is only where the buffer
 *  stops, so a box running past it is a truncation, not a malformed file.
 *  null when a size is below its header, past a closed `end`, or the shared
 *  box budget is spent. */
function isoBoxes(
	b: Uint8Array,
	start: number,
	end: number,
	open: boolean,
	budget: { left: number },
): { boxes: IsoBox[]; more: boolean } | null {
	const boxes: IsoBox[] = [];
	const cut = open ? { boxes, more: true } : null;
	for (let at = start; at < end; ) {
		if (--budget.left < 0) return null;
		if (at + 8 > end) return cut;
		let size = u32be(b, at);
		let head = 8;
		if (size === 1) {
			if (at + 16 > end) return cut;
			size = u32be(b, at + 8) * 0x100000000 + u32be(b, at + 12);
			head = 16;
		} else if (size === 0) {
			size = end - at;
		}
		if (size < head) return null;
		if (at + size > end) return cut;
		boxes.push({ type: ascii(b, at + 4, 4), body: at + head, end: at + size });
		at += size;
	}
	return { boxes, more: false };
}

type AvifScan = {
	budget: { left: number };
	more: boolean;
	found: boolean;
	primary?: number;
	props: ({ width: number; height: number } | null)[];
	hasProps: boolean;
	associations: Map<number, number[]>;
};

/** Walks to the item properties. Only meta, iprp and ipco are entered, one
 *  level each, so the depth is at most three; the box budget bounds the rest.
 *  False when the file is malformed. */
function scanAvif(
	b: Uint8Array,
	start: number,
	end: number,
	parent: "" | "meta" | "iprp" | "ipco",
	st: AvifScan,
): boolean {
	const list = isoBoxes(b, start, end, parent === "", st.budget);
	if (!list) return false;
	if (list.more) st.more = true;
	for (const box of list.boxes) {
		const { body } = box;
		if (parent === "") {
			// meta is a FullBox: version and flags come before its children.
			if (box.type === "meta" && !st.found) {
				st.found = true;
				if (body + 4 > box.end || !scanAvif(b, body + 4, box.end, "meta", st))
					return false;
			}
		} else if (parent === "meta") {
			if (box.type === "pitm" && body + 6 <= box.end) {
				st.primary = b[body] === 0 ? u16be(b, body + 4) : u32be(b, body + 4);
			} else if (box.type === "iprp") {
				if (!scanAvif(b, body, box.end, "iprp", st)) return false;
			}
		} else if (parent === "iprp") {
			if (box.type === "ipco" && !st.hasProps) {
				st.hasProps = true;
				if (!scanAvif(b, body, box.end, "ipco", st)) return false;
			} else if (box.type === "ipma") {
				readIpma(b, box, st.associations);
			}
		} else if (box.type === "ispe" && body + 12 <= box.end) {
			const width = u32be(b, body + 4);
			const height = u32be(b, body + 8);
			st.props.push(width > 0 && height > 0 ? { width, height } : null);
		} else {
			st.props.push(null);
		}
	}
	return true;
}

/** The property indices each item is associated with, first entry per item. */
function readIpma(
	b: Uint8Array,
	box: IsoBox,
	out: Map<number, number[]>,
): void {
	const { body, end } = box;
	if (body + 8 > end) return;
	const wide = (b[body + 3] as number) & 1;
	const idSize = b[body] === 0 ? 2 : 4;
	const count = Math.min(u32be(b, body + 4), AVIF_MAX_BOXES);
	let at = body + 8;
	for (let n = 0; n < count && at + idSize + 1 <= end; n++) {
		const id = idSize === 2 ? u16be(b, at) : u32be(b, at);
		const links = b[at + idSize] as number;
		at += idSize + 1;
		if (at + links * (1 + wide) > end) return;
		const indices: number[] = [];
		for (let k = 0; k < links; k++, at += 1 + wide)
			indices.push(wide ? u16be(b, at) & 0x7fff : (b[at] as number) & 0x7f);
		if (!out.has(id)) out.set(id, indices);
	}
}

function parseAvif(b: Uint8Array): Parsed {
	const st: AvifScan = {
		budget: { left: AVIF_MAX_BOXES },
		more: false,
		found: false,
		props: [],
		hasProps: false,
		associations: new Map(),
	};
	if (!scanAvif(b, 0, b.length, "", st)) return null;
	if (!st.found) return st.more ? "more" : null;
	// The primary item (pitm) names its properties through ipma, and its ispe
	// is the image's size. When that cannot be resolved, the largest ispe is
	// used, which is the full image rather than a thumbnail or tile.
	let size: { width: number; height: number } | null | undefined;
	const linked =
		st.primary === undefined ? undefined : st.associations.get(st.primary);
	for (const index of linked ?? []) {
		size = st.props[index - 1];
		if (size) break;
	}
	if (!size) {
		for (const p of st.props)
			if (p && (!size || p.width * p.height > size.width * size.height))
				size = p;
	}
	return size ? { contentType: "image/avif", ...size } : null;
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
