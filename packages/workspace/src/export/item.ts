import {
	activeVariantId,
	applyVariant,
	canvasKitPathOp,
	compile,
	DEFAULT_MIN_IMAGE_DPI,
	exportPixelSize,
	type FrameWarning,
	fitDesignSize,
	hasInsets,
	MAX_EXPORT_DIMENSION,
	type PrintCheckOptions,
	pieceSpec,
	type Renderer,
	resizeTemplate,
	resolveExportScale,
	resolveSlices,
	type Sides,
	type Template,
	templateBleed,
	variantSize,
} from "@freshcoat-js/coatfile";
import {
	describeWarning,
	type ImageDpiCheck,
	renderCompiled,
	renderCompiledPdf,
} from "@freshcoat-js/coatfile/render";
import { orientedSize } from "@freshcoat-js/engine/image";
import { assetRef } from "../assets";
import { crc32 } from "../crc";
import { type ItemCuts, itemCuts } from "../cut";
import {
	DEFAULT_QUALITY,
	exportCutFile,
	exportCutLines,
	exportSize,
	imageFormat,
	vectorPages,
} from "../plan";
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

/** Why a preset that splits into pieces can't draw its PDF pages as vectors:
 *  a piece is cut from the rendered side. */
export const PIECES_NEED_RASTER_PAGES =
	"Pieces need PNG or JPEG pages, not vector";

export type OutputFormat = "png" | "jpeg" | "webp";

export type RenderRequest = {
	template: Template;
	values: Record<string, string>;
	variantId?: string;
	side: string;
	/** render this slice of the side, by name, in place of the whole side; it
	 *  takes the place of `bleed` */
	piece?: string;
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
	/** PNG only: write RGBA even for an opaque card */
	pngAlpha?: "keep";
	/** render through for-print's card-printer path */
	print?: RenderPrint;
	/** draw a one-page PDF of vectors, `dpi` design units to the inch, in
	 *  place of `format`; `untagged` leaves its RGB DeviceRGB, for a PDF that
	 *  declares no output intent; `text` "outline" draws text as glyph
	 *  outlines, with no font */
	vector?: { dpi: number; untagged?: true; text?: "outline" };
	/** also work out the item's cut lines */
	cut?: true;
	/** warn for images that print below `min` at `dpi` design units to the
	 *  inch */
	imageDpi?: ImageDpiCheck;
	/** run the print checks at `dpi` design units to the inch */
	printChecks?: PrintCheckOptions;
};

export type RenderOutput = {
	bytes: Uint8Array;
	/** what the bytes are; a CanvasKit without an encoder answers in PNG */
	format: OutputFormat | "pdf";
	width: number;
	height: number;
	/** CRC-32 of `bytes` */
	crc?: number;
	/** the item's cut lines, when the request asked and it has any */
	cut?: ItemCuts;
	ms: number;
	/** set when the request asked for print: "fallback" when the print path
	 *  failed and the bytes are a plain render */
	print?: "on" | "fallback";
	/** why the print path failed */
	printError?: string;
	/** photo layers the print path pulled into the printer's range */
	gamut?: GamutNote[];
	/** the render's other warnings, described, each once */
	warnings?: ItemWarning[];
};

/** A render warning an item came out with: `code` is the warning's kind, or
 *  the print check's own code, such as `small_text`. */
export type ItemWarning = { code: string; message: string };

export function warningCode(w: FrameWarning): string {
	return w.kind === "print_check" ? w.issue.code : w.kind;
}

/** The warnings an item reports but still renders with: all but a refused
 *  barcode, which fails it, gamut notes, which `gamut` carries, a PDF layer
 *  drawn as an image, which prints as rendered, and an image with no source,
 *  which is an unfilled field. */
function noted(warnings: readonly FrameWarning[]): ItemWarning[] {
	const out = new Map<string, ItemWarning>();
	for (const w of warnings)
		if (
			w.kind !== "barcode_invalid" &&
			w.kind !== "gamut_compressed" &&
			w.kind !== "vector_rasterized" &&
			!(w.kind === "image_load_failed" && w.src === "")
		) {
			const message = describeWarning(w);
			out.set(message, { code: warningCode(w), message });
		}
	return [...out.values()];
}

