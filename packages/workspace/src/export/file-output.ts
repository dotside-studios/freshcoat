import { createWriteStream, type WriteStream } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import type { ExportOutput } from "./run";
import { createStreamZipSink } from "./sink";

export type FileOutput = ExportOutput & {
	/** where the export is written until it replaces `path` */
	readonly temporary: string;
};

/** Writes the export to a temporary file beside `path`, a zip as it renders
 *  and a PDF once assembled, and renames it over `path` once the job
 *  succeeds. A cancelled or failed job removes only the temporary file. */
export function fileOutput(path: string): FileOutput {
	const temporary = `${path}.${process.pid}.tmp`;
	let stream: WriteStream | undefined;
	let written = false;
	const closed = async () => {
		if (stream && !stream.closed)
			await new Promise((done) => stream?.once("close", done));
	};
	return {
		temporary,
		sink() {
			written = true;
			stream = createWriteStream(temporary);
			return createStreamZipSink(
				Writable.toWeb(stream) as WritableStream<Uint8Array>,
			);
		},
		async save(file) {
			written = true;
			await writeFile(temporary, new Uint8Array(await file.blob.arrayBuffer()));
		},
		async commit() {
			await closed();
			if (written) await rename(temporary, path);
			written = false;
		},
		async discard() {
			await closed();
			if (written) await rm(temporary, { force: true });
			written = false;
		},
	};
}
