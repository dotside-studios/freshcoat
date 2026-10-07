import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import {
	deflateSync,
	strFromU8,
	unzipSync,
	Zip,
	ZipDeflate,
	ZipPassThrough,
} from "fflate";
import { describe, expect, it } from "vitest";
import { crc32 as ourCrc32 } from "./crc";
import { jpegHeader } from "./image-fixtures";
import {
	blobOutput,
	createZipWriter,
	readZip,
	ZipReadError,
} from "./zip-stream";

const MTIME = new Date(2026, 8, 1, 12, 0, 0);

/** A stored entry whose bytes contain the data descriptor signature, which is
 *  what trips a scanning reader. */
function trickyJpeg(): Uint8Array {
	const head = jpegHeader({ width: 8, height: 8 });
	const out = new Uint8Array(head.length + 16);
	out.set(head);
	out.set([0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4], head.length + 4);
	return out;
}

async function zipOf(entries: { name: string; data: Uint8Array }[]) {
	const out = blobOutput();
	const writer = createZipWriter(out, MTIME);
	for (const e of entries) await writer.add({ ...e, level: 0 });
	await writer.add({
		name: "report.csv",
		data: new TextEncoder().encode("a,b\r\n"),
		level: 6,
	});
	await writer.end();
	const blob = out.blob("application/zip");
	expect(writer.bytes).toBe(blob.size);
	expect(writer.entries).toBe(entries.length + 1);
	return new Uint8Array(await blob.arrayBuffer());
}

