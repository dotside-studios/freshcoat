import { describe, expect, it } from "vitest";
import {
	createFolderSink,
	type FolderHandle,
	type WritableFile,
} from "./folder-sink";

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

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
