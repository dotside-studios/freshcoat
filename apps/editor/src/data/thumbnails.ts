import {
	type DatasetAsset,
	orientedSize,
	parseAssetRef,
} from "@freshcoat-js/workspace";
import { useEffect, useMemo, useState } from "react";
import { Lru } from "./lru";
import type { ThumbnailReply, ThumbnailRequest } from "./thumbnail-worker";

// Every surface that shows a photo in a grid, a list or a cell editor shows a
// thumbnail from here, and the live previews take their photos at preview
// resolution from here, so no full-size photo is decoded on the main thread.

export type ThumbWidth = 160 | 320 | 640;

export const THUMBNAIL_LIMITS = {
	entries: 600,
	bytes: 64 * 1024 * 1024,
	previews: 8,
	previewEdge: 4096,
} as const;

/** What turns a photo into a smaller encoded one. The default is a module
 *  worker; tests and browsers without OffscreenCanvas get the photo back. */
export type ThumbnailBackend = (
	request: Omit<ThumbnailRequest, "id">,
) => Promise<Blob>;

let backend: ThumbnailBackend | null = null;

/** Replaces how thumbnails are made, and forgets every one made so far. */
export function setThumbnailBackend(next: ThumbnailBackend | null): void {
	backend = next;
	thumbs.clear();
	previews.clear();
	pending.clear();
	stack.length = 0;
	making.clear();
}

