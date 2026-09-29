// The `.coatworkspace` file: a zip laid out like a `.coat`, with `mimetype`
// first and stored so the media type sits at a fixed offset.
//
//   mimetype                          application/vnd.freshcoat.workspace+zip
//   workspace.json                    the manifest
//   templates/<entryId>.coat          each template exactly as a .coat package
//   data/<datasetId>/schema.json      the columns, as JSON Schema
//   data/<datasetId>/records.json     the records
//   data/<datasetId>/assets/<sha>.<ext>
//
// A template is read from the path its manifest entry names, so a workspace
// written with `templates/<entryId>.tkit` entries opens unchanged.

import {
	healElementIds,
	raiseFormatVersion,
	subtleSha256,
	validate,
} from "@freshcoat-js/coatfile";
import {
	COAT_EXTENSION,
	decodeTemplate,
	packTemplate,
} from "@freshcoat-js/coatfile/coat";
import { parsePrintProfile } from "@freshcoat-js/for-print";
import { strFromU8, strToU8, zipSync } from "fflate";
import { z } from "zod";
import { assetExtension } from "./assets";
import { parseImageInfo } from "./image-info";
import { columnsToJsonSchema, jsonSchemaToColumns } from "./json-schema";
import type {
	Dataset,
	DatasetAsset,
	TemplateEntry,
	UnpackErrorCode,
	UnpackResult,
	Workspace,
} from "./types";
import {
	blobOutput,
	joinChunks,
	readZip,
	streamOutput,
	writeZip,
	type ZipEntry,
	ZipReadError,
} from "./zip-stream";

export const WORKSPACE_EXTENSION = ".coatworkspace";
export const WORKSPACE_MEDIA_TYPE = "application/vnd.freshcoat.workspace+zip";
export const WORKSPACE_FORMAT = "freshcoat.workspace";
export const WORKSPACE_FORMAT_VERSION = "1.0";

const MIMETYPE_ENTRY = "mimetype";
const MANIFEST_ENTRY = "workspace.json";
const MAX_ENTRIES = 50_000;
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;
// The earliest time a zip records, on every entry, so the same workspace
// always packs to the same bytes.
const ZIP_EPOCH = new Date(1980, 0, 1);

const STORED_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
]);

const CellValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);

const FieldSourceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("column"), column: z.string() }),
	z.object({ kind: z.literal("constant"), value: z.string() }),
	z.object({
		kind: z.literal("serial"),
		start: z.number(),
		step: z.number(),
		pad: z.number().int().min(0),
		prefix: z.string().optional(),
		suffix: z.string().optional(),
	}),
]);

const BindingSchema = z.object({
	datasetId: z.string(),
	fields: z.record(z.string(), FieldSourceSchema),
	variant: z
		.discriminatedUnion("kind", [
			z.object({ kind: z.literal("fixed"), id: z.string().optional() }),
			z.object({ kind: z.literal("column"), column: z.string() }),
			z.object({ kind: z.literal("all") }),
		])
		.optional(),
});

const LayoutSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("single") }),
	z.object({
		kind: z.literal("sheet"),
		paper: z.union([
			z.enum(["a4", "letter", "legal", "a3", "tabloid"]),
			z.object({
				widthMm: z.number().positive(),
				heightMm: z.number().positive(),
			}),
		]),
		orientation: z.enum(["portrait", "landscape", "auto"]),
		marginMm: z.number().min(0),
		gapMm: z.number().min(0),
		cropMarks: z.boolean(),
		duplex: z.enum(["none", "long-edge", "short-edge"]),
		backOffsetMm: z.object({ x: z.number(), y: z.number() }).optional(),
		blankBacks: z.boolean().optional(),
	}),
]);

const PresetSchema = z.object({
	id: z.string(),
	name: z.string(),
	templateId: z.string(),
	records: z.enum(["all", "pending", "failed", "selected"]),
	selected: z.array(z.string()).optional(),
	sides: z.union([z.literal("all"), z.array(z.string())]),
	format: z.enum(["png-zip", "jpeg-zip", "webp-zip", "pdf"]),
	size: z
		.discriminatedUnion("kind", [
			z.object({ kind: z.literal("template") }),
			z.object({
				kind: z.literal("image"),
				field: z.string(),
				maxEdge: z.number().int().positive().optional(),
			}),
		])
		.optional(),
	quality: z.number().min(0).max(100).optional(),
	pdfPageImage: z.enum(["png", "jpeg"]).optional(),
	destination: z.enum(["download", "zip-file", "folder"]).optional(),
	scale: z.number().min(1).max(4),
	dpi: z.number().positive(),
	fileName: z.string(),
	markExported: z.boolean(),
	print: z
		.object({
			enabled: z.boolean(),
			analyze: z.boolean().optional(),
			// Refused rather than dropped: a preset that quietly lost its
			// printer's correction would print cards nobody could account for.
			profile: z
				.unknown()
				.transform((value, ctx) => {
					const profile = parsePrintProfile(value);
					if (profile instanceof Error) {
						ctx.addIssue({ code: "custom", message: profile.message });
						return z.NEVER;
					}
					return profile;
				})
				.optional(),
		})
		.optional(),
	layout: LayoutSchema.optional(),
	bleed: z.boolean().optional(),
});

