// Zip writing and reading that hold one entry at a time.
//
// The writer lays entries out exactly as fflate's `zipSync` does: local
// headers carry the CRC and sizes, so there are no data descriptors. fflate's
// streaming `Zip` always writes descriptors, and its streaming `Unzip` finds
// the end of such an entry by scanning for the descriptor's signature, which
// a stored photo can contain. Knowing the sizes up front costs a second read
// of each stored Blob, which is cheap next to holding it.

import { deflateSync, Unzip, UnzipInflate, unzipSync } from "fflate";
import { crc32, crcUpdate } from "./crc";

export type ZipEntry = {
	name: string;
	data: Uint8Array | Blob;
	/** 0 stores, 6 deflates */
	level: 0 | 6;
	/** precomputed CRC-32 of `data`, so the writer skips reading it */
	crc?: number;
};

/** Where written zip bytes go: a Blob part is passed whole, so a sink that
 *  keeps parts keeps the Blob rather than a copy of its bytes. */
export type ZipOutput = {
	write(part: Uint8Array | Blob): Promise<void>;
};

async function* chunksOf(blob: Blob): AsyncGenerator<Uint8Array> {
	const reader = blob.stream().getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

async function crcOf(data: Uint8Array | Blob): Promise<number> {
	// isView rather than instanceof: bytes made in another realm (a test DOM,
	// a frame) are still bytes, and have no stream() to read them by.
	if (ArrayBuffer.isView(data)) return crc32(data);
	let c = -1;
	for await (const chunk of chunksOf(data)) c = crcUpdate(c, chunk);
	return (c ^ -1) >>> 0;
}

function dosTime(date: Date): number {
	return (
		(((date.getFullYear() - 1980) << 25) |
			((date.getMonth() + 1) << 21) |
			(date.getDate() << 16) |
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			(date.getSeconds() >> 1)) >>>
		0
	);
}

type Written = {
	name: Uint8Array;
	utf8: boolean;
	compression: number;
	crc: number;
	compressed: number;
	size: number;
	offset: number;
};

// A 32-bit field holds values up to this; the value itself means "see the
// zip64 extra field", so it is never written as a size or offset of its own.
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const ZIP64_VERSION = 45;

// A zip64 extra field carrying `values`, which are the header fields that
// read MAX32, in the order the format fixes: size, compressed size, offset.
function zip64Extra(values: number[]): Uint8Array {
	if (values.length === 0) return new Uint8Array(0);
	const out = new Uint8Array(4 + 8 * values.length);
	const view = new DataView(out.buffer);
	view.setUint16(0, 0x0001, true);
	view.setUint16(2, 8 * values.length, true);
	values.forEach((v, i) => {
		view.setBigUint64(4 + 8 * i, BigInt(v), true);
	});
	return out;
}

function header(entry: Written, time: number, central: boolean): Uint8Array {
	// A local header has no offset, and when either size overflows it marks
	// and carries both, as readers expect.
	const wideSizes = entry.size >= MAX32 || entry.compressed >= MAX32;
	const size = central || !wideSizes ? Math.min(entry.size, MAX32) : MAX32;
	const compressed =
		central || !wideSizes ? Math.min(entry.compressed, MAX32) : MAX32;
	const offset = Math.min(entry.offset, MAX32);
	const extra = zip64Extra(
		central
			? [
					...(size === MAX32 ? [entry.size] : []),
					...(compressed === MAX32 ? [entry.compressed] : []),
					...(offset === MAX32 ? [entry.offset] : []),
				]
			: wideSizes
				? [entry.size, entry.compressed]
				: [],
	);
	const version = extra.length ? ZIP64_VERSION : 20;
	const out = new Uint8Array(
		(central ? 46 : 30) + entry.name.length + extra.length,
	);
	const view = new DataView(out.buffer);
	let at = 0;
	view.setUint32(at, central ? 0x02014b50 : 0x04034b50, true);
	at += 4;
	if (central) {
		view.setUint16(at, version, true);
		at += 2;
	}
	view.setUint16(at, version, true);
	view.setUint16(at + 2, entry.utf8 ? 0x0800 : 0, true);
	view.setUint16(at + 4, entry.compression, true);
	view.setUint32(at + 6, time, true);
	view.setUint32(at + 10, entry.crc, true);
	view.setUint32(at + 14, compressed, true);
	view.setUint32(at + 18, size, true);
	view.setUint16(at + 22, entry.name.length, true);
	view.setUint16(at + 24, extra.length, true);
	at += 26;
	if (central) {
		// comment, disk, internal and external attributes: all zero
		view.setUint32(at + 10, offset, true);
		at += 14;
	}
	out.set(entry.name, at);
	out.set(extra, at + entry.name.length);
	return out;
}

// The end of the central directory, preceded by the zip64 record and its
// locator when a count, size or offset does not fit the classic record.
function endRecords(entries: number, size: number, start: number): Uint8Array {
	const zip64 = entries >= MAX16 || size >= MAX32 || start >= MAX32;
	const out = new Uint8Array((zip64 ? 56 + 20 : 0) + 22);
	const view = new DataView(out.buffer);
	let at = 0;
	if (zip64) {
		view.setUint32(0, 0x06064b50, true);
		view.setBigUint64(4, 44n, true);
		view.setUint16(12, ZIP64_VERSION, true);
		view.setUint16(14, ZIP64_VERSION, true);
		view.setBigUint64(24, BigInt(entries), true);
		view.setBigUint64(32, BigInt(entries), true);
		view.setBigUint64(40, BigInt(size), true);
		view.setBigUint64(48, BigInt(start), true);
		view.setUint32(56, 0x07064b50, true);
		view.setBigUint64(64, BigInt(start + size), true);
		view.setUint32(72, 1, true);
		at = 76;
	}
	view.setUint32(at, 0x06054b50, true);
	view.setUint16(at + 8, Math.min(entries, MAX16), true);
	view.setUint16(at + 10, Math.min(entries, MAX16), true);
	view.setUint32(at + 12, Math.min(size, MAX32), true);
	view.setUint32(at + 16, Math.min(start, MAX32), true);
	return out;
}

/** A zip written as entries are added, each one straight to `out`. */
export type ZipWriter = {
	add(entry: ZipEntry): Promise<void>;
	/** writes the central directory; nothing may be added after */
	end(): Promise<void>;
	/** bytes written so far */
	readonly bytes: number;
	readonly entries: number;
};

/**
 * An incremental zip writer. A stored Blob entry is read twice, once for its
 * CRC and once into the output, unless the entry brings its CRC; a deflated one is read into memory, which
 * suits the small text entries it is used for. Zip64 records are written only
 * where a size, offset or count needs them, so a zip under 4 GB and 65,535
 * entries is the same classic zip it always was.
 */
export function createZipWriter(out: ZipOutput, mtime: Date): ZipWriter {
	const time = dosTime(mtime);
	const written: Written[] = [];
	const encoder = new TextEncoder();
	let offset = 0;
	let ended = false;
	return {
		get bytes() {
			return offset;
		},
		get entries() {
			return written.length;
		},
		async add(entry) {
			if (ended) throw new Error("the zip is already finished");
			const name = encoder.encode(entry.name);
			let body: Uint8Array | Blob;
			let size: number;
			let crc: number;
			if (entry.level === 0) {
				body = entry.data;
				size = entry.data instanceof Blob ? entry.data.size : entry.data.length;
				crc = entry.crc ?? (await crcOf(entry.data));
			} else {
				const raw =
					entry.data instanceof Blob
						? new Uint8Array(await entry.data.arrayBuffer())
						: entry.data;
				size = raw.length;
				crc = entry.crc ?? (await crcOf(raw));
				body = deflateSync(raw, { level: entry.level });
			}
			const compressed = body instanceof Blob ? body.size : body.length;
			const record: Written = {
				name,
				utf8: name.length !== entry.name.length,
				compression: entry.level === 0 ? 0 : 8,
				crc,
				compressed,
				size,
				offset,
			};
			const local = header(record, time, false);
			await out.write(local);
			await out.write(body);
			offset += local.length + compressed;
			written.push(record);
		},
		async end() {
			if (ended) return;
			ended = true;
			let directory = 0;
			const start = offset;
			for (const entry of written) {
				const central = header(entry, time, true);
				directory += central.length;
				await out.write(central);
			}
			const end = endRecords(written.length, directory, start);
			await out.write(end);
			offset += directory + end.length;
		},
	};
}

/** Writes a zip, one entry at a time, in the order `entries` yields them. */
export async function writeZip(
	entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
	out: ZipOutput,
	mtime: Date,
): Promise<void> {
	const writer = createZipWriter(out, mtime);
	for await (const entry of entries) await writer.add(entry);
	await writer.end();
}

/** A ZipOutput that collects parts into a Blob. */
export function blobOutput(): ZipOutput & { blob(type: string): Blob } {
	const parts: (Uint8Array | Blob)[] = [];
	return {
		async write(part) {
			parts.push(part);
		},
		blob: (type) => new Blob(parts as BlobPart[], { type }),
	};
}

/** A ZipOutput onto a WritableStream, awaiting each write so a slow
 *  destination holds the writer back. */
export function streamOutput(
	writer: WritableStreamDefaultWriter<Uint8Array>,
): ZipOutput {
	return {
		async write(part) {
			if (ArrayBuffer.isView(part)) {
				await writer.ready;
				await writer.write(part);
				return;
			}
			for await (const chunk of chunksOf(part)) {
				await writer.ready;
				await writer.write(chunk);
			}
		},
	};
}

export class ZipReadError extends Error {
	constructor(
		readonly reason: "not_a_zip" | "too_large",
		message: string,
	) {
		super(message);
	}
}

export type ZipReadOptions = {
	/** Whether to keep an entry. A skipped entry is still read through, but
	 *  its bytes are dropped as they arrive. */
	filter?: (name: string) => boolean;
	/** An entry's decompressed bytes, in order, once it is complete. The
	 *  reader drops them after this resolves. */
	onFile: (name: string, chunks: Uint8Array[]) => void | Promise<void>;
	maxEntries?: number;
	maxBytes?: number;
};

class NeedsWholeFile extends Error {}

/**
 * Reads a zip Blob as a stream. Entries are handed over one at a time as
 * they complete. A zip that stores an entry with a data descriptor cannot be
 * split reliably while streaming, so that one is read whole instead.
 */
export async function readZip(
	source: Blob,
	opts: ZipReadOptions,
): Promise<void> {
	const head = new Uint8Array(await source.slice(0, 4).arrayBuffer());
	if (
		head[0] !== 0x50 ||
		head[1] !== 0x4b ||
		!((head[2] === 3 && head[3] === 4) || (head[2] === 5 && head[3] === 6))
	)
		throw new ZipReadError("not_a_zip", "not a readable zip");
	const delivered = new Set<string>();
	try {
		await readStreaming(source, opts, delivered);
	} catch (err) {
		if (!(err instanceof NeedsWholeFile)) throw err;
		await readWhole(source, opts, delivered);
	}
}

function limiter(opts: ZipReadOptions) {
	const maxEntries = opts.maxEntries ?? Number.POSITIVE_INFINITY;
	const maxBytes = opts.maxBytes ?? Number.POSITIVE_INFINITY;
	let entries = 0;
	let bytes = 0;
	const fail = () => {
		throw new ZipReadError(
			"too_large",
			`the file exceeds ${maxEntries} entries or ${maxBytes} bytes`,
		);
	};
	return {
		entry() {
			entries += 1;
			if (entries > maxEntries) fail();
		},
		bytes(n: number) {
			bytes += n;
			if (bytes > maxBytes) fail();
		},
	};
}

async function readStreaming(
	source: Blob,
	opts: ZipReadOptions,
	delivered: Set<string>,
): Promise<void> {
	const limits = limiter(opts);
	const done: { name: string; chunks: Uint8Array[] }[] = [];
	let failure: unknown = null;
	const unzip = new Unzip((file) => {
		try {
			if (file.compression === 0 && file.size === undefined)
				throw new NeedsWholeFile();
			limits.entry();
			const keep = opts.filter?.(file.name) ?? true;
			const chunks: Uint8Array[] = [];
			file.ondata = (err, data, final) => {
				if (failure) return;
				if (err) {
					failure = new ZipReadError("not_a_zip", err.message);
					return;
				}
				try {
					limits.bytes(data.length);
				} catch (e) {
					failure = e;
					return;
				}
				if (keep && data.length) chunks.push(data);
				if (final && keep) done.push({ name: file.name, chunks });
			};
			file.start();
		} catch (e) {
			failure ??= e;
		}
	});
	unzip.register(UnzipInflate);
	const reader = source.stream().getReader();
	try {
		for (;;) {
			const { done: end, value } = await reader.read();
			try {
				unzip.push(value ?? new Uint8Array(), end);
			} catch (e) {
				failure ??= new ZipReadError(
					"not_a_zip",
					`not a readable zip: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
			if (failure) throw failure;
			for (const file of done.splice(0)) {
				delivered.add(file.name);
				await opts.onFile(file.name, file.chunks);
			}
			if (end) return;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
}

async function readWhole(
	source: Blob,
	opts: ZipReadOptions,
	delivered: ReadonlySet<string>,
): Promise<void> {
	const limits = limiter(opts);
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(new Uint8Array(await source.arrayBuffer()), {
			filter(file) {
				limits.entry();
				limits.bytes(file.originalSize);
				if (delivered.has(file.name)) return false;
				return opts.filter?.(file.name) ?? true;
			},
		});
	} catch (err) {
		if (err instanceof ZipReadError) throw err;
		throw new ZipReadError(
			"not_a_zip",
			`not a readable zip: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	for (const [name, data] of Object.entries(files)) {
		await opts.onFile(name, [data]);
	}
}

/** Chunks as one array, without a copy when there is only one. */
export function joinChunks(chunks: readonly Uint8Array[]): Uint8Array {
	if (chunks.length === 1) return chunks[0] as Uint8Array;
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}