function canUseWorker(): boolean {
	return (
		typeof Worker !== "undefined" &&
		typeof OffscreenCanvas !== "undefined" &&
		typeof createImageBitmap !== "undefined"
	);
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const replies = new Map<
	number,
	{ resolve: (b: Blob) => void; reject: (e: Error) => void }
>();

function workerBackend(request: Omit<ThumbnailRequest, "id">): Promise<Blob> {
	if (workerBroken || !canUseWorker()) return Promise.resolve(request.blob);
	if (!worker) {
		worker = new Worker(new URL("./thumbnail-worker.ts", import.meta.url), {
			type: "module",
		});
		worker.onmessage = (event: MessageEvent<ThumbnailReply>) => {
			const reply = event.data;
			const waiter = replies.get(reply.id);
			replies.delete(reply.id);
			if (!waiter) return;
			if (reply.ok) waiter.resolve(reply.blob);
			else waiter.reject(new Error(reply.error));
		};
		worker.onerror = () => {
			workerBroken = true;
			for (const waiter of replies.values())
				waiter.reject(new Error("the thumbnail worker failed"));
			replies.clear();
			worker?.terminate();
			worker = null;
		};
	}
	const id = nextId++;
	return new Promise<Blob>((resolve, reject) => {
		replies.set(id, { resolve, reject });
		worker?.postMessage({ ...request, id } satisfies ThumbnailRequest);
	});
}

function make(request: Omit<ThumbnailRequest, "id">): Promise<Blob> {
	return (backend ?? workerBackend)(request);
}

function seenSize(asset: DatasetAsset): { width?: number; height?: number } {
	if (asset.width === undefined || asset.height === undefined) return {};
	return orientedSize({
		width: asset.width,
		height: asset.height,
		orientation: asset.orientation,
	});
}

// ── Thumbnails ────────────────────────────────────────────────────────────

type Thumb = { url: string; bytes: number };

const thumbs = new Lru<string, Thumb>({
	maxEntries: THUMBNAIL_LIMITS.entries,
	maxSize: THUMBNAIL_LIMITS.bytes,
	sizeOf: (t) => t.bytes,
	onEvict: (_key, t) => {
		if (t.url) URL.revokeObjectURL(t.url);
	},
});

type Job = {
	key: string;
	asset: DatasetAsset;
	width: ThumbWidth;
	waiters: Set<(url: string) => void>;
};

/** Waiting to be made, oldest first. */
const pending = new Map<string, Job>();
/** The order of `pending`, newest on top. An entry no longer in `pending`
 *  under its key is stale and skipped. */
const stack: Job[] = [];
/** Being made. A request for one of these waits for it rather than making
 *  it again: a second copy would replace the first in the cache, and that
 *  revokes the URL a surface may still be showing. */
const making = new Map<string, Job>();
let inFlight = 0;
/** Two at a time: each one holds a decoded photo while it scales. */
const MAX_IN_FLIGHT = 2;

function keyOf(asset: DatasetAsset, width: number): string {
	return `${asset.sha256}@${width}`;
}

function objectUrl(blob: Blob): string {
	return typeof URL.createObjectURL === "function"
		? URL.createObjectURL(blob)
		: "";
}

function enqueue(job: Job): void {
	pending.set(job.key, job);
	stack.push(job);
	if (stack.length > 64 && stack.length > pending.size * 2)
		stack.splice(0, stack.length, ...pending.values());
}

/** The newest request first: what was just scrolled into view. */
function nextJob(): Job | undefined {
	for (let job = stack.pop(); job; job = stack.pop())
		if (pending.get(job.key) === job) return job;
	return undefined;
}

function pump(): void {
	while (inFlight < MAX_IN_FLIGHT && pending.size > 0) {
		const job = nextJob();
		if (!job) break;
		pending.delete(job.key);
		if (job.waiters.size === 0) continue;
		inFlight += 1;
		making.set(job.key, job);
		const size = seenSize(job.asset);
		make({ blob: job.asset.blob, kind: "thumb", maxWidth: job.width, ...size })
			.catch(() => job.asset.blob)
			.then((blob) => {
				// Cleared by a backend change while it was made: nobody asked
				// this cache for it.
				if (making.get(job.key) !== job) return;
				const thumb = { url: objectUrl(blob), bytes: blob.size };
				thumbs.set(job.key, thumb);
				for (const waiter of job.waiters) waiter(thumb.url);
			})
			.finally(() => {
				if (making.get(job.key) === job) making.delete(job.key);
				inFlight -= 1;
				pump();
			});
	}
}

const WIDTHS: readonly ThumbWidth[] = [160, 320, 640];

/** A thumbnail made already at `width` or wider: a surface that asks for a
 *  small one after another showed a large one reuses it. */
function cached(asset: DatasetAsset, width: ThumbWidth): Thumb | undefined {
	for (const w of WIDTHS) {
		if (w < width) continue;
		const hit = thumbs.get(keyOf(asset, w));
		if (hit) return hit;
	}
	return undefined;
}

/** The thumbnail's object URL if it is made already, at `width` or wider. */
export function peekThumbnail(
	asset: DatasetAsset,
	width: ThumbWidth = 160,
): string | undefined {
	return cached(asset, width)?.url;
}

/**
 * Asks for a thumbnail at most `width` pixels wide and calls back with its
 * object URL. The returned function withdraws the request; one nobody waits
 * for any more is never made.
 */
export function requestThumbnail(
	asset: DatasetAsset,
	width: ThumbWidth,
	onUrl: (url: string) => void,
): () => void {
	const key = keyOf(asset, width);
	const hit = cached(asset, width);
	if (hit) {
		onUrl(hit.url);
		return () => {};
	}
	const busy = making.get(key);
	if (busy) {
		const waiter = (url: string) => onUrl(url);
		busy.waiters.add(waiter);
		return () => {
			busy.waiters.delete(waiter);
		};
	}
	let job = pending.get(key);
	if (job) {
		// Asked again: move it to the front of the line.
		pending.delete(key);
	} else {
		job = { key, asset, width, waiters: new Set() };
	}
	enqueue(job);
	const waiter = (url: string) => onUrl(url);
	const queued = job;
	queued.waiters.add(waiter);
	pump();
	return () => {
		queued.waiters.delete(waiter);
		// Scrolled away before it was made: nobody is waiting, so it leaves
		// the line rather than waiting in it.
		if (queued.waiters.size === 0 && pending.get(key) === queued)
			pending.delete(key);
	};
}

export function thumbnailUrl(
	asset: DatasetAsset,
	width: ThumbWidth = 160,
): Promise<string> {
	return new Promise((resolve) => requestThumbnail(asset, width, resolve));
}

/** The object URL of a thumbnail, once it is made. */
export function useThumbnail(
	asset: DatasetAsset | undefined,
	width: ThumbWidth = 160,
): string | undefined {
	const [url, setUrl] = useState<{ key: string; url: string } | null>(null);
	const key = asset ? keyOf(asset, width) : "";
	useEffect(() => {
		if (!asset) return;
		return requestThumbnail(asset, width, (next) =>
			setUrl({ key: keyOf(asset, width), url: next }),
		);
	}, [asset, width]);
	if (!asset) return undefined;
	if (url?.key === key) return url.url || undefined;
	return peekThumbnail(asset, width) || undefined;
}

/** How many thumbnails are held, and their encoded bytes: for tests. */
export function thumbnailStats(): { entries: number; bytes: number } {
	return { entries: thumbs.size, bytes: thumbs.totalSize };
}

// ── Preview resolution ────────────────────────────────────────────────────

const previews = new Lru<string, Promise<Uint8Array>>({
	maxEntries: THUMBNAIL_LIMITS.previews,
});

/** The long edge a live preview's photos are decoded at: the larger of the
 *  window and 2048, in device pixels, and never above 4096. */
export function previewEdge(
	viewport: { width: number; height: number },
	dpr: number,
): number {
	const long = Math.max(viewport.width, viewport.height, 2048);
	return Math.min(THUMBNAIL_LIMITS.previewEdge, Math.ceil(long * dpr));
}

const DECODABLE = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
]);

