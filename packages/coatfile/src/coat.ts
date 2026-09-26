// The `.coat` package: a template and the bytes it carries, as one zip.
//
//   mimetype                     stored, first: application/x-freshcoat+zip
//   template.json                the template; `assets` entries without `base64`
//   assets/<sha256>.<ext>        one file per carried asset, named by its hash
//
// A template's own JSON can carry its rasters and fonts inline as base64, which
// costs a third in size and a full parse to read anything. The package holds
// the same document with the bytes moved into their own entries. Nothing about
// the template changes: an image still srcs `asset:<sha256>`, and unpacking
// puts the base64 back, so the result validates, compiles and renders exactly
// as the inline form does.
//
// `mimetype` is the first entry and is stored uncompressed, the arrangement
// EPUB and OpenDocument use, so the media type sits at a fixed offset for
// anything that sniffs a file by its leading bytes.

import { strFromU8, strToU8, type Unzipped, unzipSync, zipSync } from "fflate";
import {
	base64ToBytes,
	bytesToBase64,
	rehashAssets,
	type Sha256,
	subtleSha256,
} from "./assets";
import { formatVersionStatus } from "./format";
import { unwrapLegacyBundle } from "./normalize";
import type { InlineAsset, Template } from "./types";

export const COAT_EXTENSION = ".coat";
/** The name a tool writes template JSON under. Plain `.json` still reads; the
 *  compound suffix keeps the file JSON to every editor while letting one match
 *  it by pattern, e.g. to attach the JSON Schema. */
export const COAT_JSON_EXTENSION = ".coat.json";
export const COAT_MEDIA_TYPE = "application/x-freshcoat+zip";
export const COAT_JSON_MEDIA_TYPE = "application/x-freshcoat+json";

/** The package's earlier TemplateKit names. Read, never written. */
export const LEGACY_TKIT_EXTENSION = ".tkit";
export const LEGACY_TKIT_MEDIA_TYPE = "application/vnd.davi.templatekit+zip";

const READABLE_MEDIA_TYPES = new Set([COAT_MEDIA_TYPE, LEGACY_TKIT_MEDIA_TYPE]);

/** What a file input offers: both package names and template JSON. */
export const COAT_FILE_ACCEPT = [
	COAT_EXTENSION,
	LEGACY_TKIT_EXTENSION,
	".json",
	"application/json",
].join(",");

/** Whether a file name reads as a package or template JSON (`.coat.json` and
 *  `.tkit.json` end in `.json`). */
export function isCoatFileName(name: string): boolean {
	return (
		name.endsWith(COAT_EXTENSION) ||
		name.endsWith(LEGACY_TKIT_EXTENSION) ||
		name.endsWith(".json")
	);
}

const MIMETYPE_ENTRY = "mimetype";
const TEMPLATE_ENTRY = "template.json";
const ASSET_DIR = "assets/";

// A package is opened from files people hand each other, so its declared sizes
// are bounded before anything is inflated.
const MAX_ENTRIES = 4096;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

// The earliest time a zip can record. Every entry carries it, so packing the
// same template twice produces the same bytes.
const ZIP_EPOCH = new Date(1980, 0, 1);

const EXTENSION_BY_TYPE: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"image/avif": "avif",
	"image/svg+xml": "svg",
	"font/woff2": "woff2",
	"font/woff": "woff",
	"font/ttf": "ttf",
	"font/otf": "otf",
};

// Already compressed; deflating them again spends time to gain nothing.
const STORED_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
	"font/woff2",
	"font/woff",
]);

export type CoatErrorCode =
	| "newer_format_version"
	| "unsupported_format_version"
	| "invalid_package"
	| "wrong_media_type"
	| "missing_template"
	| "invalid_json"
	| "missing_asset"
	| "asset_hash_mismatch"
	| "package_too_large";

export class CoatError extends Error {
	constructor(
		readonly code: CoatErrorCode,
		message: string,
	) {
		super(message);
		this.name = "CoatError";
	}
}

