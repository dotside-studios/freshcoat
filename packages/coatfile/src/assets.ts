// Inline assets and the `asset:` URI scheme.
//
// An image element can src `asset:<sha256>` instead of a URL. The matching
// entry in the template's optional `assets` array holds those bytes, so the
// template is self-contained: `compile()` resolves `asset:` srcs against
// `assets`, and the template renders without anything having been uploaded.
//
//   authored ──▶ Template + assets ──▶ render()
//                       │
//                       └──▶ upload ──▶ detachAssets() ──▶ Template with URLs
//
// `detachAssets` is the step that ends that state: it swaps each `asset:` src
// for its uploaded URL and drops `assets`.

import { base64ToBytes, bytesToBase64 } from "@freshcoat-js/engine";
import type { InlineAsset, Template } from "./types";

export { base64ToBytes, bytesToBase64 };

export const ASSET_URI_PREFIX = "asset:";

/** Mint the `asset:` src for a raster with this content hash. */
export function assetUri(sha256: string): string {
	return `${ASSET_URI_PREFIX}${sha256}`;
}

/** The sha256 an `asset:` src refers to, or null for anything else (an https
 *  URL, a data URI, a `{{field}}` token, a non-string). */
export function parseAssetUri(src: unknown): string | null {
	if (typeof src !== "string" || !src.startsWith(ASSET_URI_PREFIX)) return null;
	return src.slice(ASSET_URI_PREFIX.length);
}

/** An in-memory raster: what an inline asset decodes to, and what a producer
 *  holds before it encodes one. */
export type PendingAsset = {
	sha256: string;
	blob: Blob;
	contentType: string;
};

// ── Encoding ─────────────────────────────────────────────────────────────────

/** The `data:` URL for an inline asset. */
export function assetDataUri(asset: InlineAsset): string {
	return `${dataPrefix(asset)}${asset.base64}`;
}

// ── Producer / consumer sides ────────────────────────────────────────────────

/** Carry these rasters inside the template. Assets already present are kept,
 *  and a sha256 is embedded once however many elements reference it. */
export async function attachAssets(
	template: Template,
	pendingAssets: PendingAsset[],
): Promise<Template> {
	const assets: InlineAsset[] = [...(template.assets ?? [])];
	const seen = new Set(assets.map((a) => a.sha256));
	for (const a of pendingAssets) {
		if (seen.has(a.sha256)) continue;
		seen.add(a.sha256);
		const bytes = new Uint8Array(await a.blob.arrayBuffer());
		assets.push({
			sha256: a.sha256,
			base64: bytesToBase64(bytes),
			contentType: a.contentType,
		});
	}
	if (assets.length === 0) return template;
	return { ...template, assets };
}

/** Decode the carried rasters back to blobs — what an uploader needs. */
export function readAssets(template: Template): PendingAsset[] {
	return (template.assets ?? []).map((a) => ({
		sha256: a.sha256,
		blob: new Blob([base64ToBytes(a.base64).buffer as ArrayBuffer], {
			type: a.contentType,
		}),
		contentType: a.contentType,
	}));
}

/**
 * Swap every `asset:` src for its uploaded URL and drop the carried bytes.
 *
 * Throws `unresolved_asset: <sha>` if the map is missing a hash the template
 * still references, rather than emit a template that has silently lost an
 * image.
 */
export function detachAssets(
	template: Template,
	urlByHash: Map<string, string>,
): Template {
	const rewritten = mapAssetSrcs(template, urlByHash, strictRewrite);
	if (rewritten.assets === undefined) return rewritten;
	const { assets: _dropped, ...rest } = rewritten;
	return rest as Template;
}

/** sha256 → `data:` URL for everything the template carries. The map
 *  `compile()` resolves `asset:` srcs against. */
export function inlineAssetUrls(template: Template): Map<string, string> {
	const out = new Map<string, string>();
	for (const asset of template.assets ?? []) {
		out.set(asset.sha256, assetDataUri(asset));
	}
	return out;
}

/** The inverse of `inlineAssetUrls`: the `asset:` URI for a `data:` URL
 *  `compile()` gave one of the template's assets, else undefined. */
export function inlinedAssetUri(
	template: Template,
): (src: string) => string | undefined {
	const keys = new Map<string, InlineAsset[]>();
	for (const asset of template.assets ?? []) {
		const prefix = dataPrefix(asset);
		const length = prefix.length + asset.base64.length;
		const key = sampleKey(length, (i) =>
			i < prefix.length
				? prefix.charCodeAt(i)
				: asset.base64.charCodeAt(i - prefix.length),
		);
		keys.set(key, [...(keys.get(key) ?? []), asset]);
	}
	return (src) => {
		const key = sampleKey(src.length, (i) => src.charCodeAt(i));
		const asset = keys
			.get(key)
			?.find(
				(a) =>
					src.length === dataPrefix(a).length + a.base64.length &&
					src.startsWith(dataPrefix(a)) &&
					src.endsWith(a.base64),
			);
		return asset ? assetUri(asset.sha256) : undefined;
	};
}