async function loadPreview(
	asset: DatasetAsset,
	maxEdge: number,
): Promise<Uint8Array> {
	const size = seenSize(asset);
	const small =
		size.width !== undefined &&
		size.height !== undefined &&
		Math.max(size.width, size.height) <= maxEdge;
	// A photo already this small, in a format the renderer reads, is used as
	// it is: the renderer applies its EXIF orientation too.
	if (small && DECODABLE.has(asset.contentType))
		return new Uint8Array(await asset.blob.arrayBuffer());
	const blob = await make({
		blob: asset.blob,
		kind: "preview",
		maxEdge,
		...size,
	}).catch(() => asset.blob);
	return new Uint8Array(await blob.arrayBuffer());
}

/** A photo's bytes with its long edge at most `maxEdge`, upright. The last
 *  eight are kept. */
export function previewImage(
	asset: DatasetAsset,
	maxEdge: number,
): Promise<Uint8Array> {
	const key = keyOf(asset, maxEdge);
	const hit = previews.get(key);
	if (hit) return hit;
	const loading = loadPreview(asset, maxEdge);
	previews.set(key, loading);
	loading.catch(() => previews.delete(key));
	return loading;
}

const shaMaps = new WeakMap<
	readonly DatasetAsset[],
	ReadonlyMap<string, DatasetAsset>
>();

function assetsBySha(
	assets: readonly DatasetAsset[],
): ReadonlyMap<string, DatasetAsset> {
	let map = shaMaps.get(assets);
	if (!map) {
		const first = new Map<string, DatasetAsset>();
		for (const a of assets) if (!first.has(a.sha256)) first.set(a.sha256, a);
		map = first;
		shaMaps.set(assets, map);
	}
	return map;
}

/** The `ws:` references among a record's values that name one of `assets`. */
export function referencedAssets(
	assets: readonly DatasetAsset[] | undefined,
	values: Record<string, string>,
): DatasetAsset[] {
	if (!assets || assets.length === 0) return [];
	const out: DatasetAsset[] = [];
	const seen = new Set<string>();
	for (const value of Object.values(values)) {
		const sha = parseAssetRef(value);
		if (sha === null || seen.has(sha)) continue;
		seen.add(sha);
		const asset = assetsBySha(assets).get(sha);
		if (asset) out.push(asset);
	}
	return out;
}

/**
 * The dataset photos a record's values show, at preview resolution, keyed by
 * their `ws:` reference: null until every one of them has loaded, so a
 * preview does not paint a photo as missing while it decodes. The map keeps
 * its identity while the same photos are shown.
 */
export function usePreviewImages(
	assets: readonly DatasetAsset[] | undefined,
	values: Record<string, string>,
	maxEdge: number,
): Map<string, Uint8Array> | null {
	const wanted = useMemo(
		() => referencedAssets(assets, values),
		[assets, values],
	);
	const key = wanted.map((a) => keyOf(a, maxEdge)).join(",");
	const [loaded, setLoaded] = useState<{
		key: string;
		images: Map<string, Uint8Array>;
	}>({ key: "", images: new Map() });
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` names what `wanted` holds
	useEffect(() => {
		if (key === loaded.key) return;
		let cancelled = false;
		Promise.all(
			wanted.map(async (a) => {
				try {
					return [`ws:${a.sha256}`, await previewImage(a, maxEdge)] as const;
				} catch {
					return null;
				}
			}),
		).then((entries) => {
			if (cancelled) return;
			setLoaded({
				key,
				images: new Map(
					entries.filter((e): e is NonNullable<typeof e> => e !== null),
				),
			});
		});
		return () => {
			cancelled = true;
		};
	}, [key, maxEdge]);
	return loaded.key === key ? loaded.images : null;
}
