// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
	createFolderSink,
	createPartZipSink,
	createStreamZipSink,
	destinationSupport,
	type FolderHandle,
	type JobFile,
	openSink,
	type WritableFile,
} from "~/export/sinks";

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

async function unzipBlob(blob: Blob) {
	return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

/** A folder that records each file as it is closed. */
function fakeFolder(opts: { failOn?: string } = {}) {
	const files: Record<string, Uint8Array> = {};
	const order: string[] = [];
	const aborted: string[] = [];
	const folder: FolderHandle = {
		async getFileHandle(name) {
			return {
				async createWritable(): Promise<WritableFile> {
					let data: Uint8Array = new Uint8Array();
					return {
						async write(chunk) {
							if (name === opts.failOn) throw new Error("disk full");
							data = chunk;
						},
						async close() {
							files[name] = data;
							order.push(name);
						},
						async abort() {
							aborted.push(name);
						},
					};
				},
			};
		},
	};
	return { folder, files, order, aborted };
}

describe("FolderSink", () => {
	it("writes each file as it comes, in order", async () => {
		const { folder, files, order } = fakeFolder();
		const sink = createFolderSink(folder);
		await sink.add("1.jpg", bytes(3));
		await sink.add("2.jpg", bytes(4));
		await sink.add("export-report.csv", bytes(1));
		expect(order).toEqual(["1.jpg", "2.jpg", "export-report.csv"]);
		expect(files["2.jpg"]).toEqual(bytes(4));
		expect(await sink.finish()).toEqual({ kind: "folder", files: 3, bytes: 8 });
	});

	it("keeps what was written when aborted, and takes nothing after", async () => {
		const { folder, order } = fakeFolder();
		const sink = createFolderSink(folder);
		await sink.add("1.jpg", bytes(3));
		await sink.abort();
		await expect(sink.add("2.jpg", bytes(3))).rejects.toThrow(/cancelled/);
		expect(order).toEqual(["1.jpg"]);
		expect(sink.files).toBe(1);
	});

	it("discards a file that fails to write", async () => {
		const { folder, aborted } = fakeFolder({ failOn: "2.jpg" });
		const sink = createFolderSink(folder);
		await sink.add("1.jpg", bytes(3));
		await expect(sink.add("2.jpg", bytes(3))).rejects.toThrow("disk full");
		expect(aborted).toEqual(["2.jpg"]);
		expect(sink.files).toBe(1);
	});
});

/** A writable that takes one chunk at a time and holds each until released. */
function slowWritable() {
	const chunks: Uint8Array[] = [];
	const waiting: (() => void)[] = [];
	let aborted = false;
	let closed = false;
	const writable = new WritableStream<Uint8Array>(
		{
			write(chunk) {
				chunks.push(chunk.slice());
				return new Promise<void>((resolve) => waiting.push(resolve));
			},
			close() {
				closed = true;
			},
			abort() {
				aborted = true;
			},
		},
		new CountQueuingStrategy({ highWaterMark: 1 }),
	);
	return {
		writable,
		chunks,
		release() {
			for (const resolve of waiting.splice(0)) resolve();
		},
		get pending() {
			return waiting.length;
		},
		get aborted() {
			return aborted;
		},
		get closed() {
			return closed;
		},
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("StreamZipSink", () => {
	it("awaits each write, so a slow file holds it back", async () => {
		const out = slowWritable();
		const sink = createStreamZipSink(out.writable);
		let added = false;
		const adding = sink.add("1.jpg", bytes(10)).then(() => {
			added = true;
		});
		await tick();
		expect(out.pending).toBe(1);
		expect(added).toBe(false);
		let ready = false;
		void sink.ready.then(() => {
			ready = true;
		});
		await tick();
		expect(ready).toBe(false);
		const pump = setInterval(() => out.release(), 1);
		await adding;
		await sink.ready;
		clearInterval(pump);
		expect(added).toBe(true);
	});

	it("writes a zip fflate and the system unzip both read", async () => {
		const out = slowWritable();
		const pump = setInterval(() => out.release(), 1);
		const sink = createStreamZipSink(out.writable);
		// a stored entry holding the data descriptor signature
		const tricky = new Uint8Array([0xff, 0xd8, 0x50, 0x4b, 0x07, 0x08, 9, 9]);
		await sink.add("1.jpg", tricky);
		await sink.add("2.jpg", bytes(5000, 7));
		await sink.add("export-report.csv", new TextEncoder().encode("a,b\r\n"));
		const result = await sink.finish();
		clearInterval(pump);
		expect(out.closed).toBe(true);
		const zip = new Uint8Array(
			await new Blob(out.chunks as BlobPart[]).arrayBuffer(),
		);
		expect(result).toEqual({ kind: "zip-file", files: 3, bytes: zip.length });
		const files = unzipSync(zip);
		expect(Object.keys(files)).toEqual(["1.jpg", "2.jpg", "export-report.csv"]);
		expect(files["1.jpg"]).toEqual(tricky);
		expect(strFromU8(files["export-report.csv"] as Uint8Array)).toBe("a,b\r\n");

		const dir = mkdtempSync(join(tmpdir(), "sink-"));
		try {
			const file = join(dir, "out.zip");
			writeFileSync(file, zip);
			let listing = "";
			try {
				listing = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
			} catch (e) {
				if ((e as { code?: string }).code !== "ENOENT") throw e;
			}
			if (listing) expect(listing).toContain("No errors detected");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("aborts the file on cancel", async () => {
		const out = slowWritable();
		const pump = setInterval(() => out.release(), 1);
		const sink = createStreamZipSink(out.writable);
		await sink.add("1.jpg", bytes(10));
		await sink.abort();
		clearInterval(pump);
		expect(out.aborted).toBe(true);
	});
});

describe("PartZipSink", () => {
	it("splits into parts under partBytes, with the report in the last", async () => {
		const parts: JobFile[] = [];
		const sink = createPartZipSink({
			name: "photos",
			partBytes: 2500,
			onPart: (file, index) => {
				expect(index).toBe(parts.length + 1);
				parts.push(file);
			},
		});
		for (let i = 1; i <= 5; i++) await sink.add(`${i}.jpg`, bytes(1000, i));
		await sink.add("export-report.csv", new TextEncoder().encode("report"));
		const result = await sink.finish();
		expect(parts.map((p) => p.name)).toEqual([
			"photos-part-1.zip",
			"photos-part-2.zip",
		]);
		expect(result.parts).toBe(3);
		expect(result.files).toBe(6);
		expect(result.file?.name).toBe("photos-part-3.zip");
		const contents = await Promise.all(
			[...parts, result.file as JobFile].map(async (p) =>
				Object.keys(await unzipBlob(p.blob)),
			),
		);
		expect(contents).toEqual([
			["1.jpg", "2.jpg"],
			["3.jpg", "4.jpg"],
			["5.jpg", "export-report.csv"],
		]);
		for (const p of parts) expect(p.blob.size).toBeLessThanOrEqual(2500);
		const total = [...parts, result.file as JobFile].reduce(
			(n, p) => n + p.blob.size,
			0,
		);
		expect(result.bytes).toBe(total);
	});

	it("a file bigger than a part gets a part of its own", async () => {
		const parts: JobFile[] = [];
		const sink = createPartZipSink({
			name: "x",
			partBytes: 100,
			onPart: (f) => parts.push(f),
		});
		await sink.add("big.jpg", bytes(1000));
		await sink.add("small.jpg", bytes(10));
		const result = await sink.finish();
		expect(parts.map((p) => p.name)).toEqual(["x-part-1.zip"]);
		expect(Object.keys(await unzipBlob(parts[0]?.blob as Blob))).toEqual([
			"big.jpg",
		]);
		expect(result.file?.name).toBe("x-part-2.zip");
	});

	it("names a single part after the job", async () => {
		const onPart = vi.fn();
		const sink = createPartZipSink({ name: "cards", onPart });
		await sink.add("1.png", bytes(10));
		const result = await sink.finish();
		expect(onPart).not.toHaveBeenCalled();
		expect(result).toMatchObject({ kind: "download", parts: 1, files: 1 });
		expect(result.file?.name).toBe("cards.zip");
		expect(Object.keys(await unzipBlob(result.file?.blob as Blob))).toEqual([
			"1.png",
		]);
	});

	it("takes nothing after an abort", async () => {
		const sink = createPartZipSink({ name: "x" });
		await sink.add("1.png", bytes(10));
		await sink.abort();
		await expect(sink.add("2.png", bytes(10))).rejects.toThrow(/cancelled/);
	});
});

describe("choosing a destination", () => {
	it("says why a destination is unavailable", () => {
		expect(destinationSupport({})).toEqual({
			download: null,
			"zip-file": expect.stringMatching(/Download/),
			folder: expect.stringMatching(/Download/),
		});
		expect(
			destinationSupport({
				showSaveFilePicker: () => {},
				showDirectoryPicker: () => {},
			}),
		).toEqual({ download: null, "zip-file": null, folder: null });
	});

	it("opens the picker for its destination and falls back to a download", async () => {
		const { folder } = fakeFolder();
		const win = {
			showDirectoryPicker: vi.fn(async () => folder),
			showSaveFilePicker: vi.fn(async () => ({
				createWritable: async () => slowWritable().writable,
			})),
		};
		expect((await openSink("folder", "x", {}, win))?.kind).toBe("folder");
		expect((await openSink("zip-file", "x", {}, win))?.kind).toBe("zip-file");
		expect(win.showSaveFilePicker).toHaveBeenCalledWith(
			expect.objectContaining({ suggestedName: "x.zip" }),
		);
		expect((await openSink("download", "x", {}, win))?.kind).toBe("download");
		expect((await openSink("folder", "x", {}, {}))?.kind).toBe("download");
	});

	it("is null when the picker is dismissed", async () => {
		const win = {
			showDirectoryPicker: async () => {
				throw new DOMException("dismissed", "AbortError");
			},
		};
		expect(await openSink("folder", "x", {}, win)).toBeNull();
	});
});