const dataPrefix = (asset: InlineAsset) => `data:${asset.contentType};base64,`;

const SAMPLES = 32;

// A short key for a long string: its length and a spread of its characters.
// Lookups confirm the match, so equal keys only cost a comparison.
function sampleKey(length: number, charAt: (i: number) => number): string {
	let key = `${length}:`;
	if (length === 0) return key;
	for (let i = 0; i < SAMPLES; i++)
		key += String.fromCharCode(
			charAt(Math.floor((i * (length - 1)) / (SAMPLES - 1))),
		);
	return key;
}

/** Every sha256 the template still references through `asset:`. The set an
 *  uploader has to resolve before `detachAssets` will succeed. */
export function collectAssetRefs(template: Template): Set<string> {
	const out = new Set<string>();
	mapAssetSrcs(template, new Map(), (src) => {
		const sha = parseAssetUri(src);
		if (sha !== null) out.add(sha);
		return src;
	});
	return out;
}

// ── Src rewriting ────────────────────────────────────────────────────────────

/** Rewrite one `src`, given a sha256 → URL map. */
export type AssetSrcRewriter = (
	src: unknown,
	urlByHash: Map<string, string>,
) => unknown;

// An image can sit anywhere in a frame's element tree, not just at a side's top
// level — a raster nested in a frame is still an image whose `asset:` src has to
// resolve. Missing those leaves the src unrewritten (the painter reports the
// bare `asset:` uri as a load failure) and, through collectAssetRefs, leaves the
// bytes out of a bundle that needs them.
function rewriteElement(
	el: unknown,
	urlByHash: Map<string, string>,
	rewrite: AssetSrcRewriter,
): unknown {
	if (typeof el !== "object" || el === null) return el;
	const node = el as {
		type?: string;
		properties?: { src?: unknown; children?: unknown; mask?: unknown };
	};
	if (node.properties === undefined) return el;

	if (node.type === "frame" || node.type === "mask") {
		const children = node.properties.children;
		if (!Array.isArray(children)) return el;
		let changed = false;
		const next = children.map((child) => {
			const rewritten = rewriteElement(child, urlByHash, rewrite);
			if (rewritten !== child) changed = true;
			return rewritten;
		});
		// A mask's shape can itself be an image, whose alpha is the coverage.
		const mask =
			node.type === "mask"
				? rewriteElement(node.properties.mask, urlByHash, rewrite)
				: node.properties.mask;
		if (mask !== node.properties.mask) changed = true;
		if (!changed) return el;
		return {
			...node,
			properties: {
				...node.properties,
				children: next,
				...(node.type === "mask" ? { mask } : {}),
			},
		};
	}

	if (node.type !== "image") return el;
	const newSrc = rewrite(node.properties.src, urlByHash);
	if (newSrc === node.properties.src) return el;
	return { ...node, properties: { ...node.properties, src: newSrc } };
}

// A variant's element override is a `{ id, properties }` delta, not a full
// element with a `type`, so `rewriteElement`'s image-type gate would skip it.
// Rewrite an `asset:` `properties.src` on the delta directly — a colorway that
// swaps an image element carries its own raster that must resolve just like a
// template_data image.
function rewriteOverrideElement(
	el: unknown,
	urlByHash: Map<string, string>,
	rewrite: AssetSrcRewriter,
): unknown {
	if (typeof el !== "object" || el === null) return el;
	const node = el as { properties?: { src?: unknown } };
	if (node.properties === undefined) return el;
	const newSrc = rewrite(node.properties.src, urlByHash);
	if (newSrc === node.properties.src) return el;
	return { ...node, properties: { ...node.properties, src: newSrc } };
}

/** Every place a template can carry an image src: each frame's background and
 *  elements, plus each variant override's background and element deltas. */
export function mapAssetSrcs(
	template: Template,
	urlByHash: Map<string, string>,
	rewrite: AssetSrcRewriter,
): Template {
	const td = (
		template as unknown as {
			template_data: Array<{ background: unknown; elements: unknown[] }>;
		}
	).template_data;
	const newTd = td.map((frame) => ({
		...frame,
		background: rewriteElement(frame.background, urlByHash, rewrite),
		elements: frame.elements.map((el) =>
			rewriteElement(el, urlByHash, rewrite),
		),
	}));

	const variants = (
		template as unknown as {
			variants?: Array<{
				overrides: Array<{
					name: string;
					background?: unknown;
					elements?: unknown[];
				}>;
			}>;
		}
	).variants;
	const newVariants = variants?.map((v) => ({
		...v,
		overrides: v.overrides.map((o) => ({
			...o,
			...(o.background !== undefined
				? { background: rewriteElement(o.background, urlByHash, rewrite) }
				: {}),
			...(o.elements !== undefined
				? {
						elements: o.elements.map((el) =>
							rewriteOverrideElement(el, urlByHash, rewrite),
						),
					}
				: {}),
		})),
	}));

	return {
		...template,
		template_data: newTd,
		...(newVariants !== undefined ? { variants: newVariants } : {}),
	} as Template;
}

