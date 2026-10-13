import {
	base64ToBytes,
	type DrawCommand,
	fitRect,
	type ImageCrop,
	type Size,
	type Vec2,
} from "@freshcoat-js/engine";
import { orientedSize, parseImageInfo } from "@freshcoat-js/engine/image";
import { parseAssetUri } from "./assets";
import { parseImageFocus } from "./image-focus";
import { hasToken } from "./mustache";
import { walkElements } from "./tree";
import type { Background, Element, Template } from "./types";

/** The resolution below which a placed image is flagged. */
export const DEFAULT_MIN_IMAGE_DPI = 300;

/** Design units to the inch a template is checked at when no export names
 *  one. */
export const DEFAULT_IMAGE_DPI_UNITS = 300;

export type ImageFraming = {
	fit: "cover" | "contain" | "fill" | "tile";
	crop?: ImageCrop;
	focus?: Vec2;
};

/**
 * The resolution an image prints at: source pixels over the inches they
 * cover, on the axis that has fewer. `placed` is the layer's box in design
 * units and `dpi` the design units to the inch. A tiled image is drawn one
 * pixel to the unit.
 */
export function effectiveImageDpi(
	pixels: Size,
	placed: Size,
	dpi: number,
	framing: ImageFraming,
): number {
	if (!(pixels.width > 0 && pixels.height > 0 && dpi > 0)) return 0;
	if (!(placed.width > 0 && placed.height > 0)) return Number.POSITIVE_INFINITY;
	if (framing.fit === "tile") return dpi;
	const r = fitRect(
		pixels.width,
		pixels.height,
		0,
		0,
		placed.width,
		placed.height,
		framing.fit,
		{
			...(framing.crop ? { crop: framing.crop } : {}),
			...(framing.focus ? { focus: framing.focus } : {}),
		},
	);
	return Math.min((r.sw / r.dw) * dpi, (r.sh / r.dh) * dpi);
}

/** An image's oriented pixel size from its bytes, or undefined for one this
 *  cannot read, such as an SVG. */
export function imagePixelSize(bytes: Uint8Array): Size | undefined {
	const info = parseImageInfo(bytes);
	if (!info || !(info.width > 0 && info.height > 0)) return undefined;
	return orientedSize(info);
}

// Enough base64 for any header `parseImageInfo` reads in one go.
const HEADER_BASE64 = 64 * 1024 * (4 / 3);

function headerBytes(base64: string): Uint8Array {
	return base64ToBytes(
		base64.replace(/\s+/g, "").slice(0, Math.ceil(HEADER_BASE64 / 4) * 4),
	);
}

/** The pixel size of an image the template carries itself: an `asset:` src
 *  or a base64 `data:` URI. */
export function inlineImageSize(
	t: Pick<Template, "assets">,
	src: string,
): Size | undefined {
	const sha = parseAssetUri(src);
	if (sha !== null) {
		const asset = t.assets?.find((a) => a.sha256 === sha);
		return asset ? imagePixelSize(headerBytes(asset.base64)) : undefined;
	}
	const data = /^data:[^,]*;base64,/i.exec(src);
	if (data) return imagePixelSize(headerBytes(src.slice(data[0].length)));
	return undefined;
}

export type ImageDpiOptions = {
	/** Design units to the inch. Default `DEFAULT_IMAGE_DPI_UNITS`. */
	dpi?: number;
	/** Default `DEFAULT_MIN_IMAGE_DPI`; 0 turns the check off. */
	min?: number;
	/** Pixel sizes for srcs the template does not carry itself. */
	pixelSize?: (src: string) => Size | undefined;
};

export type ImageDpiIssue = {
	/** Frame index in `template_data`. */
	side: number;
	id: string;
	src: string;
	/** The effective resolution, rounded down. */
	dpi: number;
	min: number;
};

function framingOf(el: Element | Background): ImageFraming | undefined {
	if (el.type !== "image") return undefined;
	const focus = parseImageFocus(el.properties.focus);
	return {
		fit: el.properties.fit,
		...(el.properties.crop ? { crop: el.properties.crop } : {}),
		...(focus ? { focus } : {}),
	};
}

