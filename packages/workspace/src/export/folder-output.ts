import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createFolderSink, type FolderHandle } from "./folder-sink";
import type { ExportOutput } from "./run";

/** A folder on disk as a `FolderHandle`, created on the first write. */
function diskFolder(dir: string): FolderHandle {
	let made: Promise<unknown> | undefined;
	return {
		name: basename(dir),
		async getFileHandle(name) {
			made ??= mkdir(dir, { recursive: true });
			await made;
			const path = join(dir, name);
			return {
				async createWritable() {
					const file = await open(path, "w");
					return {
						async write(data) {
							await file.writeFile(data);
						},
						async close() {
							await file.close();
						},
						async abort() {
							await file.close().catch(() => {});
							await rm(path, { force: true });
						},
					};
				},
			};
		},
	};
}

/** Writes the export into `dir`, one file per item and the report, as each
 *  renders; a PDF goes in once assembled. Cancelling keeps what was written,
 *  as a folder in Studio does. */
export function folderOutput(dir: string): ExportOutput {
	return {
		sink() {
			return createFolderSink(diskFolder(dir));
		},
		async save(file) {
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, file.name),
				new Uint8Array(await file.blob.arrayBuffer()),
			);
		},
	};
}
