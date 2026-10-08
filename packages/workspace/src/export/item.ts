import {
	compile,
	fitDesignSize,
	hasInsets,
	type Sides,
	type Template,
	variantSize,
} from "@freshcoat-js/coatfile";
import { renderCompiled } from "@freshcoat-js/coatfile/render";
import {
	type ByteLoader,
	createRenderer,
	fetchLoader,
	type Renderer,
	type RendererOptions,
} from "@freshcoat-js/engine";
import { crc32 } from "../crc";
import { orientedSize } from "../image-info";
import { exportSize } from "../plan";
import type { DatasetAsset, ExportItem, ExportPreset } from "../types";
import { createJobCaches, IMAGE_CACHE_PIXELS } from "./caches";
import {
	type GamutNote,
	gamutNotes,
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
 * the density that makes it exactly that many pixels.
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
		const { width, height } = withBleed(design, bleed);
		return {
			width: Math.round(width * preset.scale),
			height: Math.round(height * preset.scale),
			scale: preset.scale,
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
	const cap =
		size.maxEdge && size.maxEdge > 0
			? Math.min(1, size.maxEdge / Math.max(seen.width, seen.height))
			: 1;
	const width = Math.max(1, Math.round(seen.width * cap));
	const height = Math.max(1, Math.round(seen.height * cap));
	const resize = fitDesignSize(design, width, height);
	return { width, height, scale: width / resize.width, resize };
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
	ck: RendererOptions["ck"];
	fonts?: Map<string, Uint8Array[]>;
	/** Where bytes the request's `images` do not hold come from. Default:
	 *  data: URLs and fetch. */
	load?: ByteLoader;
	/** Decoded pixels kept across items. */
	maxImagePixels?: number;
};

/** Renders export items one at a time, keeping decoded images, analyses and
 *  the surface across the items of a job. */
export type ItemRenderer = {
	render(request: RenderRequest): Promise<RenderOutput>;
	/** Replaces the fonts. What was kept is freed with the renderer. */
	setFonts(fonts: Map<string, Uint8Array[]>): void;
	/** Frees what was kept across the job's items. */
	endJob(): void;
	dispose(): void;
};

export function createItemRenderer(options: ItemRendererOptions): ItemRenderer {
	const { ck } = options;
	const fallback = options.load ?? fetchLoader;
	let fonts = options.fonts ?? new Map<string, Uint8Array[]>();
	let renderer: Promise<Renderer> | undefined;
	let own = new Map<string, Blob>();
	const caches = createJobCaches();

	const load: ByteLoader = async (src) => {
		const blob = own.get(src);
		if (blob) return new Uint8Array(await blob.arrayBuffer());
		return fallback(src);
	};

	const rendererFor = () => {
		renderer ??= createRenderer({
			ck,
			fonts: Object.fromEntries(fonts),
			load,
			cache: { maxImagePixels: options.maxImagePixels ?? IMAGE_CACHE_PIXELS },
		});
		return renderer;
	};

	const dropRenderer = () => {
		caches.clear();
		void renderer?.then((r) => r.dispose());
		renderer = undefined;
	};

	return {
		async render(req) {
			const r = await rendererFor();
			const started = performance.now();
			const { template } = req;
			if (!template.template_data.some((f) => f.name === req.side))
				throw new Error(`no side named "${req.side}"`);
			const variantId =
				req.variantId && template.variants?.some((v) => v.id === req.variantId)
					? req.variantId
					: undefined;
			own = new Map(req.images);
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
				const [result] = await renderCompiled(r, compiled, {
					frameNames: [req.side],
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
			for (const w of result.warnings) {
				if (w.kind === "barcode_invalid")
					throw new Error(`Barcode: ${w.message}`);
				if (w.kind === "barcode_unavailable")
					throw new Error("Barcode: the encoder isn't loaded");
			}
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
			dropRenderer();
			fonts = next;
		},
		endJob() {
			caches.clear();
			void renderer?.then((r) => r.clear());
		},
		dispose() {
			dropRenderer();
			own = new Map();
		},
	};
}
