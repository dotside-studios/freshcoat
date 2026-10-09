import {
	applyVariant,
	compile,
	exportPixelSize,
	fitDesignSize,
	hasInsets,
	MAX_EXPORT_DIMENSION,
	type Renderer,
	resizeTemplate,
	resolveExportScale,
	type Sides,
	type Template,
	variantSize,
} from "@freshcoat-js/coatfile";
import { renderCompiled } from "@freshcoat-js/coatfile/render";
import { assetRef } from "../assets";
import { crc32 } from "../crc";
import { orientedSize } from "../image-info";
import { DEFAULT_QUALITY, exportSize, imageFormat } from "../plan";
import type { DatasetAsset, ExportItem, ExportPreset } from "../types";
import { createJobCaches } from "./caches";
import {
	type GamutNote,
	gamutNotes,
	printRequest,
	type RenderPrint,
	withPrintFallback,
} from "./print";
import { presetBleed } from "./sheets";

export type OutputFormat = "png" | "jpeg" | "webp";

export type RenderRequest = {
	template: Template;
	values: Record<string, string>;
	variantId?: string;
	side: string;
	/** device pixels per design unit */
	scale: number;
	/** the dataset photos this item's values name, by `ws:` reference */
	images: [ref: string, blob: Blob][];
	/** lay the design out at this size by its constraints first */
	resize?: { width: number; height: number };
	/** include the template's bleed around the trim */
	bleed?: boolean;
	format: OutputFormat;
	/** JPEG and WebP, 0..100 */
	quality?: number;
	/** render through for-print's card-printer path */
	print?: RenderPrint;
};

export type RenderOutput = {
	bytes: Uint8Array;
	/** what the bytes are; a CanvasKit without an encoder answers in PNG */
	format: OutputFormat;
	width: number;
	height: number;
	/** CRC-32 of `bytes` */
	crc?: number;
	ms: number;
	/** set when the request asked for print: "fallback" when the print path
	 *  failed and the bytes are a plain render */
	print?: "on" | "fallback";
	/** why the print path failed */
	printError?: string;
	/** photo layers the print path pulled into the printer's range */
	gamut?: GamutNote[];
};

export type ItemSize = {
	/** output pixels */
	width: number;
	height: number;
	scale: number;
	resize?: { width: number; height: number };
	/** set when the output includes the template's bleed */
	bleed?: true;
};

/**
 * What one item renders at. A template size is the item's variant's size at
 * the preset's scale, with the bleed around it when the preset includes it. A
 * size from an image is the photo's oriented pixels, capped by `maxEdge`: the
 * variant is laid out by its constraints at the photo's aspect and rendered at
 * the density that makes it exactly that many pixels. Neither goes past
 * `MAX_EXPORT_DIMENSION`, the longest edge the render allows.
 */
export function itemSize(
	template: Pick<Template, "width" | "height" | "bleed" | "variants">,
	preset: ExportPreset,
	item: Pick<ExportItem, "values" | "variantId">,
	assets: ReadonlyMap<string, DatasetAsset>,
): ItemSize | { error: string } {
	const size = exportSize(preset);
	const design = variantSize(template, item.variantId);
	if (size.kind === "template") {
		const bleed = presetBleed(template, preset);
		const full = withBleed(design, bleed);
		const scale = resolveExportScale(
			{ kind: "scale", value: preset.scale },
			full,
		);
		return {
			...exportPixelSize(full, scale),
			scale,
			...(hasInsets(bleed) ? { bleed: true as const } : {}),
		};
	}
	const asset = assets.get(item.values[size.field] ?? "");
	if (!asset) return { error: `No image in ${size.field}` };
	if (!asset.width || !asset.height)
		return { error: `Image in ${size.field} has no readable size` };
	const seen = orientedSize({
		width: asset.width,
		height: asset.height,
		orientation: asset.orientation,
	});
	const longest = Math.max(seen.width, seen.height);
	const maxEdge =
		size.maxEdge && size.maxEdge > 0
			? Math.min(size.maxEdge, MAX_EXPORT_DIMENSION)
			: MAX_EXPORT_DIMENSION;
	const cap = Math.min(1, maxEdge / longest);
	const width = Math.max(1, Math.round(seen.width * cap));
	const height = Math.max(1, Math.round(seen.height * cap));
	const resize = fitDesignSize(design, width, height);
	return { width, height, scale: width / resize.width, resize };
}

