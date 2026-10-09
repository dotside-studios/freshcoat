// Laying a design out at a size other than the one it was drawn at. Each
// element is re-placed against its parent's change in size by its
// `constraints`, as Figma does, and a frame or mask whose own box changed
// re-places its children the same way.

import { scalePathData } from "@freshcoat-js/engine";
import { isSquareSymbology } from "./barcode-encoder";
import type {
	Constraint,
	Element,
	Size,
	Symbology,
	Template,
	TemplateFrame,
	Vec2,
	VectorElement,
} from "./types";

type Axis = { pos: number; size: number };

// One axis of one box. `from` and `to` are the parent's extent on that axis
// before and after.
function constrainAxis(
	box: Axis,
	constraint: Constraint | undefined,
	from: number,
	to: number,
): Axis {
	const delta = to - from;
	switch (constraint) {
		case "end":
			return { pos: box.pos + delta, size: box.size };
		case "center":
			return { pos: box.pos + delta / 2, size: box.size };
		case "stretch":
			return { pos: box.pos, size: Math.max(0, box.size + delta) };
		case "scale": {
			const k = from === 0 ? 1 : to / from;
			return { pos: box.pos * k, size: box.size * k };
		}
		default:
			return box;
	}
}

/**
 * Where an element's box goes when its parent changes from `from` to `to`.
 * The box is the element's unrotated one, so a rotated element keeps its
 * rotation about its own centre and moves with the box.
 */
export function constrainBox(
	el: Pick<Element, "pos" | "size" | "constraints">,
	from: Size,
	to: Size,
): { pos: Vec2; size: Size } {
	const pos = el.pos ?? { x: 0, y: 0 };
	const size = el.size ?? { width: 0, height: 0 };
	const h = constrainAxis(
		{ pos: pos.x, size: size.width },
		el.constraints?.horizontal,
		from.width,
		to.width,
	);
	const v = constrainAxis(
		{ pos: pos.y, size: size.height },
		el.constraints?.vertical,
		from.height,
		to.height,
	);
	return {
		pos: { x: h.pos, y: v.pos },
		size: { width: h.size, height: v.size },
	};
}

export function sameSize(a: Size, b: Size): boolean {
	return a.width === b.width && a.height === b.height;
}

type Box = { pos: Vec2; size: Size };

// A QR code is only readable square, and so are Data Matrix and Aztec. When
// constraints would stretch one on one axis more than the other, it takes the
// shorter side of the box they give it and sits at that box's centre. 1D codes
// and PDF417 stretch like any box.
function staysSquare(el: Element): boolean {
	return (
		el.type === "qr_code" ||
		(el.type === "barcode" && isSquareSymbology(el.properties.symbology))
	);
}

function squareBox(box: Box): Box {
	const side = Math.min(box.size.width, box.size.height);
	return {
		pos: {
			x: box.pos.x + (box.size.width - side) / 2,
			y: box.pos.y + (box.size.height - side) / 2,
		},
		size: { width: side, height: side },
	};
}

/** The box a QR code or barcode takes in `box`. A code that only reads square
 *  takes the shorter side, centred in `box`; any other keeps `box`. */
export function barcodeBox(subject: Element | Symbology, box: Box): Box {
	const square =
		typeof subject === "string"
			? isSquareSymbology(subject)
			: staysSquare(subject);
	return square ? squareBox(box) : box;
}

/** A vector's path for its box at `size`. The path is drawn at its authored
 *  coordinates, so it is scaled by the box's change on each axis. A vector
 *  without a size, or path data that does not parse, keeps its path. */
export function resizeVectorPath(el: VectorElement, size: Size): string {
	if (!el.size) return el.properties.d;
	return resizePath(el.properties.d, el.size, size);
}

function resizePath(d: string, before: Size, after: Size): string {
	const sx = before.width === 0 ? 1 : after.width / before.width;
	const sy = before.height === 0 ? 1 : after.height / before.height;
	try {
		return scalePathData(d, sx, sy);
	} catch {
		return d;
	}
}

function resizeElement(
	el: Element,
	from: Size,
	to: Size,
	inAutoLayout: boolean,
): Element {
	// The auto-layout places its flow children; only an absolutely positioned
	// one is placed by its own box.
	if (inAutoLayout && el.layoutChild?.absolute !== true) return el;

	let box = constrainBox(el, from, to);
	const before = el.size ?? { width: 0, height: 0 };
	if (!sameSize(box.size, before)) box = barcodeBox(el, box);

	const next = {
		...el,
		...(el.pos !== undefined || box.pos.x !== 0 || box.pos.y !== 0
			? { pos: box.pos }
			: {}),
		...(el.size !== undefined ? { size: box.size } : {}),
	} as Element;

	if (el.size === undefined || sameSize(box.size, before)) return next;
	if (next.type === "vector" && el.type === "vector") {
		return {
			...next,
			properties: {
				...next.properties,
				d: resizeVectorPath(el, box.size),
			},
		};
	}
	if (next.type === "frame") {
		const auto = next.properties.layout !== undefined;
		return {
			...next,
			properties: {
				...next.properties,
				children: next.properties.children.map((c) =>
					resizeElement(c, before, box.size, auto),
				),
			},
		};
	}
	if (next.type === "mask") {
		return {
			...next,
			properties: {
				...next.properties,
				mask: resizeElement(next.properties.mask, before, box.size, false),
				children: next.properties.children.map((c) =>
					resizeElement(c, before, box.size, false),
				),
			},
		};
	}
	return next;
}

/** Re-places `elements`, laid out in a parent of size `from`, for a parent of
 *  size `to`. Elements whose box does not move are returned as they were. */
export function resizeElements(
	elements: Element[],
	from: Size,
	to: Size,
): Element[] {
	if (sameSize(from, to)) return elements;
	return elements.map((el) => resizeElement(el, from, to, false));
}

export function resizeFrames(
	template: Template,
	width: number,
	height: number,
): Template {
	const from = { width: template.width, height: template.height };
	const to = { width, height };
	const frames: TemplateFrame[] = template.template_data.map((frame) => ({
		...frame,
		background: resizeBackground(frame.background, to),
		elements: resizeElements(frame.elements, from, to),
	}));
	return { ...template, width, height, template_data: frames };
}

export function resizeBackground<B extends { size?: Size }>(
	bg: B,
	to: Size,
): B {
	return bg.size === undefined ? bg : { ...bg, size: to };
}
