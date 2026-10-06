import { subtleSha256 } from "@freshcoat-js/coatfile";
import { newRecord } from "./columns";
import { newId } from "./ids";
import { orientedSize, readImageInfo } from "./image-info";
import type { CellValue, Column, Dataset, DatasetAsset } from "./types";
import { readZip } from "./zip-stream";

export const ASSET_REF_PREFIX = "ws:";

export type AssetFile = {
	/** the file's name; any folder in front of it is dropped */
	name: string;
	blob: Blob;
	contentType?: string;
};

/** An asset ready to add, with what its header said that the asset itself
 *  does not keep. */
export type PreparedAsset = {
	asset: DatasetAsset;
	/** EXIF DateTimeOriginal, "2024-05-01T13:22:10" */
	takenAt?: string;
};

export type AddAssetsOptions = {
	/** Add one record per photo no image cell names and no record already
	 *  shows, with the photo in this image column. */
	appendUnmatched?: { column: string };
};

export type AddAssetsResult = {
	dataset: Dataset;
	/** assets that were not in the dataset before */
	added: number;
	/** image cells rewritten to a `ws:` reference */
	rewritten: number;
	/** files no image cell names */
	unmatched: string[];
	/** records added for unmatched photos */
	appended: number;
};

const TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	avif: "image/avif",
	svg: "image/svg+xml",
};

const EXTENSION_BY_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/avif": "avif",
	"image/svg+xml": "svg",
};

export function assetRef(sha256: string): string {
	return `${ASSET_REF_PREFIX}${sha256}`;
}

/** The sha256 a `ws:` cell refers to, or null for anything else. */
export function parseAssetRef(value: unknown): string | null {
	if (typeof value !== "string" || !value.startsWith(ASSET_REF_PREFIX)) {
		return null;
	}
	const sha = value.slice(ASSET_REF_PREFIX.length);
	return sha.length > 0 ? sha : null;
}

export async function sha256Hex(data: Uint8Array | Blob): Promise<string> {
	return subtleSha256(
		data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data,
	);
}

export function assetExtension(contentType: string): string {
	return EXTENSION_BY_TYPE[contentType] ?? "bin";
}

/** The media type of an image, from its leading bytes, then its name. */
export function imageContentType(name: string, bytes?: Uint8Array): string {
	if (bytes !== undefined) {
		const sniffed = sniffImage(bytes);
		if (sniffed !== null) return sniffed;
	}
	return TYPE_BY_EXTENSION[extensionOf(name)] ?? "application/octet-stream";
}

function sniffImage(b: Uint8Array): string | null {
	const at = (i: number, ...values: number[]) =>
		values.every((v, j) => b[i + j] === v);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
		return "image/webp";
	}
	if (at(4, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66)) {
		return "image/avif";
	}
	return null;
}

