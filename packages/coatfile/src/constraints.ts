// Laying a design out at a size other than the one it was drawn at. Each
// element is re-placed against its parent's change in size by its
// `constraints`, as Figma does, and a frame or mask whose own box changed
// re-places its children the same way. The result is an ordinary template at
// the new size, so compile, the editor and anything else read it unchanged.

import { isSquareSymbology } from "./barcode-encoder";
import type {
	Constraint,
	Element,
	Size,
	Template,
	TemplateFrame,
	Variant,
	Vec2,
} from "./types";
import { applyVariant } from "./variants";

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

function sameSize(a: Size, b: Size): boolean {
	return a.width === b.width && a.height === b.height;
}

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

function squareBox(box: { pos: Vec2; size: Size }): { pos: Vec2; size: Size } {
	const side = Math.min(box.size.width, box.size.height);
	return {
		pos: {
			x: box.pos.x + (box.size.width - side) / 2,
			y: box.pos.y + (box.size.height - side) / 2,
		},
		size: { width: side, height: side },
	};
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
	if (staysSquare(el) && !sameSize(box.size, before)) box = squareBox(box);

	const next = {
		...el,
		...(el.pos !== undefined || box.pos.x !== 0 || box.pos.y !== 0
			? { pos: box.pos }
			: {}),
		...(el.size !== undefined ? { size: box.size } : {}),
	} as Element;

	if (el.size === undefined || sameSize(box.size, before)) return next;
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

/**
 * The template laid out at `width` x `height` design units: every frame's
 * elements re-placed by their constraints, and the template's own size
 * changed. The same size returns the template itself.
 *
 * Variants are carried: each is applied, the result resized, and its deltas
 * rewritten so every `pos` and `size` a delta already had takes the value its
 * element ends up with, and every override background the resized one. A delta
 * gains no keys, so one that only recolours stays that way.
 */
export function resizeTemplate(
	template: Template,
	width: number,
	height: number,
): Template {
	const from = { width: template.width, height: template.height };
	const to = { width, height };
	if (sameSize(from, to)) return template;
	const resized = resizeFrames(template, width, height);
	if (!template.variants) return resized;
	return {
		...resized,
		variants: template.variants.map((v) =>
			resizeVariant(template, v, width, height),
		),
	};
}

function resizeFrames(
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

function resizeBackground<B extends { size?: Size }>(bg: B, to: Size): B {
	return bg.size === undefined ? bg : { ...bg, size: to };
}

function resizeVariant(
	template: Template,
	variant: Variant,
	width: number,
	height: number,
): Variant {
	const to = { width, height };
	const laidOut = resizeFrames(
		applyVariant(template, variant.id, { hidden: "keep" }),
		width,
		height,
	);
	return {
		...variant,
		overrides: variant.overrides.map((ov) => {
			const frame = laidOut.template_data.find((f) => f.name === ov.name);
			const byId = frame ? elementsById(frame.elements) : new Map();
			return {
				...ov,
				...(ov.background !== undefined
					? { background: resizeBackground(ov.background, to) }
					: {}),
				...(ov.elements !== undefined
					? {
							elements: ov.elements.map((d) => {
								const el = byId.get(d.id);
								if (!el) return d;
								return {
									...d,
									...(d.pos !== undefined && el.pos !== undefined
										? { pos: el.pos }
										: {}),
									...(d.size !== undefined && el.size !== undefined
										? { size: el.size }
										: {}),
								};
							}),
						}
					: {}),
			};
		}),
	};
}

// The first element with each id, nested ones included, as applyVariant
// reaches them.
function elementsById(elements: Element[]): Map<string, Element> {
	const out = new Map<string, Element>();
	const walk = (el: Element) => {
		if (!out.has(el.id)) out.set(el.id, el);
		if (el.type === "frame") el.properties.children.forEach(walk);
		if (el.type === "mask") {
			walk(el.properties.mask);
			el.properties.children.forEach(walk);
		}
	};
	elements.forEach(walk);
	return out;
}

/**
 * The design size to lay `template` out at for a target of `targetW` x
 * `targetH`: the target's aspect, with its shorter axis as long as the
 * template's shorter side. A mark sized in design units therefore keeps its
 * size relative to the target's short edge, whichever way the target faces.
 */
export function fitDesignSize(
	template: Pick<Template, "width" | "height">,
	targetW: number,
	targetH: number,
): Size {
	if (!(targetW > 0 && targetH > 0)) {
		throw new Error(`fitDesignSize: invalid target ${targetW}x${targetH}`);
	}
	const short = Math.min(template.width, template.height);
	return targetW <= targetH
		? { width: short, height: (short * targetH) / targetW }
		: { width: (short * targetW) / targetH, height: short };
}
