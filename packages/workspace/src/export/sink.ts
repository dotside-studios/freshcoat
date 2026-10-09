import type { ExportDestination } from "../types";
import {
	createZipWriter,
	streamOutput,
	type ZipOutput,
	type ZipWriter,
} from "../zip-stream";

/** A finished file an export hands back to its host. */
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
	/** `crc` is the bytes' CRC-32 when already known */
	add(name: string, bytes: Uint8Array, crc?: number): Promise<void>;
	finish(): Promise<SinkResult>;
	/** Stops, keeping what the destination keeps: a folder its files, a
	 *  download the parts already handed over, a zip file what its writable
	 *  keeps on abort. */
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

// ── Zip file ───────────────────────────────────────────────────────────────

/** A zip streamed into a writable, such as a file from `showSaveFilePicker`
 *  or `Writable.toWeb(createWriteStream(path))` in Node. Each write is
 *  awaited, so a slow disk holds the job back. Cancelling aborts the
 *  writable: a file from `showSaveFilePicker` is discarded, while a Node
 *  file stream leaves a partial zip for the host to remove. */
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
		async add(name, data, crc) {
			await zip.add({ name, data, level: levelFor(name), crc });
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
		async add(name, data, crc) {
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
			await zip.add({ name, data, level: levelFor(name), crc });
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
