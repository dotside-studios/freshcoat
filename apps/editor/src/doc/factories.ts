import {
	type Element,
	isEllipsePath,
	isLinearSymbology,
	isSquareSymbology,
	type Symbology,
	type Template,
} from "@freshcoat-js/coatfile";
import { uniqueId } from "./ids";

export type ElementKind =
	| "rect"
	| "ellipse"
	| "text"
	| "image"
	| "qr"
	| "barcode"
	| "frame";

export type BoxLike = { x: number; y: number; width: number; height: number };

export const DEFAULT_FONT_FAMILY = "Vend Sans";
export const DEFAULT_FILL = "#d9d9d9";
export const MIN_SIZE = 1;

const BASE_ID: Record<ElementKind, string> = {
	rect: "rect",
	ellipse: "ellipse",
	text: "text",
	image: "image",
	qr: "qr",
	barcode: "barcode",
	frame: "frame",
};

/**
 * A new element of `kind` at `rect` (parent-relative), with an id unused on the
 * side. `src` is the image kind's source.
 */
export function createElement(
	kind: ElementKind,
	rect: BoxLike,
	t: Template,
	side: number,
	opts: { src?: string } = {},
): Element {
	const width = round2(Math.max(MIN_SIZE, rect.width));
	const height = round2(Math.max(MIN_SIZE, rect.height));
	const shell = {
		id: uniqueId(t, side, BASE_ID[kind]),
		pos: { x: round2(rect.x), y: round2(rect.y) },
		size: { width, height },
	};
	switch (kind) {
		case "rect":
			return { ...shell, type: "rect", properties: { fill: DEFAULT_FILL } };
		case "ellipse":
			return {
				...shell,
				type: "vector",
				properties: { d: ellipsePath(width, height), fill: DEFAULT_FILL },
			};
		case "text":
			return {
				...shell,
				type: "text",
				properties: {
					value: "Text",
					font: {
						family: t.fonts?.[0]?.family ?? DEFAULT_FONT_FAMILY,
						size: 32,
						weight: 400,
					},
					color: "#111111",
				},
			};
		case "image":
			return {
				...shell,
				type: "image",
				properties: { src: opts.src ?? "", fit: "cover" },
			};
		case "qr":
			return {
				...shell,
				type: "qr_code",
				properties: { value: "https://example.com", errorCorrection: "M" },
			};
		case "barcode":
			return {
				...shell,
				type: "barcode",
				properties: { value: "FRESHCOAT", symbology: "code128" },
			};
		case "frame":
			return {
				...shell,
				type: "frame",
				properties: { fill: "#ffffff", children: [] },
			};
	}
}

/** The box a click without a drag places, centred on `point`. */
export function defaultRect(
	kind: ElementKind,
	point: { x: number; y: number },
	t: Pick<Template, "width" | "height">,
): BoxLike {
	const [width, height] =
		kind === "text"
			? [240, 48]
			: kind === "barcode"
				? barcodeBox(t)
				: Array(2).fill(Math.min(200, Math.min(t.width, t.height) / 4));
	return {
		x: round2(point.x - width / 2),
		y: round2(point.y - height / 2),
		width,
		height,
	};
}

export const BARCODE_SIZE = { width: 360, height: 120 };

/** The default barcode box, shrunk to fit a small artboard at the same aspect. */
function barcodeBox(t: Pick<Template, "width" | "height">): [number, number] {
	const fit = Math.min(1, (t.width * 0.8) / BARCODE_SIZE.width);
	return [round2(BARCODE_SIZE.width * fit), round2(BARCODE_SIZE.height * fit)];
}

type BarcodeBox = {
	pos: { x: number; y: number };
	size: { width: number; height: number };
};

/**
 * The box a barcode takes when its symbology changes from `from` to `to`.
 * A Data Matrix or Aztec code only reads square, so a box that isn't becomes
 * a square of its shorter side. Leaving one for a 1D code turns that square
 * back into a bar code's proportion: the width is kept and the height becomes
 * a third of it, as the tool's default box is. Either way the centre stays
 * put. Anything else keeps its box. Null means no change.
 */
export function barcodeBoxFor(
	box: BarcodeBox,
	from: Symbology,
	to: Symbology,
): BarcodeBox | null {
	const { width, height } = box.size;
	let next: { width: number; height: number } | null = null;
	if (isSquareSymbology(to)) {
		const side = Math.min(width, height);
		next = { width: side, height: side };
	} else if (isSquareSymbology(from) && isLinearSymbology(to)) {
		next = {
			width,
			height: round2((width * BARCODE_SIZE.height) / BARCODE_SIZE.width),
		};
	}
	if (
		!next ||
		(Math.abs(next.width - width) < 0.01 &&
			Math.abs(next.height - height) < 0.01)
	)
		return null;
	return {
		pos: {
			x: round2(box.pos.x + (width - next.width) / 2),
			y: round2(box.pos.y + (height - next.height) / 2),
		},
		size: next,
	};
}

/** An ellipse filling a `w`×`h` box, as two half-ellipse arcs. */
export function ellipsePath(w: number, h: number): string {
	const rx = fmt(w / 2);
	const ry = fmt(h / 2);
	const cy = fmt(h / 2);
	return `M0 ${cy}A${rx} ${ry} 0 1 0 ${fmt(w)} ${cy}A${rx} ${ry} 0 1 0 0 ${cy}Z`;
}

/** Whether `el` is a vector whose path is `ellipsePath` of its own size. The
 *  format carries no editor metadata, so this is a structural match. */
export function isEllipseVector(el: Element): boolean {
	if (el.type !== "vector" || !el.size) return false;
	return isEllipsePath(el.properties.d, el.size.width, el.size.height);
}

export function round2(n: number): number {
	const r = Math.round(n * 100) / 100;
	return r === 0 ? 0 : r;
}

function fmt(n: number): string {
	return String(Math.round(n * 1000) / 1000);
}