/** A dataset's photos by their `ws:` reference. */
export function assetsByRef(
	assets: readonly DatasetAsset[] | undefined,
): Map<string, DatasetAsset> {
	return new Map((assets ?? []).map((a) => [assetRef(a.sha256), a] as const));
}

/** The photos an item's values name, each once, in value order. */
export function referencedAssets(
	item: Pick<ExportItem, "values">,
	assets: ReadonlyMap<string, DatasetAsset>,
): DatasetAsset[] {
	const out: DatasetAsset[] = [];
	for (const value of new Set(Object.values(item.values))) {
		const asset = assets.get(value);
		if (asset) out.push(asset);
	}
	return out;
}

/** The photos an item's values name, so a worker gets only those. */
export function imagesOf(
	item: Pick<ExportItem, "values">,
	assets: ReadonlyMap<string, DatasetAsset>,
): [string, Blob][] {
	return referencedAssets(item, assets).map((a) => [
		assetRef(a.sha256),
		a.blob,
	]);
}

/** The render request for one item as the export makes it, with the size it
 *  renders at. */
export function itemRequest(
	template: Template,
	preset: ExportPreset,
	item: Pick<ExportItem, "values" | "variantId" | "side">,
	assets: ReadonlyMap<string, DatasetAsset>,
): { request: RenderRequest; size: ItemSize } | { error: string } {
	const size = itemSize(template, preset, item, assets);
	if ("error" in size) return size;
	const format = imageFormat(preset);
	const print = printRequest(preset.print);
	return {
		size,
		request: {
			template,
			values: item.values,
			...(item.variantId !== undefined ? { variantId: item.variantId } : {}),
			side: item.side,
			scale: size.scale,
			images: imagesOf(item, assets),
			...(size.resize ? { resize: size.resize } : {}),
			...(size.bleed ? { bleed: true } : {}),
			format,
			...(format !== "png"
				? { quality: preset.quality ?? DEFAULT_QUALITY }
				: {}),
			...(print ? { print } : {}),
		},
	};
}

/**
 * The template laid out at the size `itemSize` gives an item whose size
 * follows a photo, as the export will render it; the template itself
 * otherwise. An item in a variant with its own size gets that variant laid
 * out, without its variants. A template's size is whole design units, so the
 * layout size is rounded.
 */
export function itemTemplate(
	template: Template,
	preset: ExportPreset,
	item: Pick<ExportItem, "values" | "variantId">,
	assets: ReadonlyMap<string, DatasetAsset>,
): Template {
	const size = itemSize(template, preset, item, assets);
	if ("error" in size || !size.resize) return template;
	const sized = item.variantId
		? template.variants?.find((v) => v.id === item.variantId && v.size)
		: undefined;
	let base = template;
	if (sized) {
		const { variants: _v, ...applied } = applyVariant(template, sized.id);
		base = applied;
	}
	const { resize } = size;
	if (
		Math.abs(resize.width - base.width) < 0.5 &&
		Math.abs(resize.height - base.height) < 0.5
	)
		return base;
	return resizeTemplate(
		base,
		Math.max(1, Math.round(resize.width)),
		Math.max(1, Math.round(resize.height)),
	);
}

export function withBleed(
	template: Pick<Template, "width" | "height">,
	bleed: Sides,
): { width: number; height: number } {
	return {
		width: template.width + bleed.left + bleed.right,
		height: template.height + bleed.top + bleed.bottom,
	};
}