const strictRewrite: AssetSrcRewriter = (src, urlByHash) => {
	const sha = parseAssetUri(src);
	if (sha === null) return src;
	const resolved = urlByHash.get(sha);
	if (resolved === undefined) throw new Error(`unresolved_asset: ${sha}`);
	return resolved;
};

const lenientRewrite: AssetSrcRewriter = (src, urlByHash) => {
	const sha = parseAssetUri(src);
	if (sha === null) return src;
	return urlByHash.get(sha) ?? src;
};

/** Replace every `asset:` src with its mapped URL, leaving an unresolved one in
 *  place. Use on preview paths, where a raster that has not been uploaded yet
 *  should degrade to a missing image rather than blank the whole canvas. */
export function resolveAssetSrcs(
	template: Template,
	urlByHash: Map<string, string>,
): Template {
	return mapAssetSrcs(template, urlByHash, lenientRewrite);
}

// ── Content hashes ───────────────────────────────────────────────────────────
//
// An asset's `sha256` is its address, and until something checks it nothing
// says it is the hash of the bytes beside it. A template written by hand, or by
// a tool that keyed its rasters some other way, still renders: `compile()` only
// needs the key to match between the src and the `assets` entry. These are for
// the places where the key has to mean what it says, like a `.coat` package
// whose entries are named by it.

/** Hex sha256 of some bytes. Injected because `crypto.subtle` exists only in a
 *  secure context, and a Figma plugin's iframe is not one. */
export type Sha256 = (bytes: Uint8Array) => string | Promise<string>;

export const subtleSha256: Sha256 = async (bytes) => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		bytes as Uint8Array<ArrayBuffer>,
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
};

export type AssetHashMismatch = { declared: string; actual: string };

/** The carried assets whose bytes do not hash to their declared `sha256`. */
export async function verifyAssets(
	template: Template,
	sha256: Sha256 = subtleSha256,
): Promise<AssetHashMismatch[]> {
	const out: AssetHashMismatch[] = [];
	for (const asset of template.assets ?? []) {
		const actual = await sha256(base64ToBytes(asset.base64));
		if (actual !== asset.sha256) out.push({ declared: asset.sha256, actual });
	}
	return out;
}

/**
 * Re-key every carried asset by the real hash of its bytes, and point every
 * `asset:` src that used the old key at the new one: image srcs through
 * `mapAssetSrcs`, and `local` font files. Two entries whose bytes turn out to
 * be the same collapse into one. The picture does not change.
 *
 * An asset whose `sha256` is in `known` is taken as already hashed from its
 * bytes and is not hashed again.
 */
export async function rehashAssets(
	template: Template,
	sha256: Sha256 = subtleSha256,
	known: ReadonlySet<string> = new Set(),
): Promise<{ template: Template; renamed: Map<string, string> }> {
	const renamed = new Map<string, string>();
	const assets: InlineAsset[] = [];
	const seen = new Set<string>();
	for (const asset of template.assets ?? []) {
		const actual = known.has(asset.sha256)
			? asset.sha256
			: await sha256(base64ToBytes(asset.base64));
		if (actual !== asset.sha256) renamed.set(asset.sha256, actual);
		if (seen.has(actual)) continue;
		seen.add(actual);
		assets.push(actual === asset.sha256 ? asset : { ...asset, sha256: actual });
	}
	if (renamed.size === 0 && assets.length === (template.assets ?? []).length) {
		return { template, renamed };
	}

	const rekey: AssetSrcRewriter = (src) => {
		const sha = parseAssetUri(src);
		if (sha === null) return src;
		const next = renamed.get(sha);
		return next === undefined ? src : assetUri(next);
	};
	const rewritten = mapAssetSrcs(template, new Map(), rekey);
	const fonts = rewritten.fonts?.map((font) =>
		font.kind === "local"
			? {
					...font,
					files: font.files.map((file) => ({
						...file,
						src: rekey(file.src, new Map()) as string,
					})),
				}
			: font,
	);
	return {
		template: {
			...rewritten,
			...(fonts !== undefined ? { fonts } : {}),
			assets,
		},
		renamed,
	};
}
