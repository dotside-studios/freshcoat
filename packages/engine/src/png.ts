// PNG encoding from raw RGBA pixels — smaller output than the backend's own
// encoder, at no cost in fidelity (PNG is lossless; every candidate below is the
// same picture).
//
// Two levers, and which one wins depends entirely on the picture:
//   • the alpha channel — a frame that is fully opaque carries a byte per pixel
//     that says nothing, and dropping it can shrink a gradient by 5%;
//   • the scanline filter — a per-row transform that makes the bytes more
//     compressible, or less. Filtering is supposed to help; on flat colour and
//     smooth gradients it routinely costs 20–40% instead, because the raw rows
//     already compress as long runs and filtering turns them into noise.
//
// So "best" encodes the plausible candidates and keeps the smallest; "fast"
// encodes one. Deflate is the platform's own (CompressionStream), which keeps
// this dependency-free and identical in a browser and on a server.
import type { DecodedPixels } from "./decode";

export type PngEffort =
	// One deflate, unfiltered: RGB when the frame is opaque, RGBA otherwise.
	| "fast"
	// Both layouts, each unfiltered and filtered. Filtering pays on
	// photographic content, where a row genuinely predicts the next one; on flat
	// colour and gradients it costs 20–40%, so it is opt-in.
	| "best";

export type EncodePngOptions = {
	// Default "fast".
	effort?: PngEffort;
};

/**
 * What a render is encoded as.
 *
 * `png` is lossless and is what anything read back, re-rendered or printed
 * wants. `webp` is Skia's lossy encoder — roughly a quarter of the bytes on
 * card artwork, for a picture a browser displays and nothing reads back.
 * `jpeg` is what photos are exchanged as; it has no alpha, so the frame is
 * flattened over white first (see ./jpeg).
 */
export type EncodeFormat = "png" | "webp" | "jpeg";

export type EncodeOptions = EncodePngOptions & {
	// Default "png".
	format?: EncodeFormat;
	// WebP and JPEG only, 0-100. Default 90 — measured on card artwork as the
	// point where the saving is most of what q80 gives without its softening on
	// small text.
	quality?: number;
};

export const DEFAULT_WEBP_QUALITY = 90;
export const DEFAULT_JPEG_QUALITY = 90;

// Encode RGBA8888 pixels (row-major, length width·height·4) as a PNG.
export async function encodePng(
	pixels: Uint8Array,
	width: number,
	height: number,
	opts?: EncodePngOptions,
): Promise<Uint8Array> {
	if (width <= 0 || height <= 0) throw new Error("encodePng: empty image");
	const expected = width * height * 4;
	if (pixels.length < expected) {
		throw new Error(
			`encodePng: expected ${expected} bytes of RGBA, got ${pixels.length}`,
		);
	}
	// A fully opaque frame spends a byte per pixel on an alpha channel that says
	// nothing. Dropping it is not always the smaller stream (long runs of an
	// identical RGBA pixel compress better than the same runs in RGB), so only
	// "best" keeps it as a candidate.
	const opaque = isOpaque(pixels, expected);
	const adaptive = opts?.effort === "best";
	// Built and deflated two at a time, keeping only the smallest stream so far:
	// at 8192x8192 every candidate's filtered rows alive at once is about a GB.
	const plans: { channels: 3 | 4; rows: () => Uint8Array }[] = [];
	if (!opaque || adaptive)
		plans.push({
			channels: 4,
			rows: () => filterRows(pixels, width, height, 4, false),
		});
	if (adaptive)
		plans.push({
			channels: 4,
			rows: () => filterRows(pixels, width, height, 4, true),
		});
	if (opaque) {
		plans.push({ channels: 3, rows: () => rgbRows(pixels, width, height) });
		if (adaptive)
			plans.push({
				channels: 3,
				rows: () =>
					filterRows(rgbLayout(pixels, width, height), width, height, 3, true),
			});
	}

	let best: { stream: DeflatedChunks; channels: 3 | 4 } | undefined;
	for (let i = 0; i < plans.length; i += 2) {
		const pair = plans.slice(i, i + 2);
		const streams = await Promise.all(
			pair.map((plan) => deflateChunks(plan.rows())),
		);
		for (let j = 0; j < pair.length; j++)
			if (!best || streams[j].total < best.stream.total)
				best = { stream: streams[j], channels: pair[j].channels };
	}
	return assemble(best!.stream, width, height, best!.channels);
}

// Read a frame's pixels straight out of a decode and encode them. The pairing
// the callers actually want: decodePixels → encodePng.
export function encodeDecodedPng(
	decoded: DecodedPixels,
	opts?: EncodePngOptions,
): Promise<Uint8Array> {
	return encodePng(decoded.data, decoded.width, decoded.height, opts);
}

function isOpaque(pixels: Uint8Array, length: number): boolean {
	for (let i = 3; i < length; i += 4) if (pixels[i] !== 255) return false;
	return true;
}

function rgbLayout(
	pixels: Uint8Array,
	width: number,
	height: number,
): Uint8Array {
	const out = new Uint8Array(width * height * 3);
	for (let src = 0, dst = 0; dst < out.length; src += 4, dst += 3) {
		out[dst] = pixels[src];
		out[dst + 1] = pixels[src + 1];
		out[dst + 2] = pixels[src + 2];
	}
	return out;
}

