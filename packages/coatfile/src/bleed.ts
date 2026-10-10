import { rotatedFootprint } from "@freshcoat-js/engine";
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
export function bleedMm(bleedPx: Sides, dpi: number): BleedMm {
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

export type SafeAreaEdge = "left" | "top" | "right" | "bottom";

export type SafeAreaIssue = {
	/** Frame index in `template_data`. */
	side: number;
	/** Index of the top-level layer in its frame. */
	index: number;
	id: string;
	/** The edges that lie between the trim and the safe line. */
	edges: SafeAreaEdge[];
};

const SAFE_EDGES: SafeAreaEdge[] = ["left", "top", "right", "bottom"];

function rotatedBox(el: Element): [number, number, number, number] | null {
	if (!el.size) return null;
	const { width, height } = rotatedFootprint(el.size, el.rotation);
	const cx = (el.pos?.x ?? 0) + el.size.width / 2;
	const cy = (el.pos?.y ?? 0) + el.size.height / 2;
	return [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2];
}

/**
 * Top-level layers with an edge between the trim and the safe line: close
 * enough to the cut that it may take part of them. A layer that runs to the
 * trim or past it is bleed, drawn to be cut, and is left alone. `safe`
 * defaults to the template's own safe area; with none there are no issues.
 */
export function safeAreaIssues(
	t: Pick<Template, "width" | "height" | "safeArea" | "template_data">,
	options: { safe?: Sides } = {},
): SafeAreaIssue[] {
	const safe = options.safe ?? templateSafeArea(t);
	if (!hasInsets(safe)) return [];
	const insets = [safe.left, safe.top, safe.right, safe.bottom];
	const inBand = (d: number, i: number) =>
		d > EDGE_EPSILON && d < (insets[i] as number) - EDGE_EPSILON;
	const out: SafeAreaIssue[] = [];
	t.template_data.forEach((frame, side) => {
		frame.elements.forEach((el, index) => {
			const b = rotatedBox(el);
			if (!b) return;
			const gaps = [b[0], b[1], t.width - b[2], t.height - b[3]];
			const edges = SAFE_EDGES.filter((_, i) => inBand(gaps[i] as number, i));
			if (edges.length > 0) out.push({ side, index, id: el.id, edges });
		});
	});
	return out;
}

// A CR80 card is 85.60 x 53.98 mm with corners cut to a 3.18 mm radius, and
// the printer keeps 3 mm inside the trim clear of anything that must survive
// the cut. The guides are sized from the template's own long side, so a
// portrait card or a 1013-wide design gets the same physical insets.
export const CR80_LONG_MM = 85.6;
export const CR80_CORNER_MM = 3.18;
export const CR80_SAFE_MM = 3;

export type PrintGuideMetrics = {
	/** Trim corner radius, in template units. */
	corner: number;
	/** Safe-area inset from every edge, in template units. */
	safe: number;
};

export function printGuideMetrics(
	t: Pick<Template, "width" | "height">,
): PrintGuideMetrics {
	const perMm = Math.max(t.width, t.height) / CR80_LONG_MM;
	return { corner: CR80_CORNER_MM * perMm, safe: CR80_SAFE_MM * perMm };
}

/** Whether a template is one the print guides describe. */
export function isPrintedCard(t: Pick<Template, "product">): boolean {
	return t.product === "card_cr80";
}

export type PrintGuideSet = {
	/** Trim corner radius, in template units; 0 for square corners. */
	corner: number;
	/** Safe-area inset from each edge, in template units. */
	safe: Sides | null;
	/** Bleed past each edge, in template units. */
	bleed: Sides;
};

/** The guides a template shows: its own safe area and bleed, and for a CR80
 *  card the trim corners and, unless it sets its own, the printer's safe
 *  area. */
export function printGuidesFor(
	t: Pick<Template, "width" | "height" | "product" | "bleed" | "safeArea">,
): PrintGuideSet {
	const cr80 = isPrintedCard(t) ? printGuideMetrics(t) : null;
	const own = templateSafeArea(t);
	const safe = hasInsets(own)
		? own
		: cr80
			? { top: cr80.safe, right: cr80.safe, bottom: cr80.safe, left: cr80.safe }
			: null;
	return { corner: cr80?.corner ?? 0, safe, bleed: templateBleed(t) };
}