/** Whether these bytes are a zip, and so a `.coat` rather than template JSON. */
export function isCoatPackage(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

export type PackOptions = { sha256?: Sha256 };

/**
 * Package a template. Each carried asset is re-keyed by the real hash of its
 * bytes first (see `rehashAssets`), since that hash becomes its entry name and
 * `unpackTemplate` checks it.
 *
 * Throws `newer_format_version` for a template from a newer 1.x kit: the
 * template reached this kit through validation, which dropped whatever that
 * minor added, and packaging it would publish the loss.
 */
export async function packTemplate(
	template: Template,
	options: PackOptions = {},
): Promise<Uint8Array> {
	assertWritable(template);

	const { template: keyed } = await rehashAssets(
		template,
		options.sha256 ?? subtleSha256,
	);
	const assets = [...(keyed.assets ?? [])].sort((a, b) =>
		a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0,
	);

	const document: Record<string, unknown> = { ...keyed };
	if (assets.length > 0) {
		document.assets = assets.map(({ sha256, contentType }) => ({
			sha256,
			contentType,
		}));
	} else {
		delete document.assets;
	}

	const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
		[MIMETYPE_ENTRY]: [strToU8(COAT_MEDIA_TYPE), { level: 0 }],
		[TEMPLATE_ENTRY]: [
			strToU8(`${JSON.stringify(document, null, 2)}\n`),
			{ level: 6 },
		],
	};
	for (const asset of assets) {
		entries[assetEntryName(asset)] = [
			base64ToBytes(asset.base64),
			{ level: STORED_TYPES.has(asset.contentType) ? 0 : 6 },
		];
	}
	return zipSync(entries, { mtime: ZIP_EPOCH });
}

/**
 * The template as the text of a `.coat.json` file, assets inline. Refuses a
 * template from a newer 1.x kit for the same reason `packTemplate` does.
 */
export function serializeTemplate(template: Template): string {
	assertWritable(template);
	return `${JSON.stringify(template, null, 2)}\n`;
}

function assertWritable(template: Template): void {
	const status = formatVersionStatus(template.format_version);
	if (status === "newer") {
		throw new CoatError(
			"newer_format_version",
			`format_version ${template.format_version} is newer than this kit writes`,
		);
	}
	if (status === "unsupported") {
		throw new CoatError(
			"unsupported_format_version",
			`format_version ${template.format_version} is not supported`,
		);
	}
}

export type UnpackOptions = { sha256?: Sha256 };

/**
 * The template document a package holds, with each asset's `base64` restored
 * from its entry. Not validated: hand it to `validate` as you would parsed
 * JSON. Throws a `CoatError` when the package itself is wrong: not a zip, a
 * foreign media type, no `template.json`, an asset listed with no entry, or an
 * entry whose bytes do not hash to its name.
 */