const GuidesSchema = z.record(
	z.string(),
	z.object({
		x: z.array(z.number().finite()),
		y: z.array(z.number().finite()),
	}),
);

const ManifestSchema = z.object({
	format: z.literal(WORKSPACE_FORMAT),
	formatVersion: z.string(),
	name: z.string(),
	templates: z
		.array(
			z.object({
				id: z.string(),
				fileName: z.string(),
				path: z.string(),
				binding: BindingSchema.optional(),
				guides: GuidesSchema.optional(),
			}),
		)
		.min(1),
	datasets: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			schema: z.string(),
			records: z.string(),
			assets: z.array(
				z.object({
					sha256: z.string(),
					contentType: z.string(),
					name: z.string(),
					path: z.string(),
				}),
			),
		}),
	),
	presets: z.array(PresetSchema),
});

export type WorkspaceManifest = z.infer<typeof ManifestSchema>;

const RecordsSchema = z.array(
	z.object({
		id: z.string(),
		status: z.enum(["pending", "exported", "failed", "skipped"]),
		exportedAt: z.string().optional(),
		error: z.string().optional(),
		values: z.record(z.string(), CellValueSchema),
	}),
);

function json(value: unknown): Uint8Array {
	return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function assetPath(dataset: Dataset, asset: DatasetAsset): string {
	return `data/${dataset.id}/assets/${asset.sha256}.${assetExtension(asset.contentType)}`;
}

function bySha(a: DatasetAsset, b: DatasetAsset): number {
	return a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0;
}

type Entries = Record<string, [Uint8Array, { level: 0 | 6 }]>;

function templatePath(entry: TemplateEntry): string {
	return `templates/${entry.id}${COAT_EXTENSION}`;
}

function manifestOf(ws: Workspace): WorkspaceManifest {
	return {
		format: WORKSPACE_FORMAT,
		formatVersion: WORKSPACE_FORMAT_VERSION,
		name: ws.name,
		templates: ws.templates.map((entry) => ({
			id: entry.id,
			fileName: entry.fileName,
			path: templatePath(entry),
			...(entry.binding !== undefined ? { binding: entry.binding } : {}),
			...(entry.guides !== undefined ? { guides: entry.guides } : {}),
		})),
		datasets: ws.datasets.map((dataset) => ({
			id: dataset.id,
			name: dataset.name,
			schema: `data/${dataset.id}/schema.json`,
			records: `data/${dataset.id}/records.json`,
			assets: dataset.assets.map((asset) => ({
				sha256: asset.sha256,
				contentType: asset.contentType,
				name: asset.name,
				path: assetPath(dataset, asset),
			})),
		})),
		presets: ws.presets,
	};
}

async function* workspaceEntries(ws: Workspace): AsyncGenerator<ZipEntry> {
	yield {
		name: MIMETYPE_ENTRY,
		data: strToU8(WORKSPACE_MEDIA_TYPE),
		level: 0,
	};
	yield { name: MANIFEST_ENTRY, data: json(manifestOf(ws)), level: 6 };
	for (const entry of ws.templates) {
		yield {
			name: templatePath(entry),
			data: await packTemplate(raiseFormatVersion(entry.template)),
			level: 0,
		};
	}
	for (const dataset of ws.datasets) {
		yield {
			name: `data/${dataset.id}/schema.json`,
			data: json(columnsToJsonSchema(dataset)),
			level: 6,
		};
		yield {
			name: `data/${dataset.id}/records.json`,
			data: json(
				dataset.records.map((r) => ({
					id: r.id,
					status: r.status,
					...(r.exportedAt !== undefined ? { exportedAt: r.exportedAt } : {}),
					...(r.error !== undefined ? { error: r.error } : {}),
					values: r.values,
				})),
			),
			level: 6,
		};
		for (const asset of [...dataset.assets].sort(bySha)) {
			yield {
				name: assetPath(dataset, asset),
				data: asset.blob,
				level: STORED_TYPES.has(asset.contentType) ? 0 : 6,
			};
		}
	}
}

/**
 * The workspace as a `.coatworkspace`. With a sink, the zip is streamed into
 * it an entry at a time and the sink is closed at the end; without one, it
 * comes back as a Blob that refers to the assets' own Blobs rather than
 * copying them. The same workspace always gives the same bytes.
 */
export function packWorkspace(ws: Workspace): Promise<Blob>;
export function packWorkspace(
	ws: Workspace,
	sink: WritableStream<Uint8Array>,
): Promise<undefined>;
export async function packWorkspace(
	ws: Workspace,
	sink?: WritableStream<Uint8Array>,
): Promise<Blob | undefined> {
	if (sink === undefined) {
		const out = blobOutput();
		await writeZip(workspaceEntries(ws), out, ZIP_EPOCH);
		return out.blob(WORKSPACE_MEDIA_TYPE);
	}
	const writer = sink.getWriter();
	try {
		await writeZip(workspaceEntries(ws), streamOutput(writer), ZIP_EPOCH);
		await writer.close();
	} catch (err) {
		await writer.abort(err).catch(() => {});
		throw err;
	} finally {
		writer.releaseLock();
	}
	return undefined;
}

class UnpackError extends Error {
	constructor(
		readonly code: UnpackErrorCode,
		message: string,
	) {
		super(message);
	}
}

/** The small entries, as bytes, and each asset as a Blob of its own. */
type ReadEntries = {
	files: Map<string, Uint8Array>;
	assets: Map<string, Blob>;
};

function isAssetPath(path: string): boolean {
	return /^data\/[^/]+\/assets\/[^/]+$/.test(path);
}

async function readEntries(source: Blob): Promise<ReadEntries> {
	const files = new Map<string, Uint8Array>();
	const assets = new Map<string, Blob>();
	try {
		await readZip(source, {
			maxEntries: MAX_ENTRIES,
			maxBytes: MAX_UNPACKED_BYTES,
			onFile(name, chunks) {
				if (isAssetPath(name)) assets.set(name, new Blob(chunks as BlobPart[]));
				else files.set(name, joinChunks(chunks));
			},
		});
	} catch (err) {
		if (err instanceof ZipReadError)
			throw new UnpackError(err.reason, err.message);
		throw new UnpackError(
			"not_a_zip",
			`not a readable zip: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return { files, assets };
}

function entry(read: ReadEntries, path: string): Uint8Array {
	const data = read.files.get(path);
	if (data === undefined) {
		throw new UnpackError("missing_entry", `${path} is missing`);
	}
	return data;
}

function parseJsonEntry(read: ReadEntries, path: string): unknown {
	const text = strFromU8(entry(read, path));
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new UnpackError(
			path === MANIFEST_ENTRY ? "invalid_manifest" : "invalid_entry",
			`${path}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

function readManifest(read: ReadEntries): {
	manifest: WorkspaceManifest;
	warnings: string[];
} {
	if (!read.files.has(MANIFEST_ENTRY)) {
		throw new UnpackError("missing_manifest", `${MANIFEST_ENTRY} is missing`);
	}
	const raw = parseJsonEntry(read, MANIFEST_ENTRY);
	const warnings: string[] = [];
	const version = (raw as { formatVersion?: unknown } | null)?.formatVersion;
	if (typeof version === "string") {
		const [major, minor] = version.split(".").map(Number);
		if (major !== undefined && major > 1) {
			throw new UnpackError(
				"newer_version",
				`format ${version} is newer than this version of Freshcoat reads`,
			);
		}
		if (minor !== undefined && minor > 0) {
			warnings.push(
				`Saved by a newer Freshcoat (format ${version}); anything it added was dropped`,
			);
		}
	}
	const parsed = ManifestSchema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new UnpackError(
			"invalid_manifest",
			`${MANIFEST_ENTRY}: ${issue ? `${issue.path.join(".")} ${issue.message}` : "invalid"}`,
		);
	}
	return { manifest: parsed.data, warnings };
}

async function readTemplate(
	read: ReadEntries,
	item: WorkspaceManifest["templates"][number],
	warnings: string[],
): Promise<TemplateEntry> {
	const decoded = await decodeTemplate(entry(read, item.path));
	if (!decoded.ok) {
		throw new UnpackError(
			decoded.code === "asset_hash_mismatch"
				? "asset_hash_mismatch"
				: "invalid_template",
			`${item.path}: ${decoded.message}`,
		);
	}
	let result = validate(decoded.document);
	if (!result.ok) {
		const healed = validate(healElementIds(decoded.document));
		if (!healed.ok) {
			const first = result.errors[0];
			throw new UnpackError(
				"invalid_template",
				`${item.fileName}: ${first ? `${first.path} ${first.message}` : "invalid"}`,
			);
		}
		warnings.push(`${item.fileName}: renamed duplicate element ids`);
		result = healed;
	}
	return {
		id: item.id,
		fileName: item.fileName,
		template: result.value,
		...(item.binding !== undefined ? { binding: item.binding } : {}),
		...(item.guides !== undefined ? { guides: item.guides } : {}),
	};
}

async function readAsset(
	read: ReadEntries,
	asset: WorkspaceManifest["datasets"][number]["assets"][number],
): Promise<DatasetAsset> {
	const stored = read.assets.get(asset.path);
	if (stored === undefined) {
		throw new UnpackError("missing_entry", `${asset.path} is missing`);
	}
	const bytes = new Uint8Array(await stored.arrayBuffer());
	const actual = await subtleSha256(bytes);
	if (actual !== asset.sha256) {
		throw new UnpackError(
			"asset_hash_mismatch",
			`${asset.path} hashes to ${actual}`,
		);
	}
	const info = parseImageInfo(bytes);
	return {
		sha256: asset.sha256,
		contentType: asset.contentType,
		name: asset.name,
		size: bytes.length,
		...(info
			? {
					width: info.width,
					height: info.height,
					...(info.orientation !== undefined
						? { orientation: info.orientation }
						: {}),
				}
			: {}),
		blob: new Blob([stored], { type: asset.contentType }),
	};
}

async function readDataset(
	read: ReadEntries,
	item: WorkspaceManifest["datasets"][number],
	warnings: string[],
): Promise<Dataset> {
	const schema = jsonSchemaToColumns(parseJsonEntry(read, item.schema));
	for (const warning of schema.warnings) {
		warnings.push(`${item.name}: ${warning}`);
	}
	const records = RecordsSchema.safeParse(parseJsonEntry(read, item.records));
	if (!records.success) {
		throw new UnpackError(
			"invalid_entry",
			`${item.records}: ${records.error.issues[0]?.message ?? "invalid"}`,
		);
	}
	const assets: DatasetAsset[] = [];
	for (const asset of item.assets) {
		assets.push(await readAsset(read, asset));
		read.assets.delete(asset.path);
	}
	return {
		id: item.id,
		name: item.name,
		columns: schema.columns,
		records: records.data,
		assets,
	};
}

/** A `.coatworkspace` read back, or the reason it cannot be. The file is
 *  read as a stream, and each photo in it becomes a Blob of its own. */
export async function unpackWorkspace(
	file: Blob | Uint8Array,
): Promise<UnpackResult> {
	try {
		const read = await readEntries(
			file instanceof Blob ? file : new Blob([file as BlobPart]),
		);
		const mimetype = read.files.get(MIMETYPE_ENTRY);
		const declared = mimetype === undefined ? "" : strFromU8(mimetype).trim();
		if (declared !== WORKSPACE_MEDIA_TYPE) {
			throw new UnpackError(
				"wrong_mimetype",
				declared === ""
					? "not a Freshcoat workspace: no mimetype"
					: `not a Freshcoat workspace: ${declared}`,
			);
		}
		const { manifest, warnings } = readManifest(read);
		const templates: TemplateEntry[] = [];
		for (const item of manifest.templates) {
			templates.push(await readTemplate(read, item, warnings));
		}
		const datasets: Dataset[] = [];
		for (const item of manifest.datasets) {
			datasets.push(await readDataset(read, item, warnings));
		}
		return {
			ok: true,
			workspace: {
				formatVersion: WORKSPACE_FORMAT_VERSION,
				name: manifest.name,
				templates,
				datasets,
				presets: manifest.presets,
			},
			warnings,
		};
	} catch (err) {
		if (err instanceof UnpackError) {
			return { ok: false, code: err.code, message: err.message };
		}
		return {
			ok: false,
			code: "invalid_entry",
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

/** A template's file name without its extension: `.coat`, `.coat.json`, the
 *  legacy `.tkit` and `.tkit.json`, or plain `.json`. */
export function templateStem(fileName: string): string {
	return fileName.replace(/\.(coat\.json|coat|tkit\.json|tkit|json)$/i, "");
}

/** A file name safe inside a zip, with any template extension removed. */
function templateFileStem(fileName: string): string {
	const stem = templateStem(fileName)
		.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-")
		.trim();
	return stem === "" || /^\.+$/.test(stem) ? "template" : stem;
}

/** Every template as `templates/<fileName>.coat`, in one zip. */
export async function packTemplates(ws: Workspace): Promise<Uint8Array> {
	const entries: Entries = {};
	const used = new Set<string>();
	for (const entry of ws.templates) {
		const stem = templateFileStem(entry.fileName);
		let name = stem;
		for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}-${n}`;
		used.add(name.toLowerCase());
		entries[`templates/${name}${COAT_EXTENSION}`] = [
			await packTemplate(raiseFormatVersion(entry.template)),
			{ level: 0 },
		];
	}
	return zipSync(entries, { mtime: ZIP_EPOCH });
}