/**
 * Image layers whose fixed src prints below `min` at `dpi`. A src bound to a
 * field is known only at render time; `imageDpiWarnings` checks those.
 */
export function imageDpiIssues(
	t: Pick<Template, "width" | "height" | "assets" | "template_data">,
	options: ImageDpiOptions = {},
): ImageDpiIssue[] {
	const dpi = options.dpi ?? DEFAULT_IMAGE_DPI_UNITS;
	const min = options.min ?? DEFAULT_MIN_IMAGE_DPI;
	if (!(min > 0) || !(dpi > 0)) return [];
	const sizeOf = (src: string) =>
		inlineImageSize(t, src) ?? options.pixelSize?.(src);
	const out: ImageDpiIssue[] = [];
	t.template_data.forEach((frame, side) => {
		const check = (el: Element | Background, placed: Size | undefined) => {
			const framing = framingOf(el);
			if (!framing || !placed || el.type !== "image") return;
			const src = el.properties.src;
			if (src === "" || hasToken(src)) return;
			const pixels = sizeOf(src);
			if (!pixels) return;
			const effective = effectiveImageDpi(pixels, placed, dpi, framing);
			if (effective < min)
				out.push({ side, id: el.id, src, dpi: Math.floor(effective), min });
		};
		check(frame.background, frame.background.size ?? t);
		walkElements(frame.elements, (el) => check(el, el.size));
	});
	return out;
}

export type ImageDpiWarning = {
	kind: "image_low_dpi";
	/** The element id, when known. */
	layer?: string;
	src: string;
	/** The effective resolution, rounded down. */
	dpi: number;
	min: number;
};

function* drawnImages(
	commands: readonly unknown[],
): Generator<Extract<DrawCommand, { op: "drawImage" }>> {
	for (const c of commands as DrawCommand[]) {
		if (c.op === "drawImage") yield c;
		if (c.op === "drawGroup") yield* drawnImages(c.children);
		if (c.op === "drawMasked") yield* drawnImages([c.mask, ...c.children]);
	}
}

export type ImageSizeMemo = {
	get(src: string): Promise<Size | undefined> | undefined;
	set(src: string, size: Promise<Size | undefined>): void;
};

/**
 * The images a compiled scene draws below `min` at `dpi` design units to
 * the inch, each layer once. `load` gives a src's bytes, as the paint reads
 * them; a src it cannot give is skipped, and so is one `skip` names. `sizes`
 * keeps what was read across calls.
 */
export async function imageDpiWarnings(
	commands: readonly unknown[],
	load: (src: string) => Promise<Uint8Array | undefined>,
	options: {
		dpi: number;
		min?: number;
		skip?: (src: string) => boolean;
		sizes?: ImageSizeMemo;
	},
): Promise<ImageDpiWarning[]> {
	const min = options.min ?? DEFAULT_MIN_IMAGE_DPI;
	if (!(min > 0) || !(options.dpi > 0)) return [];
	const sizes = options.sizes ?? new Map<string, Promise<Size | undefined>>();
	const sizeOf = (src: string) => {
		let size = sizes.get(src);
		if (!size) {
			size = load(src).then(
				(bytes) => (bytes ? imagePixelSize(bytes) : undefined),
				() => undefined,
			);
			sizes.set(src, size);
		}
		return size;
	};
	const out: ImageDpiWarning[] = [];
	const seen = new Set<string>();
	for (const cmd of drawnImages(commands)) {
		if (!cmd.src || options.skip?.(cmd.src)) continue;
		const pixels = await sizeOf(cmd.src);
		if (!pixels) continue;
		const effective = effectiveImageDpi(pixels, cmd.size, options.dpi, cmd);
		if (effective >= min) continue;
		const key = `${cmd.id ?? ""}\n${cmd.src}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			kind: "image_low_dpi",
			...(cmd.id !== undefined ? { layer: cmd.id } : {}),
			src: cmd.src,
			dpi: Math.floor(effective),
			min,
		});
	}
	return out;
}