describe("createZipWriter", () => {
	it("writes entries as they are added, readable by fflate", async () => {
		const jpeg = trickyJpeg();
		const bytes = await zipOf([
			{ name: "1-photo.jpg", data: jpeg },
			{ name: "é.jpg", data: jpeg },
		]);
		const files = unzipSync(bytes);
		expect(Object.keys(files)).toEqual(["1-photo.jpg", "é.jpg", "report.csv"]);
		expect(files["1-photo.jpg"]).toEqual(jpeg);
		expect(strFromU8(files["report.csv"] as Uint8Array)).toBe("a,b\r\n");
	});

	it("opens in the system unzip", async () => {
		const bytes = await zipOf([{ name: "1-photo.jpg", data: trickyJpeg() }]);
		const dir = mkdtempSync(join(tmpdir(), "zip-"));
		try {
			const file = join(dir, "out.zip");
			writeFileSync(file, bytes);
			let listing: string;
			try {
				listing = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
			} catch (e) {
				if ((e as { code?: string }).code === "ENOENT") return;
				throw e;
			}
			expect(listing).toContain("No errors detected");
			expect(listing).toContain("1-photo.jpg");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("checksums match zlib's at every length and alignment", async () => {
		const data = new Uint8Array(1031).map((_, i) => (i * 131 + 7) & 0xff);
		for (const [start, end] of [
			[0, 0],
			[0, 1],
			[3, 11],
			[5, 1031],
			[0, 1024],
		] as const) {
			const slice = data.subarray(start, end);
			const out = blobOutput();
			const writer = createZipWriter(out, MTIME);
			await writer.add({ name: "x", data: slice, level: 0 });
			await writer.end();
			const bytes = new Uint8Array(await out.blob("").arrayBuffer());
			const crc = new DataView(bytes.buffer).getUint32(14, true);
			expect(crc).toBe(crc32(slice));
			expect(ourCrc32(slice)).toBe(crc32(slice));
		}
	});

	it("writes the same archive from a precomputed CRC", async () => {
		const jpeg = trickyJpeg();
		const blob = new Blob([jpeg as BlobPart]);
		const write = async (withCrc: boolean) => {
			const out = blobOutput();
			const writer = createZipWriter(out, MTIME);
			for (const [name, data] of [
				["a.jpg", jpeg],
				["b.jpg", blob],
			] as const)
				await writer.add({
					name,
					data,
					level: 0,
					...(withCrc ? { crc: ourCrc32(jpeg) } : {}),
				});
			await writer.end();
			return new Uint8Array(await out.blob("").arrayBuffer());
		};
		const computed = await write(false);
		const given = await write(true);
		expect(given).toEqual(computed);
		const files = unzipSync(given);
		expect(files["a.jpg"]).toEqual(jpeg);
		expect(files["b.jpg"]).toEqual(jpeg);
	});

	it("trusts a precomputed CRC without reading the data for one", async () => {
		const data = new Uint8Array([1, 2, 3]);
		const out = blobOutput();
		const writer = createZipWriter(out, MTIME);
		await writer.add({ name: "x", data, level: 0, crc: 0x12345678 });
		await writer.end();
		const bytes = new Uint8Array(await out.blob("").arrayBuffer());
		expect(new DataView(bytes.buffer).getUint32(14, true)).toBe(0x12345678);
	});

	it("refuses entries after the end", async () => {
		const writer = createZipWriter(blobOutput(), MTIME);
		await writer.end();
		await expect(
			writer.add({ name: "x", data: new Uint8Array(1), level: 0 }),
		).rejects.toThrow(/finished/);
	});
});

type Read = { via: "file" | "stored"; bytes: Uint8Array };

/** Every entry of a zip as bytes, and whether it came as chunks or as a
 *  slice; `sliced` asks for stored entries as slices. */
async function readAll(
	zip: Uint8Array | Blob,
	sliced: boolean,
	limits: { maxBytes?: number } = {},
): Promise<Record<string, Read>> {
	const out: Record<string, Read> = {};
	await readZip(zip instanceof Blob ? zip : new Blob([zip as BlobPart]), {
		...limits,
		onFile(name, chunks) {
			out[name] = { via: "file", bytes: joined(chunks) };
		},
		...(sliced
			? {
					async onStored(name: string, data: Blob) {
						out[name] = {
							via: "stored",
							bytes: new Uint8Array(await data.arrayBuffer()),
						};
					},
				}
			: {}),
	});
	return out;
}

function joined(chunks: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

function bytesOf(read: Record<string, Read>): Record<string, Uint8Array> {
	return Object.fromEntries(Object.entries(read).map(([k, v]) => [k, v.bytes]));
}

/** A zip that marks every size and offset as zip64 whether it needs to or
 *  not, with its directory found through the zip64 end records and another
 *  extra field in front of each zip64 one. */
function zip64Zip(
	entries: { name: string; data: Uint8Array; deflate?: boolean }[],
): Uint8Array {
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const e of entries) {
		const name = new TextEncoder().encode(e.name);
		const body = e.deflate ? deflateSync(e.data) : e.data;
		const local = new Uint8Array(30 + name.length + 20);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 45, true);
		lv.setUint16(8, e.deflate ? 8 : 0, true);
		lv.setUint32(14, crc32(e.data), true);
		lv.setUint32(18, 0xffffffff, true);
		lv.setUint32(22, 0xffffffff, true);
		lv.setUint16(26, name.length, true);
		lv.setUint16(28, 20, true);
		local.set(name, 30);
		lv.setUint16(30 + name.length, 1, true);
		lv.setUint16(32 + name.length, 16, true);
		lv.setBigUint64(34 + name.length, BigInt(e.data.length), true);
		lv.setBigUint64(42 + name.length, BigInt(body.length), true);
		parts.push(local, body);

		const record = new Uint8Array(46 + name.length + 9 + 28);
		const cv = new DataView(record.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 45, true);
		cv.setUint16(6, 45, true);
		cv.setUint16(10, e.deflate ? 8 : 0, true);
		cv.setUint32(16, crc32(e.data), true);
		cv.setUint32(20, 0xffffffff, true);
		cv.setUint32(24, 0xffffffff, true);
		cv.setUint16(28, name.length, true);
		cv.setUint16(30, 9 + 28, true);
		cv.setUint32(42, 0xffffffff, true);
		record.set(name, 46);
		let x = 46 + name.length;
		cv.setUint16(x, 0x5455, true);
		cv.setUint16(x + 2, 5, true);
		x += 9;
		cv.setUint16(x, 1, true);
		cv.setUint16(x + 2, 24, true);
		cv.setBigUint64(x + 4, BigInt(e.data.length), true);
		cv.setBigUint64(x + 12, BigInt(body.length), true);
		cv.setBigUint64(x + 20, BigInt(offset), true);
		central.push(record);
		offset += local.length + body.length;
	}
	const start = offset;
	const size = central.reduce((n, c) => n + c.length, 0);
	const end = new Uint8Array(56 + 20 + 22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06064b50, true);
	ev.setBigUint64(4, 44n, true);
	ev.setBigUint64(24, BigInt(entries.length), true);
	ev.setBigUint64(32, BigInt(entries.length), true);
	ev.setBigUint64(40, BigInt(size), true);
	ev.setBigUint64(48, BigInt(start), true);
	ev.setUint32(56, 0x07064b50, true);
	ev.setBigUint64(64, BigInt(start + size), true);
	ev.setUint32(72, 1, true);
	ev.setUint32(76, 0x06054b50, true);
	ev.setUint16(84, 0xffff, true);
	ev.setUint16(86, 0xffff, true);
	ev.setUint32(88, 0xffffffff, true);
	ev.setUint32(92, 0xffffffff, true);
	return joined([...parts, ...central, end]);
}

/** Where an entry's local header starts, found by its name. */
function localHeaderOf(zip: Uint8Array, name: string): number {
	const wanted = new TextEncoder().encode(name);
	for (let i = 0; i + 30 + wanted.length <= zip.length; i++) {
		const view = new DataView(zip.buffer, zip.byteOffset + i);
		if (
			view.getUint32(0, true) === 0x04034b50 &&
			view.getUint16(26, true) === wanted.length &&
			wanted.every((b, j) => zip[i + 30 + j] === b)
		)
			return i;
	}
	throw new Error(`no local header for ${name}`);
}

describe("readZip", () => {
	it("hands stored entries over as slices with the bytes the stream gives", async () => {
		const jpeg = trickyJpeg();
		const zip = await zipOf([
			{ name: "1-photo.jpg", data: jpeg },
			{ name: "é.jpg", data: jpeg.subarray(3) },
			{ name: "empty.jpg", data: new Uint8Array() },
		]);
		const streamed = await readAll(zip, false);
		const sliced = await readAll(zip, true);
		expect(Object.keys(sliced)).toEqual(Object.keys(streamed));
		expect(bytesOf(sliced)).toEqual(bytesOf(streamed));
		expect(sliced["1-photo.jpg"]?.via).toBe("stored");
		expect(sliced["é.jpg"]?.via).toBe("stored");
		expect(sliced["empty.jpg"]?.via).toBe("stored");
		expect(sliced["report.csv"]?.via).toBe("file");
		expect(sliced["1-photo.jpg"]?.bytes).toEqual(jpeg);
	});

	it("places entries with data descriptors by the central directory", async () => {
		const jpeg = trickyJpeg();
		const text = new TextEncoder().encode("a,b\r\n".repeat(500));
		const parts: Uint8Array[] = [];
		const zip = new Zip((err, chunk) => {
			if (err) throw err;
			parts.push(chunk);
		});
		const stored = new ZipPassThrough("photo.jpg");
		zip.add(stored);
		stored.push(jpeg, true);
		const deflated = new ZipDeflate("report.csv", { level: 6 });
		zip.add(deflated);
		deflated.push(text, true);
		zip.end();
		const bytes = joined(parts);
		const flags = new DataView(bytes.buffer).getUint16(6, true);
		expect(flags & 8).toBe(8);
		const sliced = await readAll(bytes, true);
		expect(sliced["photo.jpg"]).toEqual({ via: "stored", bytes: jpeg });
		expect(sliced["report.csv"]).toEqual({ via: "file", bytes: text });
		expect(bytesOf(sliced)).toEqual(bytesOf(await readAll(bytes, false)));
	});

	it("reads zip64 end records and extra fields", async () => {
		const jpeg = trickyJpeg();
		const text = new TextEncoder().encode("zip64 ".repeat(100));
		const bytes = zip64Zip([
			{ name: "photo.jpg", data: jpeg },
			{ name: "notes.txt", data: text, deflate: true },
			{ name: "second.jpg", data: jpeg.subarray(5) },
		]);
		expect(unzipSync(bytes)["second.jpg"]).toEqual(jpeg.subarray(5));
		const sliced = await readAll(bytes, true);
		expect(Object.keys(sliced)).toEqual([
			"photo.jpg",
			"notes.txt",
			"second.jpg",
		]);
		expect(sliced["photo.jpg"]).toEqual({ via: "stored", bytes: jpeg });
		expect(sliced["notes.txt"]).toEqual({ via: "file", bytes: text });
		expect(sliced["second.jpg"]).toEqual({
			via: "stored",
			bytes: jpeg.subarray(5),
		});
	});

	// Writes and reads back 66,000 entries, so it takes seconds.
	it("finds a zip64 directory past 65,535 entries", async () => {
		const out = blobOutput();
		const writer = createZipWriter(out, MTIME);
		for (let i = 0; i < 66_000; i++)
			await writer.add({
				name: `${i}.bin`,
				data: new Uint8Array([i & 0xff, i >> 8]),
				level: 0,
			});
		await writer.end();
		// Flattened, since slicing a Blob of 132,000 parts is slow in Node.
		const bytes = new Uint8Array(await out.blob("").arrayBuffer());
		const sliced = await readAll(bytes, true);
		expect(Object.keys(sliced)).toHaveLength(66_000);
		expect(sliced["65999.bin"]).toEqual({
			via: "stored",
			bytes: new Uint8Array([65999 & 0xff, 65999 >> 8]),
		});
	}, 60_000);

	it("falls back to the stream when the directory does not match its entries", async () => {
		const jpeg = trickyJpeg();
		const zip = await zipOf([{ name: "1-photo.jpg", data: jpeg }]);
		const bytes = zip.slice();
		const view = new DataView(bytes.buffer);
		const eocd = bytes.length - 22;
		const directory = view.getUint32(eocd + 16, true);
		// The first entry's local header offset, pointed one byte off.
		view.setUint32(directory + 42, 1, true);
		const read = await readAll(bytes, true);
		expect(read["1-photo.jpg"]).toEqual({ via: "file", bytes: jpeg });
		expect(read["report.csv"]?.via).toBe("file");
	});

	it("refuses a corrupt deflated entry, as the stream does", async () => {
		const zip = await zipOf([{ name: "1-photo.jpg", data: trickyJpeg() }]);
		const at = localHeaderOf(zip, "report.csv");
		const view = new DataView(zip.buffer);
		const start = at + 30 + view.getUint16(at + 26, true);
		// A final block of the reserved type, which no inflater accepts.
		zip.fill(0xff, start, start + view.getUint32(at + 18, true));
		for (const sliced of [false, true]) {
			const err = await readAll(zip, sliced).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(ZipReadError);
			expect((err as ZipReadError).reason).toBe("not_a_zip");
		}
	});

	it("counts sliced entries against the byte limit", async () => {
		const zip = await zipOf([{ name: "1-photo.jpg", data: trickyJpeg() }]);
		for (const sliced of [false, true]) {
			const err = await readAll(zip, sliced, { maxBytes: 10 }).catch(
				(e: unknown) => e,
			);
			expect((err as ZipReadError).reason).toBe("too_large");
		}
	});
});

/** A Blob of `length` zero bytes that streams one reused chunk, so a zip
 *  past 4 GB can be written without holding it. */
class ZeroBlob extends Blob {
	constructor(private readonly length: number) {
		super([]);
	}
	override get size() {
		return this.length;
	}
	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		const chunk = new Uint8Array(8 << 20);
		let left = this.length;
		return new ReadableStream({
			pull(controller) {
				if (left === 0) {
					controller.close();
					return;
				}
				const n = Math.min(left, chunk.length);
				left -= n;
				controller.enqueue(n === chunk.length ? chunk : chunk.subarray(0, n));
			},
		});
	}
}

/** Keeps the header bytes a writer produces and only counts its Blob parts,
 *  then reads fields back by absolute offset. */
function headerOutput() {
	const parts: { at: number; bytes: Uint8Array }[] = [];
	let size = 0;
	return {
		async write(part: Uint8Array | Blob) {
			if (ArrayBuffer.isView(part)) parts.push({ at: size, bytes: part });
			size += ArrayBuffer.isView(part) ? part.length : part.size;
		},
		get size() {
			return size;
		},
		view(at: number): DataView {
			const part = parts.find((p) => p.at <= at && at < p.at + p.bytes.length);
			if (!part) throw new Error(`no header bytes at ${at}`);
			return new DataView(
				part.bytes.buffer,
				part.bytes.byteOffset + (at - part.at),
			);
		},
	};
}

describe("zip64", () => {
	it("leaves a small zip byte for byte as it was", async () => {
		const out = blobOutput();
		const writer = createZipWriter(out, MTIME);
		await writer.add({
			name: "1-photo.jpg",
			data: new Uint8Array(300).map((_, i) => i & 0xff),
			level: 0,
		});
		await writer.add({
			name: "é.jpg",
			data: new Blob([new Uint8Array(70).fill(9)]),
			level: 0,
		});
		await writer.add({
			name: "report.csv",
			data: new TextEncoder().encode("a,b\r\n1,2\r\n"),
			level: 6,
		});
		await writer.end();
		const bytes = new Uint8Array(await out.blob("").arrayBuffer());
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(
			"bea8be2c3cdf8939994f82eb9c7afd10d4c65b6aaeae8a6aacd2d149aae13fe7",
		);
	});

	it("writes more than 65,535 entries, readable by fflate and unzip", async () => {
		const count = 70_000;
		const out = blobOutput();
		const writer = createZipWriter(out, MTIME);
		for (let i = 0; i < count; i++)
			await writer.add({
				name: `${i}.txt`,
				data: new Uint8Array([i & 0xff]),
				level: 0,
			});
		await writer.end();
		const bytes = new Uint8Array(await out.blob("").arrayBuffer());
		const view = new DataView(bytes.buffer);
		const eocd = bytes.length - 22;
		expect(view.getUint32(eocd, true)).toBe(0x06054b50);
		expect(view.getUint16(eocd + 10, true)).toBe(0xffff);
		expect(view.getUint32(eocd - 20, true)).toBe(0x07064b50);
		const record = Number(view.getBigUint64(eocd - 20 + 8, true));
		expect(view.getUint32(record, true)).toBe(0x06064b50);
		expect(view.getBigUint64(record + 32, true)).toBe(BigInt(count));

		const files = unzipSync(bytes);
		expect(Object.keys(files)).toHaveLength(count);
		expect(files["69999.txt"]).toEqual(new Uint8Array([69999 & 0xff]));

		const dir = mkdtempSync(join(tmpdir(), "zip-"));
		try {
			const file = join(dir, "many.zip");
			writeFileSync(file, bytes);
			let listing: string;
			try {
				listing = execFileSync("unzip", ["-t", file], {
					encoding: "utf8",
					maxBuffer: 64 << 20,
				});
			} catch (e) {
				if ((e as { code?: string }).code === "ENOENT") return;
				throw e;
			}
			expect(listing).toContain("No errors detected");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 60_000);

	it("writes an entry past 4 GB, and offsets after it, in zip64 fields", async () => {
		const size = 2 ** 32 + 5;
		const out = headerOutput();
		const writer = createZipWriter(out, MTIME);
		await writer.add({ name: "big.bin", data: new ZeroBlob(size), level: 0 });
		await writer.add({
			name: "after.txt",
			data: new TextEncoder().encode("after"),
			level: 0,
		});
		await writer.end();
		expect(writer.bytes).toBe(out.size);

		let zeros = 0;
		const chunk = new Uint8Array(8 << 20);
		for (let left = size; left > 0; left -= chunk.length)
			zeros = crc32(chunk.subarray(0, Math.min(left, chunk.length)), zeros);

		const local = out.view(0);
		expect(local.getUint32(0, true)).toBe(0x04034b50);
		expect(local.getUint16(4, true)).toBe(45);
		expect(local.getUint32(14, true)).toBe(zeros);
		expect(local.getUint32(18, true)).toBe(0xffffffff);
		expect(local.getUint32(22, true)).toBe(0xffffffff);
		expect(local.getUint16(28, true)).toBe(20);
		const localExtra = out.view(30 + "big.bin".length);
		expect(localExtra.getUint16(0, true)).toBe(1);
		expect(localExtra.getBigUint64(4, true)).toBe(BigInt(size));
		expect(localExtra.getBigUint64(12, true)).toBe(BigInt(size));

		const afterOffset = 30 + "big.bin".length + 20 + size;
		expect(out.view(afterOffset).getUint32(0, true)).toBe(0x04034b50);
		expect(out.view(afterOffset).getUint16(4, true)).toBe(20);

		const eocd = out.size - 22;
		const end = out.view(eocd);
		expect(end.getUint32(0, true)).toBe(0x06054b50);
		expect(end.getUint16(10, true)).toBe(2);
		expect(end.getUint32(16, true)).toBe(0xffffffff);
		const locator = out.view(eocd - 20);
		expect(locator.getUint32(0, true)).toBe(0x07064b50);
		const record = out.view(Number(locator.getBigUint64(8, true)));
		expect(record.getUint32(0, true)).toBe(0x06064b50);
		const start = Number(record.getBigUint64(48, true));

		const big = out.view(start);
		expect(big.getUint32(0, true)).toBe(0x02014b50);
		expect(big.getUint16(6, true)).toBe(45);
		expect(big.getUint32(20, true)).toBe(0xffffffff);
		expect(big.getUint32(24, true)).toBe(0xffffffff);
		expect(big.getUint16(30, true)).toBe(20);
		expect(big.getUint32(42, true)).toBe(0);
		const bigExtra = out.view(start + 46 + "big.bin".length);
		expect(bigExtra.getBigUint64(4, true)).toBe(BigInt(size));
		expect(bigExtra.getBigUint64(12, true)).toBe(BigInt(size));

		const next = start + 46 + "big.bin".length + 20;
		const after = out.view(next);
		expect(after.getUint32(0, true)).toBe(0x02014b50);
		expect(after.getUint32(24, true)).toBe(5);
		expect(after.getUint16(30, true)).toBe(12);
		expect(after.getUint32(42, true)).toBe(0xffffffff);
		const afterExtra = out.view(next + 46 + "after.txt".length);
		expect(afterExtra.getUint16(2, true)).toBe(8);
		expect(afterExtra.getBigUint64(4, true)).toBe(BigInt(afterOffset));
	}, 180_000);
});
