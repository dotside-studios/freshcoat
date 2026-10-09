import type { Element, Insets, Sides, Template } from "./types";

export const NO_INSETS: Sides = { top: 0, right: 0, bottom: 0, left: 0 };

export function resolveInsets(insets: Insets | undefined): Sides {
	if (insets === undefined) return NO_INSETS;
	if (typeof insets === "number")
		return { top: insets, right: insets, bottom: insets, left: insets };
	return insets;
}

/** The inverse of `resolveInsets`: one number when every side is the same. */
export function compactInsets(sides: Sides): Insets {
	return sides.top === sides.right &&
		sides.top === sides.bottom &&
		sides.top === sides.left
		? sides.top
		: { ...sides };
}

/** The largest inset on each side. */
export function maxInsets(all: readonly Sides[]): Sides {
	return all.reduce(
		(m, s) => ({
			top: Math.max(m.top, s.top),
			right: Math.max(m.right, s.right),
			bottom: Math.max(m.bottom, s.bottom),
			left: Math.max(m.left, s.left),
		}),
		all[0] ?? NO_INSETS,
	);
}

export function hasInsets(sides: Sides): boolean {
	return sides.top > 0 || sides.right > 0 || sides.bottom > 0 || sides.left > 0;
}

/** The template's bleed on each side, in design units. */
export function templateBleed(t: Pick<Template, "bleed">): Sides {
	return resolveInsets(t.bleed);
}

/** The template's safe area on each side, in design units. */
export function templateSafeArea(t: Pick<Template, "safeArea">): Sides {
	return resolveInsets(t.safeArea);
}

/** The size a render with bleed comes out at, in design units. */
export function bleedSize(t: Pick<Template, "width" | "height" | "bleed">): {
	width: number;
	height: number;
} {
	const b = templateBleed(t);
	return {
		width: t.width + b.left + b.right,
		height: t.height + b.top + b.bottom,
	};
}

export const MM_PER_INCH = 25.4;

export type CardSizeMm = { widthMm: number; heightMm: number };

/** Artwork past each edge of the trim, in millimetres. */
export type BleedMm = Sides;

export const NO_BLEED: BleedMm = NO_INSETS;

export function resolveBleedMm(bleed: number | BleedMm | undefined): BleedMm {
	return resolveInsets(bleed);
}

/** The bleed a template of this many pixels of bleed prints at at this DPI. */
export function bleedMm(
	bleedPx: Sides,
	dpi: number,
): BleedMm {
	const mm = (px: number) => (px / dpi) * MM_PER_INCH;
	return {
		top: mm(bleedPx.top),
		right: mm(bleedPx.right),
		bottom: mm(bleedPx.bottom),
		left: mm(bleedPx.left),
	};
}

/** The card size a template of this many pixels prints at at this DPI. */
export function cardSizeMm(
	widthPx: number,
	heightPx: number,
	dpi: number,
): CardSizeMm {
	return {
		widthMm: (widthPx / dpi) * MM_PER_INCH,
		heightMm: (heightPx / dpi) * MM_PER_INCH,
	};
}

// Within this of a trim edge, a layer counts as running to it.
const EDGE_EPSILON = 0.5;

// Only a plain fill can be stretched without changing what it shows: a stroke
// would move off the card, text and codes would move, and a vector would
// distort.
function extendable(el: Element): boolean {
	if ((el.rotation ?? 0) % 360 !== 0 || !el.size) return false;
	if (el.type === "rect" || el.type === "image")
		return el.properties.stroke === undefined;
	if (el.type === "frame")
		return (
			el.properties.stroke === undefined && el.properties.layout === undefined
		);
	return false;
}

/**
 * Top-level layers that run to a trim edge, grown past it by the bleed on
 * that side. A frame's children keep their place on the card. Anything else
 * keeps its box, and whatever of it lies past the trim is drawn as it is.
 */
export function extendIntoBleed(
	elements: Element[],
	trim: { width: number; height: number },
	bleed: Sides,
): Element[] {
	if (!hasInsets(bleed)) return elements;
	return elements.map((el) => {
		if (!extendable(el) || !el.size) return el;
		const x = el.pos?.x ?? 0;
		const y = el.pos?.y ?? 0;
		const { width, height } = el.size;
		const left = Math.abs(x) <= EDGE_EPSILON ? bleed.left : 0;
		const top = Math.abs(y) <= EDGE_EPSILON ? bleed.top : 0;
		const right =
			Math.abs(x + width - trim.width) <= EDGE_EPSILON ? bleed.right : 0;
		const bottom =
			Math.abs(y + height - trim.height) <= EDGE_EPSILON ? bleed.bottom : 0;
		if (left === 0 && top === 0 && right === 0 && bottom === 0) return el;
		const grown = {
			...el,
			pos: { x: x - left, y: y - top },
			size: { width: width + left + right, height: height + top + bottom },
		} as Element;
		if (grown.type !== "frame" || (left === 0 && top === 0)) return grown;
		return {
			...grown,
			properties: {
				...grown.properties,
				children: grown.properties.children.map((c) => ({
					...c,
					pos: { x: (c.pos?.x ?? 0) + left, y: (c.pos?.y ?? 0) + top },
				})),
			},
		};
	});
}

/** Moves top-level layers from trim coordinates to the bleed box's. */
export function offsetElements(
	elements: Element[],
	dx: number,
	dy: number,
): Element[] {
	if (dx === 0 && dy === 0) return elements;
	return elements.map((el) => ({
		...el,
		pos: { x: (el.pos?.x ?? 0) + dx, y: (el.pos?.y ?? 0) + dy },
	}));
}