export type ItemRendererOptions = {
	/** The host owns it: dispose leaves it alive. */
	renderer: Renderer;
	fonts?: Map<string, Uint8Array[]>;
};

/** Renders export items one at a time, keeping analyses and the renderer's
 *  decoded images and surface across the items of a job. */
export type ItemRenderer = {
	render(request: RenderRequest): Promise<RenderOutput>;
	/** Adds these fonts to the renderer, replacing families it already has. */
	setFonts(fonts: Map<string, Uint8Array[]>): void;
	/** Frees what was kept across the job's items. */
	endJob(): void;
	dispose(): void;
};

export function createItemRenderer(options: ItemRendererOptions): ItemRenderer {
	const { renderer } = options;
	const caches = createJobCaches();
	let fonts: Promise<void> = options.fonts
		? renderer.addFonts(Object.fromEntries(options.fonts))
		: Promise.resolve();
	// The renderer keeps a decoded photo while it is handed the same bytes, and
	// a `ws:` ref names its content, so the last item's bytes are passed again.
	let photos = new Map<string, Uint8Array>();

	const photosFor = async (images: RenderRequest["images"]) => {
		const next = new Map(
			await Promise.all(
				images.map(
					async ([ref, blob]) =>
						[
							ref,
							photos.get(ref) ?? new Uint8Array(await blob.arrayBuffer()),
						] as const,
				),
			),
		);
		photos = next;
		return next;
	};

	return {
		async render(req) {
			await fonts;
			const started = performance.now();
			const { template } = req;
			if (!template.template_data.some((f) => f.name === req.side))
				throw new Error(`no side named "${req.side}"`);
			const variantId =
				req.variantId && template.variants?.some((v) => v.id === req.variantId)
					? req.variantId
					: undefined;
			const images = await photosFor(req.images);
			const design = req.resize ?? variantSize(template, variantId);
			const compiled = compile(template, req.values, {
				width: design.width,
				height: design.height,
				variantId,
				...(req.resize ? { resize: req.resize } : {}),
				...(req.bleed ? { bleed: true } : {}),
				frameNames: [req.side],
			});
			const painted = await withPrintFallback(req.print, async (print) => {
				const [result] = await renderCompiled(renderer, compiled, {
					frameNames: [req.side],
					images,
					...(print ? { print } : {}),
					exports: [
						req.scale === 1
							? {}
							: { constraint: { kind: "scale", value: req.scale } },
					],
					analysisCache: caches.analysis(),
					analysisKey: caches.analysisKey(template),
					output: {
						encode: {
							format: req.format,
							...(req.quality !== undefined ? { quality: req.quality } : {}),
						},
					},
				});
				if (!result) throw new Error("nothing was rendered");
				return result;
			});
			const { result } = painted;
			// A placeholder in place of a code would print as if it scanned; the
			// item fails instead, with the encoder's reason.
			for (const w of result.warnings)
				if (w.kind === "barcode_invalid")
					throw new Error(`Barcode: ${w.message}`);
			const gamut = painted.print === "on" ? gamutNotes(result.warnings) : [];
			return {
				bytes: result.bytes,
				crc: crc32(result.bytes),
				format: (result.format ?? "png") as OutputFormat,
				width: result.width,
				height: result.height,
				ms: performance.now() - started,
				...(painted.print !== "off" ? { print: painted.print } : {}),
				...(painted.error ? { printError: painted.error } : {}),
				...(gamut.length > 0 ? { gamut } : {}),
			};
		},
		setFonts(next) {
			const add = () => renderer.addFonts(Object.fromEntries(next));
			fonts = fonts.then(add, add);
		},
		endJob() {
			caches.clear();
			photos = new Map();
			renderer.clear();
		},
		dispose() {
			caches.clear();
			photos = new Map();
		},
	};
}
