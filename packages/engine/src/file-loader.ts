import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ByteLoader, fetchLoader } from "./loader";

export type FileLoaderOptions = {
	// Directory relative paths resolve against, and outside of which nothing is
	// read. Default: the current working directory.
	root?: string;
	// Where non-file URLs go. Default: fetchLoader.
	next?: ByteLoader;
};

const URL_SCHEME = /^[a-z][a-z\d+.-]+:/i;

/** Reads paths and file: URLs under `root`, and passes other URLs to `next`. */
export function fileLoader(opts?: FileLoaderOptions): ByteLoader {
	const root = resolve(opts?.root ?? process.cwd());
	const next = opts?.next ?? fetchLoader;
	return async (src) => {
		if (src.startsWith("file:")) return read(root, fileURLToPath(src));
		if (URL_SCHEME.test(src)) return next(src);
		return read(root, resolve(root, src));
	};
}

async function read(root: string, path: string): Promise<Uint8Array> {
	const rel = relative(root, path);
	if (rel.startsWith("..") || isAbsolute(rel))
		throw new Error(`"${path}" is outside the loader root "${root}"`);
	const buf = await readFile(path);
	return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
