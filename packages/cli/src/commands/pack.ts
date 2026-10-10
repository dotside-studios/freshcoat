import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import {
	assetUri,
	attachAssets,
	mapAssetSrcs,
	mediaType,
	type PendingAsset,
	raiseFormatVersion,
	subtleSha256,
	type Template,
} from "@freshcoat-js/coatfile";
import {
	CoatError,
	packTemplate,
	pruneUnusedAssets,
	serializeTemplate,
} from "@freshcoat-js/coatfile/coat";
import { fileLoader } from "@freshcoat-js/engine/node";
import { packTemplates, WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { CliError, createLog, type Io, type Log } from "../io";
import { readTemplate } from "../template-file";
import { readWorkspace } from "../workspace-file";
import { isLocalImage } from "./render";

export type PackOptions = { out: string; template?: string; quiet: boolean };

export async function pack(file: string, options: PackOptions, io: Io): Promise<void> {
	const log = createLog(io, options.quiet);
	const out = options.out;
	let bytes: Uint8Array | string;
	if (file.toLowerCase().endsWith(WORKSPACE_EXTENSION)) {
		const { workspace } = await readWorkspace(io, file);
		if (options.template === undefined) {
			if (!/\.zip$/i.test(out))
				throw new CliError("a workspace packs into a .zip, or one template with --template", 2);
			bytes = await packTemplates(workspace);
		} else {
			const wanted = options.template;
			const entry = workspace.templates.find(
				(t) => t.id === wanted || t.fileName === wanted || t.template.id === wanted,
			);
			if (!entry)
				throw new CliError(
					`no template "${wanted}"; the workspace has ${workspace.templates.map((t) => t.fileName).join(", ")}`,
				);
			bytes = await encode(entry.template, out);
		}
	} else {
		if (options.template !== undefined)
			throw new CliError("--template needs a .coatworkspace file", 2);
		const { template, directory } = await readTemplate(io, file);
		bytes = await encode(await embedImages(template, directory, log), out);
	}
	const path = resolve(io.cwd, out);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, bytes);
	log.out(out);
}

async function encode(template: Template, out: string): Promise<Uint8Array | string> {
	const writable = raiseFormatVersion(pruneUnusedAssets(template));
	const json = /\.json$/i.test(out);
	if (!json && extname(out).toLowerCase() !== ".coat")
		throw new CliError("--out names a .coat or .coat.json file", 2);
	try {
		return json ? serializeTemplate(writable) : await packTemplate(writable);
	} catch (error) {
		if (error instanceof CoatError) throw new CliError(error.message);
		throw error;
	}
}

async function embedImages(
	template: Template,
	directory: string,
	log: Log,
): Promise<Template> {
	const sources = new Set<string>();
	mapAssetSrcs(template, new Map(), (src) => {
		if (typeof src === "string" && isLocalImage(src) && !src.startsWith("asset:") && !src.includes("{{"))
			sources.add(src);
		return src;
	});
	const load = fileLoader({ root: directory });
	const uris = new Map<string, string>();
	const pending: PendingAsset[] = [];
	for (const src of sources) {
		const contentType = mediaType(extname(src).slice(1));
		if (!contentType) {
			log.warn(`${src}: not an image type a package carries; its path is kept`);
			continue;
		}
		let bytes: Uint8Array;
		try {
			bytes = await load(src);
		} catch {
			log.warn(`${src}: cannot be read; its path is kept`);
			continue;
		}
		const sha256 = await subtleSha256(bytes);
		uris.set(src, assetUri(sha256));
		pending.push({ sha256, contentType, blob: new Blob([bytes.slice()]) });
	}
	if (pending.length === 0) return template;
	const rewritten = mapAssetSrcs(template, new Map(), (src) =>
		typeof src === "string" ? (uris.get(src) ?? src) : src,
	);
	return attachAssets(rewritten, pending);
}
