import type { OutputSink } from "./sink";

const RESOLVED = Promise.resolve();

/** The parts of the File System Access API a folder sink uses, so tests and
 *  Node can hand it their own. */
export type WritableFile = {
	write(data: Uint8Array): Promise<void>;
	close(): Promise<void>;
	abort?(reason?: unknown): Promise<void>;
};
export type FolderHandle = {
	name?: string;
	getFileHandle(
		name: string,
		options: { create: true },
	): Promise<{ createWritable(): Promise<WritableFile> }>;
};

/** Writes each file into a folder as it is made. Cancelling keeps what was
 *  written; a file half written when it happens is discarded. */
export function createFolderSink(folder: FolderHandle): OutputSink {
	let files = 0;
	let bytes = 0;
	let current: WritableFile | null = null;
	let aborted = false;
	return {
		kind: "folder",
		ready: RESOLVED,
		get files() {
			return files;
		},
		get bytes() {
			return bytes;
		},
		async add(name, data) {
			if (aborted) throw new Error("the export was cancelled");
			const handle = await folder.getFileHandle(name, { create: true });
			const file = await handle.createWritable();
			current = file;
			try {
				await file.write(data);
				await file.close();
			} catch (e) {
				await file.abort?.(e).catch(() => {});
				throw e;
			} finally {
				current = null;
			}
			files++;
			bytes += data.length;
		},
		async finish() {
			return { kind: "folder", files, bytes };
		},
		async abort() {
			aborted = true;
			await current?.abort?.().catch(() => {});
		},
	};
}
