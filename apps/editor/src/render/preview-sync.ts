import type { InlineAsset, Template } from "@freshcoat-js/coatfile";
import type { LiveRequest } from "./live-frame";

/**
 * What changed since the last request the worker was sent. A field left out
 * is the one it already holds: the template goes over when its identity
 * changes, without its assets, and each asset, font file and photo goes over
 * once, for as long as something still uses it.
 */
export type PreviewUpdate = {
	side: number;
	variantId?: string;
	density: number;
	template?: Template;
	/** The template's assets by sha256, in order; null when it has none. */
	assets?: string[] | null;
	newAssets?: InlineAsset[];
	blobs?: [id: number, bytes: Uint8Array][];
	fonts?: [family: string, ids: number[]][];
	photos?: [ref: string, id: number][];
	hidden?: string[];
	values?: Record<string, unknown>;
};

/** The main thread's half: turns each request into the update the worker
 *  needs, remembering what it already sent. */
export function createPreviewSender() {
	const ids = new WeakMap<Uint8Array, number>();
	let nextId = 1;
	let sentBlobs = new Set<number>();
	let sentAssets = new Set<string>();
	let last: {
		template: Template;
		assets: InlineAsset[] | undefined;
		fonts: Map<string, Uint8Array[]>;
		photos: Map<string, Uint8Array>;
		hidden: ReadonlySet<string>;
		values: Record<string, unknown>;
		fontIds: [string, number[]][];
		photoIds: [string, number][];
	} | null = null;

	const idOf = (bytes: Uint8Array) => {
		let id = ids.get(bytes);
		if (id === undefined) {
			id = nextId++;
			ids.set(bytes, id);
		}
		return id;
	};

	return {
		encode(request: LiveRequest): PreviewUpdate {
			const { template, fonts, photos, hidden, values } = request;
			const update: PreviewUpdate = {
				side: request.side,
				density: request.density,
				...(request.variantId !== undefined
					? { variantId: request.variantId }
					: {}),
			};
			if (last?.template !== template) {
				const { assets: _assets, ...rest } = template;
				update.template = rest;
			}
			if (!last || last.assets !== template.assets) {
				const assets = template.assets;
				update.assets = assets ? assets.map((a) => a.sha256) : null;
				const fresh = (assets ?? []).filter((a) => !sentAssets.has(a.sha256));
				if (fresh.length > 0) update.newAssets = fresh;
				sentAssets = new Set(update.assets);
			}
			let fontIds = last?.fontIds ?? [];
			let photoIds = last?.photoIds ?? [];
			if (last?.fonts !== fonts) {
				fontIds = [...fonts].map(([family, files]) => [
					family,
					files.map(idOf),
				]);
				update.fonts = fontIds;
			}
			if (last?.photos !== photos) {
				photoIds = [...photos].map(([ref, bytes]) => [ref, idOf(bytes)]);
				update.photos = photoIds;
			}
			if (update.fonts || update.photos) {
				const used = new Map<number, Uint8Array>();
				for (const [, files] of fonts)
					for (const bytes of files) used.set(idOf(bytes), bytes);
				for (const bytes of photos.values()) used.set(idOf(bytes), bytes);
				const blobs = [...used].filter(([id]) => !sentBlobs.has(id));
				if (blobs.length > 0) update.blobs = blobs;
				sentBlobs = new Set(used.keys());
			}
			if (last?.hidden !== hidden) update.hidden = [...hidden];
			if (last?.values !== values) update.values = values;
			last = {
				template,
				assets: template.assets,
				fonts,
				photos,
				hidden,
				values,
				fontIds,
				photoIds,
			};
			return update;
		},
	};
}

/** The worker's half: rebuilds the request from the updates, keeping the
 *  identity of every part that did not change, so the caches keyed on them
 *  hold. */
export function createPreviewReceiver() {
	const blobs = new Map<number, Uint8Array>();
	const assets = new Map<string, InlineAsset>();
	let bare: Template | undefined;
	let assetList: InlineAsset[] | undefined;
	let template: Template | undefined;
	let fontIds: [string, number[]][] = [];
	let photoIds: [string, number][] = [];
	let fonts = new Map<string, Uint8Array[]>();
	let photos = new Map<string, Uint8Array>();
	let hidden: ReadonlySet<string> = new Set();
	let values: Record<string, unknown> = {};

	const blob = (id: number) => {
		const bytes = blobs.get(id);
		if (!bytes) throw new Error(`preview: no bytes for #${id}`);
		return bytes;
	};

	return {
		apply(update: PreviewUpdate): LiveRequest {
			for (const asset of update.newAssets ?? [])
				assets.set(asset.sha256, asset);
			if (update.assets !== undefined) {
				const list = update.assets;
				assetList = list?.map((sha) => {
					const asset = assets.get(sha);
					if (!asset) throw new Error(`preview: no asset ${sha}`);
					return asset;
				});
				const keep = new Set(list);
				for (const sha of assets.keys()) if (!keep.has(sha)) assets.delete(sha);
			}
			if (update.template) bare = update.template;
			if (!bare) throw new Error("preview: no template");
			if (update.template || update.assets !== undefined)
				template = assetList ? { ...bare, assets: assetList } : bare;

			for (const [id, bytes] of update.blobs ?? []) blobs.set(id, bytes);
			if (update.fonts) {
				fontIds = update.fonts;
				fonts = new Map(
					fontIds.map(([family, ids]) => [family, ids.map(blob)]),
				);
			}
			if (update.photos) {
				photoIds = update.photos;
				photos = new Map(photoIds.map(([ref, id]) => [ref, blob(id)]));
			}
			if (update.fonts || update.photos) {
				const used = new Set([
					...fontIds.flatMap(([, ids]) => ids),
					...photoIds.map(([, id]) => id),
				]);
				for (const id of blobs.keys()) if (!used.has(id)) blobs.delete(id);
			}
			if (update.hidden) hidden = new Set(update.hidden);
			if (update.values) values = update.values;

			return {
				template: template as Template,
				side: update.side,
				...(update.variantId !== undefined
					? { variantId: update.variantId }
					: {}),
				hidden,
				values,
				fonts,
				photos,
				density: update.density,
			};
		},
	};
}
