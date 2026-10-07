import type { Template } from "@freshcoat-js/coatfile";
import type { Node, PaintCacheStats } from "@freshcoat-js/engine";
import { collectGeometry, type LayerGeometry } from "~/doc/geometry";
import { buildPreview } from "~/doc/preview";
import type { BarcodeIssue } from "~/state/store";
import type { RenderSession, RenderTimings } from "./session";
import { splitWarnings } from "./warnings";

/** What the Edit canvas paints: one side of the document as it stands. */
export type LiveRequest = {
	template: Template;
	side: number;
	variantId?: string;
	hidden: ReadonlySet<string>;
	values: Record<string, unknown>;
	fonts: Map<string, Uint8Array[]>;
	/** The record's dataset photos, by `ws:` reference. */
	photos: Map<string, Uint8Array>;
	/** Device pixels per template unit. */
	density: number;
};

export type LiveResult = {
	geometry: LayerGeometry;
	warnings: string[];
	barcodes: BarcodeIssue[];
	timings: RenderTimings;
	/** The density actually painted at, after the export clamp. */
	scale: number;
};

export type LiveFrame = LiveResult & {
	/** The element on screen that shows the frame. */
	canvas: HTMLCanvasElement;
	/** A readable copy of the frame, when one was asked for. */
	snapshot?: HTMLCanvasElement;
};

/** Paints the Edit canvas's frame, on the main thread or in a worker. */
export type LiveBackend = {
	render(request: LiveRequest, opts: { snapshot: boolean }): Promise<LiveFrame>;
	cacheStats(): PaintCacheStats | undefined;
	dispose(): void;
};

/** Paints `request` through `session`, and reads the layer boxes, warnings and
 *  barcode issues off it. */
export async function renderLiveFrame(
	session: RenderSession,
	request: LiveRequest,
): Promise<LiveResult & { canvas: unknown }> {
	const { template, side } = request;
	const preview = buildPreview(template, {
		side,
		variantId: request.variantId,
		hidden: request.hidden,
	});
	const out = await session.render({
		template: preview.template,
		images: withDatasetImages(preview.images, request.photos),
		values: request.values,
		fonts: request.fonts,
		scale: request.density,
		collect: (root: Node) =>
			collectGeometry(root, preview.pathIds, template, side),
	});
	return {
		canvas: out.canvas,
		geometry: out.geometry,
		timings: out.timings,
		scale: out.scale,
		...splitWarnings(out.warnings, preview.pathIds),
	};
}

/** The current path: CanvasKit on the main thread, a new canvas element
 *  whenever the painted size changes. */
export function createMainBackend(session: RenderSession): LiveBackend {
	return {
		async render(request, { snapshot }) {
			const { canvas, ...result } = await renderLiveFrame(session, request);
			const el = canvas as HTMLCanvasElement;
			// The drawing buffer is only readable in the task that painted it.
			return {
				...result,
				canvas: el,
				...(snapshot ? { snapshot: copyCanvas(el) } : {}),
			};
		},
		cacheStats: () => session.stats(),
		dispose: () => session.dispose(),
	};
}

function copyCanvas(
	source: CanvasImageSource & { width: number; height: number },
) {
	const copy = document.createElement("canvas");
	copy.width = source.width;
	copy.height = source.height;
	copy.getContext("2d")?.drawImage(source, 0, 0);
	return copy;
}

/** A 2D canvas holding `bitmap`, which is closed. */
export function canvasOfBitmap(bitmap: ImageBitmap): HTMLCanvasElement {
	const copy = copyCanvas(bitmap);
	bitmap.close();
	return copy;
}

const merged = new WeakMap<
	Map<string, Uint8Array>,
	WeakMap<Map<string, Uint8Array>, Map<string, Uint8Array>>
>();

/** The template's own images plus the record's dataset photos, which image
 *  cells reference as `ws:<sha256>`. Stable per pair, so the render env is
 *  only rebuilt when either changes. */
function withDatasetImages(
	images: Map<string, Uint8Array>,
	photos: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
	if (photos.size === 0) return images;
	let byPhotos = merged.get(images);
	if (!byPhotos) {
		byPhotos = new WeakMap();
		merged.set(images, byPhotos);
	}
	const hit = byPhotos.get(photos);
	if (hit) return hit;
	const out = new Map(images);
	for (const [ref, bytes] of photos) out.set(ref, bytes);
	byPhotos.set(photos, out);
	return out;
}
