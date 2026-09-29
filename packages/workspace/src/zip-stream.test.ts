import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { jpegHeader } from "./image-fixtures";
import { blobOutput, createZipWriter } from "./zip-stream";

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
		}
	});

	it("refuses entries after the end", async () => {
		const writer = createZipWriter(blobOutput(), MTIME);
		await writer.end();
		await expect(
			writer.add({ name: "x", data: new Uint8Array(1), level: 0 }),
		).rejects.toThrow(/finished/);
	});
});