export type ItemSize = {
	/** output pixels */
	width: number;
	height: number;
	scale: number;
	resize?: { width: number; height: number };
	/** set when the output includes the template's bleed */
	bleed?: true;
};

/** What sizes an item: its values and variant, and the piece of a side it is
 *  when it is one. */
type SizedItem = Pick<ExportItem, "values" | "variantId"> &
	Partial<Pick<ExportItem, "side" | "piece">>;

/** A piece's size in design units: its box and its bleed, as the side is laid
 *  out at `resize` when it is. */
function pieceDesignSize(
	template: Template,
	item: SizedItem,
	resize?: { width: number; height: number },
): { width: number; height: number } | { error: string } {
	try {
		const slice = resolveSlices(template, {
			frameName: item.side ?? template.template_data[0]?.name,
			values: item.values,
			variantId: item.variantId,
			...(resize ? { resize } : {}),
		}).find((s) => s.name === item.piece);
		if (!slice) return { error: `No slice "${item.piece}" on this side` };
		const { box, bleed } = slice;
		return {
			width: box.width + bleed.left + bleed.right,
			height: box.height + bleed.top + bleed.bottom,
		};
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * What one item renders at. A template size is the item's variant's size at
 * the preset's scale, with the bleed around it when the preset includes it. A
 * size from an image is the photo's oriented pixels, capped by `maxEdge`: the
 * variant is laid out by its constraints at the photo's aspect and rendered at
 * the density that makes it exactly that many pixels. Neither goes past
 * `MAX_EXPORT_DIMENSION`, the longest edge the render allows.
 *
 * A piece is its box and bleed at the same density its side would get, with
 * no template bleed around it: the preset's bleed does not apply.
 */
export function itemSize(
	template: Template,
	preset: ExportPreset,
	item: SizedItem,
	assets: ReadonlyMap<string, DatasetAsset>,
): ItemSize | { error: string } {
	const size = exportSize(preset);
	const design = variantSize(template, item.variantId);
	if (size.kind === "template" && item.piece !== undefined) {
		const piece = pieceDesignSize(template, item);
		if ("error" in piece) return piece;
		const scale = resolveExportScale(
			{ kind: "scale", value: preset.scale },
			piece,
		);
		return { ...exportPixelSize(piece, scale), scale };
	}
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
	const scale = width / resize.width;
	if (item.piece !== undefined) {
		const piece = pieceDesignSize(template, item, resize);
		if ("error" in piece) return piece;
		return {
			width: Math.max(1, Math.round(piece.width * scale)),
			height: Math.max(1, Math.round(piece.height * scale)),
			scale,
			resize,
		};
	}
	return { width, height, scale, resize };
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
	item: Pick<ExportItem, "values" | "variantId" | "side" | "piece">,
	assets: ReadonlyMap<string, DatasetAsset>,
): { request: RenderRequest; size: ItemSize } | { error: string } {
	if (item.piece !== undefined && vectorPages(preset))
		return { error: PIECES_NEED_RASTER_PAGES };
	const size = itemSize(template, preset, item, assets);
	if ("error" in size) return size;
	const format = imageFormat(preset);
	const print = printRequest(preset.print);
	const vector = vectorPages(preset) && !print;
	const dpi = size.resize ? preset.dpi / size.scale : preset.dpi;
	const minImageDpi = preset.minImageDpi ?? DEFAULT_MIN_IMAGE_DPI;
	return {
		size,
		request: {
			template,
			values: item.values,
			...(item.variantId !== undefined ? { variantId: item.variantId } : {}),
			side: item.side,
			...(item.piece !== undefined ? { piece: item.piece } : {}),
			scale: size.scale,
			images: imagesOf(item, assets),
			...(size.resize ? { resize: size.resize } : {}),
			...(size.bleed ? { bleed: true } : {}),
			format,
			...(format !== "png"
				? { quality: preset.quality ?? DEFAULT_QUALITY }
				: {}),
			...(preset.format === "png-zip" && preset.pngAlpha === "keep"
				? { pngAlpha: "keep" as const }
				: {}),
			...(print ? { print } : {}),
			// A PDF page is sized as the design at `dpi`, or as the photo's
			// pixels when the size follows one.
			...(vector
				? {
						vector: {
							dpi,
							...(preset.outputIntent?.kind === "none"
								? { untagged: true as const }
								: {}),
							...(preset.pdfText === "outline"
								? { text: "outline" as const }
								: {}),
						},
					}
				: {}),
			...(exportCutFile(preset) !== "none" || exportCutLines(preset)
				? { cut: true as const }
				: {}),
			...(minImageDpi > 0 ? { imageDpi: { dpi, min: minImageDpi } } : {}),
			printChecks: { dpi },
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
	item: SizedItem,
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
			const variantId = activeVariantId(template, req.variantId);
			const images = await photosFor(req.images);
			const design = req.resize ?? variantSize(template, variantId);
			const pathOp = canvasKitPathOp(renderer.ck);
			let piece: ReturnType<typeof pieceSpec> | undefined;
			if (req.piece !== undefined) {
				if (req.vector) throw new Error(PIECES_NEED_RASTER_PAGES);
				const slices = resolveSlices(template, {
					frameName: req.side,
					values: req.values,
					variantId,
					pathOp,
					...(req.resize ? { resize: req.resize } : {}),
				});
				const slice = slices.find((s) => s.name === req.piece);
				if (!slice)
					throw new Error(`no slice "${req.piece}" on side "${req.side}"`);
				piece = pieceSpec(renderer.ck, slice);
			}
			let cut: ItemCuts | undefined;
			if (req.cut) {
				const lines = itemCuts(
					template,
					{
						values: req.values,
						side: req.side,
						variantId,
						...(req.piece !== undefined ? { piece: req.piece } : {}),
					},
					{
						pathOp,
						...(req.resize ? { resize: req.resize } : {}),
						...(req.bleed && req.piece === undefined
							? { bleed: templateBleed(template) }
							: {}),
					},
				);
				if (lines.lines.length > 0) cut = lines;
			}
			const compiled = compile(template, req.values, {
				width: design.width,
				height: design.height,
				variantId,
				...(req.resize ? { resize: req.resize } : {}),
				...(req.bleed && !piece ? { bleed: true } : {}),
				...(piece ? { piece } : {}),
				frameNames: [req.side],
				pathOp,
			});
			if (req.vector) {
				const [page] = await renderCompiledPdf(renderer, compiled, {
					frameNames: [req.side],
					images,
					dpi: req.vector.dpi,
					...(req.vector.untagged ? { outputIntent: false as const } : {}),
					...(req.vector.text ? { text: req.vector.text } : {}),
					...(req.imageDpi ? { imageDpi: req.imageDpi } : {}),
					...(req.printChecks ? { printChecks: req.printChecks } : {}),
				});
				if (!page) throw new Error("nothing was rendered");
				for (const w of page.warnings)
					if (w.kind === "barcode_invalid") throw new Error(describeWarning(w));
				const warnings = noted(page.warnings);
				return {
					bytes: page.bytes,
					crc: crc32(page.bytes),
					format: "pdf",
					...(cut ? { cut } : {}),
					...exportPixelSize(compiled, req.scale),
					ms: performance.now() - started,
					...(warnings.length > 0 ? { warnings } : {}),
				};
			}
			const painted = await withPrintFallback(req.print, async (print) => {
				const [result] = await renderCompiled(renderer, compiled, {
					frameNames: [req.side],
					images,
					...(print ? { print } : {}),
					...(req.imageDpi ? { imageDpi: req.imageDpi } : {}),
					...(req.printChecks ? { printChecks: req.printChecks } : {}),
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
							...(req.pngAlpha ? { alpha: req.pngAlpha } : {}),
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
				if (w.kind === "barcode_invalid") throw new Error(describeWarning(w));
			const gamut = painted.print === "on" ? gamutNotes(result.warnings) : [];
			const warnings = noted(result.warnings);
			return {
				bytes: result.bytes,
				crc: crc32(result.bytes),
				...(cut ? { cut } : {}),
				format: (result.format ?? "png") as OutputFormat,
				width: result.width,
				height: result.height,
				ms: performance.now() - started,
				...(painted.print !== "off" ? { print: painted.print } : {}),
				...(painted.error ? { printError: painted.error } : {}),
				...(gamut.length > 0 ? { gamut } : {}),
				...(warnings.length > 0 ? { warnings } : {}),
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