// The RGB scanlines, each behind a filter type 0 byte, read straight from RGBA.
function rgbRows(
	pixels: Uint8Array,
	width: number,
	height: number,
): Uint8Array {
	const out = new Uint8Array((width * 3 + 1) * height);
	let src = 0;
	let dst = 0;
	for (let y = 0; y < height; y++) {
		out[dst++] = 0;
		for (let x = 0; x < width; x++, src += 4) {
			out[dst++] = pixels[src];
			out[dst++] = pixels[src + 1];
			out[dst++] = pixels[src + 2];
		}
	}
	return out;
}

// Prefix each scanline with its filter type (PNG spec §6). `adaptive` picks the
// type per row by the standard minimum-sum-of-absolute-differences heuristic;
// otherwise every row is type 0, the bytes as they are.
function filterRows(
	bytes: Uint8Array,
	width: number,
	height: number,
	channels: number,
	adaptive: boolean,
): Uint8Array {
	const stride = width * channels;
	const out = new Uint8Array((stride + 1) * height);
	if (!adaptive) {
		for (let y = 0; y < height; y++) {
			out[y * (stride + 1)] = 0;
			out.set(
				bytes.subarray(y * stride, (y + 1) * stride),
				y * (stride + 1) + 1,
			);
		}
		return out;
	}
	const candidate = new Uint8Array(stride);
	const chosen = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const row = bytes.subarray(y * stride, (y + 1) * stride);
		const prev = y > 0 ? bytes.subarray((y - 1) * stride, y * stride) : null;
		let bestType = 0;
		let bestScore = Number.POSITIVE_INFINITY;
		for (let type = 0; type <= 4; type++) {
			let score = 0;
			for (let i = 0; i < stride; i++) {
				const a = i >= channels ? row[i - channels] : 0;
				const b = prev ? prev[i] : 0;
				const c = prev && i >= channels ? prev[i - channels] : 0;
				const v =
					type === 0
						? row[i]
						: type === 1
							? row[i] - a
							: type === 2
								? row[i] - b
								: type === 3
									? row[i] - ((a + b) >> 1)
									: row[i] - paeth(a, b, c);
				candidate[i] = v & 0xff;
				// Signed magnitude: bytes near zero are what compresses.
				score += Math.abs((candidate[i] << 24) >> 24);
			}
			if (score < bestScore) {
				bestScore = score;
				bestType = type;
				chosen.set(candidate);
			}
		}
		out[y * (stride + 1)] = bestType;
		out.set(chosen, y * (stride + 1) + 1);
	}
	return out;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
}

// zlib-wrapped deflate, which is what an IDAT holds — "deflate-raw" would be
// missing the two-byte header the spec requires.
//
// Driven through the stream's own reader/writer rather than Blob.stream() or
// Response: those are DOM conveniences a test environment (jsdom) may only half
// implement, and this needs nothing but the compression stream itself. The write
// is deliberately not awaited before reading starts — a large frame fills the
// stream's queue, and waiting for the write to settle first would deadlock.
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const { chunks, total } = await deflateChunks(bytes);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

// The deflate output as the chunks the stream produced, so an IDAT can be
// assembled from them without first joining them into one buffer.
type DeflatedChunks = { chunks: Uint8Array[]; total: number };

async function deflateChunks(bytes: Uint8Array): Promise<DeflatedChunks> {
	const cs = new CompressionStream("deflate");
	const writer = cs.writable.getWriter();
	const written = writer
		.write(bytes as unknown as Parameters<typeof writer.write>[0])
		.then(() => writer.close());
	const reader = cs.readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
	}
	await written;
	return { chunks, total };
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function assemble(
	idat: DeflatedChunks,
	width: number,
	height: number,
	channels: number,
): Uint8Array {
	const png = new Uint8Array(
		PNG_SIGNATURE.length + (12 + 13) + (12 + idat.total) + 12,
	);
	png.set(PNG_SIGNATURE, 0);
	let offset = PNG_SIGNATURE.length;

	const view = new DataView(png.buffer);
	view.setUint32(offset + 8, width);
	view.setUint32(offset + 12, height);
	png[offset + 16] = 8; // bit depth
	png[offset + 17] = channels === 4 ? 6 : 2; // colour type: RGBA / RGB
	// 10..12: compression 0, filter 0, interlace 0 — the only values PNG defines.
	offset = sealChunk(png, offset, "IHDR", 13);

	let dst = offset + 8;
	for (const c of idat.chunks) {
		png.set(c, dst);
		dst += c.length;
	}
	offset = sealChunk(png, offset, "IDAT", idat.total);

	sealChunk(png, offset, "IEND", 0);
	return png;
}

// Frame the `length` data bytes already at `start + 8`: the length and type
// before them, the CRC after. Returns where the next chunk starts.
function sealChunk(
	png: Uint8Array,
	start: number,
	type: string,
	length: number,
): number {
	const view = new DataView(png.buffer);
	view.setUint32(start, length);
	for (let i = 0; i < 4; i++) png[start + 4 + i] = type.charCodeAt(i);
	const end = start + 8 + length;
	view.setUint32(end, crc32(png.subarray(start + 4, end)));
	return end + 4;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++)
		c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
