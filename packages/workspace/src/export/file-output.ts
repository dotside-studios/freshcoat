import { createWriteStream, type WriteStream } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import type { ExportOutput } from "./run";
import { createStreamZipSink } from "./sink";

/** Writes the export to `path`: a zip as it renders, a PDF once assembled.
 *  A cancelled or failed job leaves no file behind. */
export function fileOutput(path: string): ExportOutput {
	let stream: WriteStream | undefined;
	return {
		sink() {
			stream = createWriteStream(path);
			return createStreamZipSink(
				Writable.toWeb(stream) as WritableStream<Uint8Array>,
			);
		},
		async save(file) {
			await writeFile(path, new Uint8Array(await file.blob.arrayBuffer()));
		},
		async discard() {
			if (stream && !stream.closed)
				await new Promise((done) => stream?.once("close", done));
			await rm(path, { force: true });
		},
	};
}
