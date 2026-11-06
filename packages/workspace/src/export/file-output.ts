import { randomUUID } from "node:crypto";
import {
	createWriteStream,
	lstatSync,
	readlinkSync,
	realpathSync,
	type WriteStream,
} from "node:fs";
import { chmod, open, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import type { ExportOutput } from "./run";
import { createStreamZipSink } from "./sink";

export type FileOutput = ExportOutput & {
	/** where the export is written until it replaces `path` */
	readonly temporary: string;
};

const MAX_LINKS = 40;

const loop = (path: string) =>
	new Error(`${path} is a symlink loop, so it cannot be written`);

const code = (err: unknown) => (err as NodeJS.ErrnoException).code;

/** The file `path` names: through its links, or the missing file at the end
 *  of a dangling chain. Throws for a symlink loop. */
function realPath(path: string): string {
	try {
		return realpathSync(path);
	} catch (err) {
		if (code(err) === "ELOOP") throw loop(path);
	}
	let current = path;
	for (let hops = 0; hops <= MAX_LINKS; hops++) {
		try {
			if (!lstatSync(current).isSymbolicLink()) return current;
		} catch {
			return current;
		}
		current = resolve(dirname(current), readlinkSync(current));
	}
	throw loop(path);
}

/** Writes the export to a temporary file beside `path`, a zip as it renders
 *  and a PDF once assembled, and renames it over `path` once the job
 *  succeeds. When `path` is a symlink, the file it points to is replaced and
 *  the link kept, and a dangling link's target is created. Throws for a
 *  symlink loop. An existing file's mode carries over. A cancelled or failed
 *  job removes only the temporary file. */
export function fileOutput(path: string): FileOutput {
	const target = realPath(path);
	const temporary = `${target}.${randomUUID()}.tmp`;
	let stream: WriteStream | undefined;
	let owned = false;
	const closed = async () => {
		if (stream && !stream.closed)
			await new Promise((done) => stream?.once("close", done));
	};
	return {
		temporary,
		sink() {
			stream = createWriteStream(temporary, { flags: owned ? "w" : "wx" });
			stream.once("open", () => {
				owned = true;
			});
			return createStreamZipSink(
				Writable.toWeb(stream) as WritableStream<Uint8Array>,
			);
		},
		async save(file) {
			const data = new Uint8Array(await file.blob.arrayBuffer());
			const handle = await open(temporary, owned ? "w" : "wx");
			owned = true;
			try {
				await handle.writeFile(data);
			} finally {
				await handle.close();
			}
		},
		async commit() {
			await closed();
			if (owned) {
				const existing = await stat(target).catch(() => undefined);
				if (existing) await chmod(temporary, existing.mode & 0o7777);
				await rename(temporary, target);
			}
			owned = false;
		},
		async discard() {
			await closed();
			if (owned) await rm(temporary, { force: true });
			owned = false;
		},
	};
}