function extensionOf(name: string): string {
	const base = baseName(name);
	const dot = base.lastIndexOf(".");
	return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

function baseName(name: string): string {
	const parts = name.split(/[\\/]/);
	return parts[parts.length - 1] ?? name;
}

function stem(name: string): string {
	const base = baseName(name);
	const dot = base.lastIndexOf(".");
	return dot <= 0 ? base : base.slice(0, dot);
}

type AssetIndex = {
	count: number;
	byBaseName: Map<string, DatasetAsset>;
	byStem: Map<string, DatasetAsset>;
	shas: Set<string>;
};

const assetIndexes = new WeakMap<readonly DatasetAsset[], AssetIndex>();

function assetIndex(assets: readonly DatasetAsset[]): AssetIndex {
	const cached = assetIndexes.get(assets);
	if (cached !== undefined && cached.count === assets.length) return cached;
	const byBaseName = new Map<string, DatasetAsset>();
	const byStem = new Map<string, DatasetAsset>();
	const shas = new Set<string>();
	for (const a of assets) {
		const base = baseName(a.name).toLowerCase();
		if (!byBaseName.has(base)) byBaseName.set(base, a);
		const s = stem(a.name).toLowerCase();
		if (!byStem.has(s)) byStem.set(s, a);
		shas.add(a.sha256);
	}
	const index = { count: assets.length, byBaseName, byStem, shas };
	assetIndexes.set(assets, index);
	return index;
}

/** The asset an image cell names by file name: case-insensitive, with or
 *  without its extension, ignoring any folder in front of it. */
export function findAssetByName(
	assets: readonly DatasetAsset[],
	value: string,
): DatasetAsset | undefined {
	const wanted = baseName(value.trim()).toLowerCase();
	if (wanted === "") return undefined;
	const index = assetIndex(assets);
	return index.byBaseName.get(wanted) ?? index.byStem.get(wanted);
}

export function hasAssetSha(
	assets: readonly DatasetAsset[],
	sha256: string,
): boolean {
	return assetIndex(assets).shas.has(sha256);
}

export function assetForRef(
	dataset: Pick<Dataset, "assets">,
	ref: unknown,
): DatasetAsset | undefined {
	const sha = parseAssetRef(ref);
	return sha === null
		? undefined
		: dataset.assets.find((a) => a.sha256 === sha);
}

/** Files a folder or a zip carries that nobody put there on purpose: hidden
 *  files, macOS resource forks and Windows thumbnail caches. */
export function isHiddenPath(path: string): boolean {
	if (path.startsWith("__MACOSX/")) return true;
	const base = baseName(path).toLowerCase();
	return (
		base.startsWith(".") ||
		base === "thumbs.db" ||
		base === "desktop.ini" ||
		path.split(/[\\/]/).some((part) => part.startsWith("."))
	);
}

export type ZipPhotos = {
	files: AssetFile[];
	/** entries that were hidden or not images */
	skipped: number;
};

/** Every image file in a zip, each as a Blob of its own, skipping folders
 *  and the metadata macOS and Windows add beside them. The zip is read as a
 *  stream, so it is never in memory whole. */
export async function filesFromZip(zip: Blob | Uint8Array): Promise<ZipPhotos> {
	const files: AssetFile[] = [];
	let skipped = 0;
	await readZip(zip instanceof Blob ? zip : new Blob([zip as BlobPart]), {
		filter(path) {
			if (path.endsWith("/")) return false;
			if (isHiddenPath(path)) {
				skipped += 1;
				return false;
			}
			return true;
		},
		onFile(path, chunks) {
			const base = baseName(path);
			const contentType = imageContentType(base, chunks[0]);
			if (!contentType.startsWith("image/")) {
				skipped += 1;
				return;
			}
			files.push({
				name: base,
				blob: new Blob(chunks as BlobPart[], { type: contentType }),
				contentType,
			});
		},
	});
	return { files, skipped };
}

/** One file as an asset: hashed, typed and measured from its header. */
export async function prepareAsset(file: AssetFile): Promise<PreparedAsset> {
	const [sha256, info] = await Promise.all([
		sha256Hex(file.blob),
		readImageInfo(file.blob),
	]);
	let contentType = file.contentType ?? info?.contentType;
	if (contentType === undefined) {
		const head = new Uint8Array(await file.blob.slice(0, 16).arrayBuffer());
		contentType = imageContentType(file.name, head);
	}
	const asset: DatasetAsset = {
		sha256,
		contentType,
		name: baseName(file.name),
		size: file.blob.size,
		blob: file.blob,
	};
	if (info) {
		asset.width = info.width;
		asset.height = info.height;
		if (info.orientation !== undefined) asset.orientation = info.orientation;
	}
	return info?.takenAt !== undefined
		? { asset, takenAt: info.takenAt }
		: { asset };
}

export type PrepareOptions = {
	/** files read at once; two keeps peak memory at two files */
	concurrency?: number;
	onProgress?: (done: number, total: number) => void;
	signal?: AbortSignal;
};

/** Every file as an asset, in the order given, reading a few at a time. */
export async function prepareAssets(
	files: readonly AssetFile[],
	opts: PrepareOptions = {},
): Promise<PreparedAsset[]> {
	const out: PreparedAsset[] = new Array(files.length);
	let next = 0;
	let done = 0;
	const worker = async () => {
		while (next < files.length) {
			opts.signal?.throwIfAborted();
			const i = next++;
			out[i] = await prepareAsset(files[i] as AssetFile);
			done += 1;
			opts.onProgress?.(done, files.length);
		}
	};
	const lanes = Math.max(1, Math.min(opts.concurrency ?? 2, files.length));
	await Promise.all(Array.from({ length: lanes }, worker));
	return out;
}

/**
 * Add image files to a dataset, keyed by the sha256 of their bytes, and point
 * every image cell that names one of them at it. A file whose bytes are
 * already an asset is not added twice, but cells naming it still resolve.
 */
export async function addAssets(
	dataset: Dataset,
	files: readonly AssetFile[],
	opts: AddAssetsOptions = {},
): Promise<AddAssetsResult> {
	return addPreparedAssets(dataset, await prepareAssets(files), opts);
}

/** `addAssets` for files already hashed and measured. */
export function addPreparedAssets(
	dataset: Dataset,
	prepared: readonly PreparedAsset[],
	opts: AddAssetsOptions = {},
): AddAssetsResult {
	const assets = [...dataset.assets];
	const known = new Set(assets.map((a) => a.sha256));
	const incoming = prepared.map((p) => p.asset);
	let added = 0;
	for (const asset of incoming) {
		if (known.has(asset.sha256)) continue;
		known.add(asset.sha256);
		assets.push(asset);
		added += 1;
	}

	const imageKeys = dataset.columns
		.filter((c) => c.type === "image")
		.map((c) => c.key);
	const used = new Set<string>();
	const shown = new Set<string>();
	let rewritten = 0;
	const records = dataset.records.map((record) => {
		let values: Record<string, CellValue> | null = null;
		for (const key of imageKeys) {
			const value = record.values[key];
			if (typeof value !== "string") continue;
			const ref = parseAssetRef(value);
			if (ref !== null) {
				shown.add(ref);
				continue;
			}
			const match = findAssetByName(incoming, value);
			if (match === undefined) continue;
			values ??= { ...record.values };
			values[key] = assetRef(match.sha256);
			used.add(match.sha256);
			rewritten += 1;
		}
		return values === null ? record : { ...record, values };
	});

	let appended = 0;
	const column = opts.appendUnmatched?.column;
	if (column !== undefined && imageKeys.includes(column)) {
		for (const p of prepared) {
			const sha = p.asset.sha256;
			if (used.has(sha) || shown.has(sha)) continue;
			shown.add(sha);
			records.push(
				newRecord(dataset.columns, {
					...photoValues(dataset.columns, p),
					[column]: assetRef(sha),
				}),
			);
			appended += 1;
		}
	}

	return {
		dataset: { ...dataset, assets, records },
		added,
		rewritten,
		unmatched: incoming.filter((a) => !used.has(a.sha256)).map((a) => a.name),
		appended,
	};
}

/** The columns a dataset made from photos has. */
export const PHOTO_COLUMNS: readonly Column[] = [
	{ key: "photo", title: "Photo", type: "image" },
	{ key: "file_name", title: "File name", type: "text" },
	{ key: "width", title: "Width", type: "integer" },
	{ key: "height", title: "Height", type: "integer" },
	{ key: "taken_at", title: "Taken", type: "date" },
];

/** What a photo says about itself, for whichever of the photo columns a
 *  dataset has with the type they are made with. Width and height are as
 *  the photo is seen, after its EXIF orientation. */
function photoValues(
	columns: readonly Column[],
	p: PreparedAsset,
): Record<string, CellValue> {
	const size =
		p.asset.width !== undefined && p.asset.height !== undefined
			? orientedSize({
					width: p.asset.width,
					height: p.asset.height,
					orientation: p.asset.orientation,
				})
			: undefined;
	const facts: Record<string, CellValue> = {
		file_name: p.asset.name,
		width: size?.width ?? null,
		height: size?.height ?? null,
		taken_at: p.takenAt?.slice(0, 10) ?? null,
	};
	const out: Record<string, CellValue> = {};
	for (const spec of PHOTO_COLUMNS) {
		if (spec.key === "photo") continue;
		const column = columns.find((c) => c.key === spec.key);
		const value = facts[spec.key];
		if (column?.type === spec.type && value !== null && value !== undefined)
			out[spec.key] = value;
	}
	return out;
}

/** A new dataset with one record per photo: the photo, its file name, its
 *  size as seen and the day it was taken. The same bytes twice are one
 *  photo. */
export function photoDataset(
	name: string,
	prepared: readonly PreparedAsset[],
	id: string = newId("d"),
): Dataset {
	const empty: Dataset = {
		id,
		name,
		columns: PHOTO_COLUMNS.map((c) => ({ ...c })),
		records: [],
		assets: [],
	};
	return addPreparedAssets(empty, prepared, {
		appendUnmatched: { column: "photo" },
	}).dataset;
}
