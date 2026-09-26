import type { ExportDestination } from "@freshcoat/workspace";
import {
	createZipWriter,
	streamOutput,
	type ZipOutput,
	type ZipWriter,
} from "@freshcoat/workspace";

/** A finished file an export hands to the browser. */
export type JobFile = { blob: Blob; name: string; mediaType: string };

export type SinkResult = {
	kind: ExportDestination;
	/** files added, the report included */
	files: number;
	/** bytes written: the zip's for a zip, the files' for a folder */
	bytes: number;
	/** zip parts made, for a download */
	parts?: number;
	/** the last or only part of a download, still to be handed over */
	file?: JobFile;
};

/**
 * Where an export's files go, one at a time and in order. The job awaits
 * `ready` before it renders more, so a slow destination holds rendering back
 * instead of letting finished files pile up in memory.
 */
export interface OutputSink {
	readonly kind: ExportDestination;
	/** resolves when the sink can take more */
	readonly ready: Promise<void>;
	add(name: string, bytes: Uint8Array): Promise<void>;
	finish(): Promise<SinkResult>;
	/** Stops, keeping what the destination keeps: a folder its files, a
	 *  download the parts already handed over, a zip file nothing. */
	abort(): Promise<void>;
	/** files added so far */
	readonly files: number;
	readonly bytes: number;
}

export const DEFAULT_PART_BYTES = 512 * 1024 * 1024;

const RESOLVED = Promise.resolve();

/** Text compresses; images are already compressed, so they are stored. */
function levelFor(name: string): 0 | 6 {
	return /\.(csv|txt|json)$/i.test(name) ? 6 : 0;
}

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

// ── Zip file ───────────────────────────────────────────────────────────────

/** A zip streamed into a writable, such as a file from `showSaveFilePicker`.
 *  Each write is awaited, so a slow disk holds the job back. Cancelling
 *  aborts the writable, which discards the file. */
export function createStreamZipSink(
	writable: WritableStream<Uint8Array>,
): OutputSink {
	const writer = writable.getWriter();
	const zip = createZipWriter(streamOutput(writer), new Date());
	let files = 0;
	let done = false;
	return {
		kind: "zip-file",
		get ready() {
			return writer.ready;
		},
		get files() {
			return files;
		},
		get bytes() {
			return zip.bytes;
		},
		async add(name, data) {
			await zip.add({ name, data, level: levelFor(name) });
			files++;
		},
		async finish() {
			await zip.end();
			await writer.close();
			done = true;
			return { kind: "zip-file", files, bytes: zip.bytes };
		},
		async abort() {
			if (done) return;
			done = true;
			await writer.abort().catch(() => {});
		},
	};
}

// ── Download, in parts ─────────────────────────────────────────────────────

export type PartZipSinkOptions = {
	/** file name without `.zip` */
	name: string;
	/** a part is finished before it would pass this many bytes */
	partBytes?: number;
	/** a finished part other than the last, to hand over now */
	onPart?: (file: JobFile, index: number) => void;
};

/**
 * Zips in memory, a part at a time. A part that would pass `partBytes` is
 * finished first and handed to `onPart`, then its bytes are let go. The last
 * part comes back from `finish` as `file`: a single part is `<name>.zip`, and
 * several are `<name>-part-1.zip` and on. The job adds its report last, so it
 * is in the last part.
 */
export function createPartZipSink(options: PartZipSinkOptions): OutputSink {
	const limit = options.partBytes ?? DEFAULT_PART_BYTES;
	let chunks: (Uint8Array | Blob)[] = [];
	const output: ZipOutput = {
		async write(part) {
			chunks.push(part);
		},
	};
	const newPart = () => {
		chunks = [];
		return createZipWriter(output, new Date());
	};
	let zip: ZipWriter = newPart();
	let parts = 0;
	let files = 0;
	let written = 0;
	let aborted = false;

	const partName = (index: number) => `${options.name}-part-${index}.zip`;
	const close = async (): Promise<Blob> => {
		await zip.end();
		written += zip.bytes;
		const blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
		chunks = [];
		return blob;
	};

	return {
		kind: "download",
		ready: RESOLVED,
		get files() {
			return files;
		},
		get bytes() {
			return written + zip.bytes;
		},
		async add(name, data) {
			if (aborted) throw new Error("the export was cancelled");
			// a local header, the bytes, and a central directory entry
			const cost = data.length + 2 * (46 + name.length * 3);
			if (zip.entries > 0 && zip.bytes + cost + 22 > limit) {
				parts++;
				const blob = await close();
				options.onPart?.(
					{ blob, name: partName(parts), mediaType: "application/zip" },
					parts,
				);
				zip = newPart();
			}
			await zip.add({ name, data, level: levelFor(name) });
			files++;
		},
		async finish() {
			const index = parts + 1;
			const blob = await close();
			parts = index;
			return {
				kind: "download",
				files,
				bytes: written,
				parts,
				file: {
					blob,
					name: parts === 1 ? `${options.name}.zip` : partName(index),
					mediaType: "application/zip",
				},
			};
		},
		async abort() {
			aborted = true;
			chunks = [];
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
