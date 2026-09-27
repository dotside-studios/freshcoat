import type { Template } from "@freshcoat-js/coatfile";
import type { DatasetAsset } from "@freshcoat-js/workspace";
import { Lru } from "~/data/lru";
import { previewImage, referencedAssets } from "~/data/thumbnails";
import { buildPreview, type Preview } from "~/doc/preview";
import { getCanvasKit } from "~/render/canvaskit";
import { createRenderSession, type RenderSession } from "~/render/session";

/** A photo in a slot is decoded no larger than this. */
const PHOTO_EDGE = 512;

export type SheetThumbRequest = {
	/** the whole template; the side is picked by `side` */
	template: Template;
	side: number;
	variantId?: string;
	values: Record<string, string>;
	fonts: Map<string, Uint8Array[]>;
	assets?: readonly DatasetAsset[];
	/** device pixels per template unit */
	density: number;
};

const templateIds = new WeakMap<object, number>();
const fontIds = new WeakMap<object, number>();
let nextId = 1;
const idOf = (map: WeakMap<object, number>, o: object) => {
	let id = map.get(o);
	if (id === undefined) {
		id = nextId++;
		map.set(o, id);
	}
	return id;
};

/** What a thumbnail is keyed by: everything that changes its pixels. */
export function thumbKey(req: SheetThumbRequest): string {
	return [
		idOf(templateIds, req.template),
		idOf(fontIds, req.fonts),
		req.side,
		req.variantId ?? "",
		req.density,
		JSON.stringify(req.values),
	].join("|");
}

// Rendered slots, as 2D canvases that outlive the WebGL surface. A sheet of
// small cards holds a few dozen, and stepping back and forth reuses them.
const cache = new Lru<string, HTMLCanvasElement>({
	maxEntries: 120,
	maxSize: 48e6,
	sizeOf: (c) => c.width * c.height * 4,
});
const previews = new WeakMap<Template, Map<string, Preview>>();

function previewOf(template: Template, side: number, variantId?: string) {
	let byTemplate = previews.get(template);
	if (!byTemplate) {
		byTemplate = new Map();
		previews.set(template, byTemplate);
	}
	const key = `${side}|${variantId ?? ""}`;
	let preview = byTemplate.get(key);
	if (!preview) {
		preview = buildPreview(template, {
			side,
			...(variantId ? { variantId } : {}),
		});
		byTemplate.set(key, preview);
	}
	return preview;
}

let session: Promise<RenderSession> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** A rendered thumbnail already cached for this request, if there is one. */
export function peekSheetThumb(
	req: SheetThumbRequest,
): HTMLCanvasElement | undefined {
	return cache.get(thumbKey(req));
}

/**
 * One slot's record rendered at a low density through the same pipeline as
 * the preview, one at a time on a shared session, and cached. A request whose
 * signal aborts before its turn is dropped.
 */
export function renderSheetThumb(
	req: SheetThumbRequest,
	signal?: AbortSignal,
): Promise<HTMLCanvasElement> {
	const key = thumbKey(req);
	const hit = cache.get(key);
	if (hit) return Promise.resolve(hit);
	const run = async () => {
		if (signal?.aborted) throw new DOMException("aborted", "AbortError");
		const again = cache.get(key);
		if (again) return again;
		session ??= getCanvasKit().then((ck) => createRenderSession(ck));
		const s = await session;
		const preview = previewOf(req.template, req.side, req.variantId);
		const photos = await Promise.all(
			referencedAssets(req.assets, req.values).map(async (a) => {
				try {
					return [`ws:${a.sha256}`, await previewImage(a, PHOTO_EDGE)] as const;
				} catch {
					return null;
				}
			}),
		);
		let images = preview.images;
		if (photos.some((p) => p !== null)) {
			images = new Map(images);
			for (const p of photos) if (p) images.set(p[0], p[1]);
		}
		const out = await s.render({
			template: preview.template,
			images,
			values: req.values,
			fonts: req.fonts,
			scale: req.density,
			collect: () => null,
		});
		const copy = document.createElement("canvas");
		copy.width = out.canvas.width;
		copy.height = out.canvas.height;
		copy.getContext("2d")?.drawImage(out.canvas, 0, 0);
		cache.set(key, copy);
		return copy;
	};
	const next = queue.then(run, run);
	queue = next.catch(() => undefined);
	return next;
}
