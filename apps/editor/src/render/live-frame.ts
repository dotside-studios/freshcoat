import {
	type FrameWarning,
	hasToken,
	printHints,
	type Sides,
	type Template,
	walkElements,
} from "@freshcoat-js/coatfile";
import type { Node, PaintCacheStats } from "@freshcoat-js/engine";
import {
	collectGeometry,
	type LayerGeometry,
	trimGeometry,
} from "~/doc/geometry";
import { getElement, keyOf } from "~/doc/path";
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
	/** Paints the template's bleed around the trim. */
	bleed?: boolean;
	/** Warns for a field's image that prints below `min` at `dpi`. */
	imageDpi?: { dpi: number; min: number };
	/** Runs the print checks at `dpi`, for what only the record's values
	 *  show. */
	printChecks?: { dpi: number };
};

export type LiveResult = {
	geometry: LayerGeometry;
	warnings: string[];
	barcodes: BarcodeIssue[];
	timings: RenderTimings;
	/** The density actually painted at, after the export clamp. */
	scale: number;
	/** The bleed painted around the trim, in template units. */
	bleed: Sides;
};

export type LiveFrame = LiveResult & {
	/** The element on screen that shows the frame. */
	canvas: HTMLCanvasElement;
	/** A readable copy of the frame's trim, when one was asked for. */
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
		...(request.bleed ? { bleed: true } : {}),
		...(request.imageDpi
			? {
					imageDpi: {
						...request.imageDpi,
						skip: (src: string) => fixedSrcs(preview.template).has(src),
					},
				}
			: {}),
		...(request.printChecks ? { printChecks: request.printChecks } : {}),
		collect: (root: Node) =>
			collectGeometry(root, preview.pathIds, template, side),
	});
	const shown = preview.template;
	return {
		canvas: out.canvas,
		geometry: trimGeometry(
			out.geometry,
			shown.template_data[0]?.elements ?? [],
			preview.pathIds,
			{ width: shown.width, height: shown.height },
			out.bleed,
		),
		timings: out.timings,
		scale: out.scale,
		bleed: out.bleed,
		...splitWarnings(
			out.warnings.flatMap((w): FrameWarning[] => {
				if (w.kind !== "image_low_dpi" && w.kind !== "print_check") return [w];
				const key = w.layer ? preview.pathIds.get(w.layer) : undefined;
				if (
					w.kind === "print_check" &&
					key &&
					request.printChecks &&
					staticPrintIssues(template, request.printChecks.dpi).has(
						`${key}|${w.issue.code}`,
					)
				)
					return [];
				const id = key ? getElement(template, key)?.id : undefined;
				return [id ? { ...w, layer: id } : w];
			}),
			preview.pathIds,
		),
	};
}

const staticPrintCache = new WeakMap<Template, Map<number, Set<string>>>();

/** The layers and checks the Issues list's print hints already report, as
 *  `key|code`. */
function staticPrintIssues(t: Template, dpi: number): Set<string> {
	let byDpi = staticPrintCache.get(t);
	if (!byDpi) {
		byDpi = new Map();
		staticPrintCache.set(t, byDpi);
	}
	let found = byDpi.get(dpi);
	if (!found) {
		found = new Set(
			printHints(t, { dpi }).map(
				(h) => `${keyOf({ side: h.side, path: h.path })}|${h.issue.code}`,
			),
		);
		byDpi.set(dpi, found);
	}
	return found;
}

const fixedSrcCache = new WeakMap<Template, Set<string>>();

/** The image srcs a template names itself, which the Issues list's print
 *  hints already check. */
function fixedSrcs(t: Template): Set<string> {
	let srcs = fixedSrcCache.get(t);
	if (!srcs) {
		const found = new Set<string>();
		for (const frame of t.template_data)
			walkElements([frame.background, ...frame.elements], (el) => {
				if (el.type === "image" && !hasToken(el.properties.src))
					found.add(el.properties.src);
			});
		srcs = found;
		fixedSrcCache.set(t, srcs);
	}
	return srcs;
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
				...(snapshot ? { snapshot: copyCanvas(el, trimCrop(el, result)) } : {}),
			};
		},
		cacheStats: () => session.stats(),
		dispose: () => session.dispose(),
	};
}

type Crop = { x: number; y: number; width: number; height: number };

/** The trim's part of a frame painted with bleed, in device pixels. */
export function trimCrop(
	size: { width: number; height: number },
	frame: { scale: number; bleed: Sides },
): Crop {
	const { scale, bleed } = frame;
	const x = Math.round(bleed.left * scale);
	const y = Math.round(bleed.top * scale);
	return {
		x,
		y,
		width: size.width - x - Math.round(bleed.right * scale),
		height: size.height - y - Math.round(bleed.bottom * scale),
	};
}

function copyCanvas(
	source: CanvasImageSource & { width: number; height: number },
	crop: Crop = { x: 0, y: 0, width: source.width, height: source.height },
) {
	const copy = document.createElement("canvas");
	copy.width = crop.width;
	copy.height = crop.height;
	copy.getContext("2d")?.drawImage(source, -crop.x, -crop.y);
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
