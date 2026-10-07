import type { ExportDestination } from "@freshcoat-js/workspace";
import {
	createPartZipSink,
	createStreamZipSink,
	type OutputSink,
	type PartZipSinkOptions,
} from "@freshcoat-js/workspace/export";

const RESOLVED = Promise.resolve();

// ── Folder ─────────────────────────────────────────────────────────────────

/** The parts of the File System Access API a folder sink uses, so tests can
 *  hand it fakes. */
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

// ── Choosing a destination ─────────────────────────────────────────────────

type PickerWindow = {
	showDirectoryPicker?: (options?: {
		id?: string;
		mode?: "readwrite";
	}) => Promise<FolderHandle>;
	showSaveFilePicker?: (options?: {
		id?: string;
		suggestedName?: string;
		types?: { description: string; accept: Record<string, string[]> }[];
	}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;
};

/** Which destinations this browser can write to, with why not when it
 *  cannot. */
export function destinationSupport(
	win: unknown = typeof window !== "undefined" ? window : undefined,
): Record<ExportDestination, string | null> {
	const w = (win ?? {}) as PickerWindow;
	return {
		download: null,
		"zip-file":
			typeof w.showSaveFilePicker === "function"
				? null
				: "Not supported in this browser, use Download",
		folder:
			typeof w.showDirectoryPicker === "function"
				? null
				: "Not supported in this browser, use Download",
	};
}

function isAbort(e: unknown): boolean {
	return e instanceof DOMException && e.name === "AbortError";
}

/**
 * Asks for the destination and opens a sink on it. Call it straight from the
 * click: the pickers need the user's gesture. Resolves null when the picker
 * is dismissed. A destination the browser lacks falls back to a download.
 */
export async function openSink(
	destination: ExportDestination,
	name: string,
	options: Omit<PartZipSinkOptions, "name"> = {},
	win: unknown = typeof window !== "undefined" ? window : undefined,
): Promise<OutputSink | null> {
	const w = (win ?? {}) as PickerWindow;
	try {
		if (destination === "folder" && w.showDirectoryPicker) {
			const folder = await w.showDirectoryPicker({
				id: "freshcoat-export",
				mode: "readwrite",
			});
			return createFolderSink(folder);
		}
		if (destination === "zip-file" && w.showSaveFilePicker) {
			const file = await w.showSaveFilePicker({
				id: "freshcoat-export",
				suggestedName: `${name}.zip`,
				types: [
					{ description: "Zip file", accept: { "application/zip": [".zip"] } },
				],
			});
			return createStreamZipSink(await file.createWritable());
		}
	} catch (e) {
		if (isAbort(e)) return null;
		throw e;
	}
	return createPartZipSink({ name, ...options });
}