export async function unpackTemplate(
	bytes: Uint8Array,
	options: UnpackOptions = {},
): Promise<unknown> {
	const files = unzip(bytes);

	const mimetype = files[MIMETYPE_ENTRY];
	if (
		mimetype !== undefined &&
		!READABLE_MEDIA_TYPES.has(strFromU8(mimetype).trim())
	) {
		throw new CoatError(
			"wrong_media_type",
			`package declares ${strFromU8(mimetype).trim()}, not ${COAT_MEDIA_TYPE}`,
		);
	}

	const templateBytes = files[TEMPLATE_ENTRY];
	if (templateBytes === undefined) {
		throw new CoatError("missing_template", `package has no ${TEMPLATE_ENTRY}`);
	}
	let document: unknown;
	try {
		document = JSON.parse(strFromU8(templateBytes));
	} catch (err) {
		throw new CoatError(
			"invalid_json",
			`${TEMPLATE_ENTRY}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (typeof document !== "object" || document === null) return document;

	const listed = (document as { assets?: unknown }).assets;
	if (!Array.isArray(listed)) return document;

	const bytesByHash = new Map<string, Uint8Array>();
	for (const [name, data] of Object.entries(files)) {
		const sha = assetEntryHash(name);
		if (sha !== null) bytesByHash.set(sha, data);
	}

	const sha256 = options.sha256 ?? subtleSha256;
	const assets: InlineAsset[] = [];
	for (const entry of listed) {
		const { sha256: declared, contentType } = (entry ?? {}) as {
			sha256?: unknown;
			contentType?: unknown;
		};
		if (typeof declared !== "string") {
			throw new CoatError("invalid_package", "asset entry has no sha256");
		}
		const data = bytesByHash.get(declared);
		if (data === undefined) {
			throw new CoatError(
				"missing_asset",
				`asset ${declared} is listed but not in the package`,
			);
		}
		const actual = await sha256(data);
		if (actual !== declared) {
			throw new CoatError(
				"asset_hash_mismatch",
				`asset ${declared} hashes to ${actual}`,
			);
		}
		assets.push({
			sha256: declared,
			base64: bytesToBase64(data),
			contentType:
				typeof contentType === "string"
					? contentType
					: "application/octet-stream",
		});
	}
	return { ...document, assets };
}

export type DecodeResult =
	| {
			ok: true;
			/** The template document, not yet validated. */
			document: unknown;
			/** Whether it arrived as a `.coat` rather than as JSON. */
			packaged: boolean;
	  }
	| { ok: false; code: CoatErrorCode; message: string };

/**
 * Whatever a person handed you, as a template document: a `.coat` or `.tkit`,
 * template JSON as bytes or text, or the wrapper the Figma plugin wrote before
 * it emitted templates directly. The one entry point for reading a file in, so
 * every consumer accepts the same set of shapes. Validation is left to the
 * caller, which may want to heal element ids first.
 */
export async function decodeTemplate(
	input: Uint8Array | string,
	options: UnpackOptions = {},
): Promise<DecodeResult> {
	try {
		if (typeof input !== "string" && isCoatPackage(input)) {
			const document = await unpackTemplate(input, options);
			return { ok: true, document, packaged: true };
		}
		const text =
			typeof input === "string"
				? input
				: new TextDecoder("utf-8").decode(input);
		return {
			ok: true,
			document: unwrapLegacyBundle(JSON.parse(text)),
			packaged: false,
		};
	} catch (err) {
		if (err instanceof CoatError) {
			return { ok: false, code: err.code, message: err.message };
		}
		return {
			ok: false,
			code: "invalid_json",
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

function assetEntryName(asset: InlineAsset): string {
	const ext = EXTENSION_BY_TYPE[asset.contentType];
	return `${ASSET_DIR}${asset.sha256}${ext ? `.${ext}` : ""}`;
}

/** The hash an `assets/` entry is named by, ignoring the cosmetic extension. */
function assetEntryHash(name: string): string | null {
	if (!name.startsWith(ASSET_DIR)) return null;
	const base = name.slice(ASSET_DIR.length);
	if (base.includes("/")) return null;
	const dot = base.indexOf(".");
	const sha = dot === -1 ? base : base.slice(0, dot);
	return sha.length > 0 ? sha : null;
}

function unzip(bytes: Uint8Array): Unzipped {
	let count = 0;
	let total = 0;
	try {
		return unzipSync(bytes, {
			filter(file) {
				count += 1;
				total += file.originalSize;
				if (count > MAX_ENTRIES || total > MAX_UNPACKED_BYTES) {
					throw new CoatError(
						"package_too_large",
						`package exceeds ${MAX_ENTRIES} entries or ${MAX_UNPACKED_BYTES} bytes`,
					);
				}
				return true;
			},
		});
	} catch (err) {
		if (err instanceof CoatError) throw err;
		throw new CoatError(
			"invalid_package",
			`not a readable zip: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
