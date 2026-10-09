// Laying a design out at a size other than the one it was drawn at. Each
// element is re-placed against its parent's change in size by its
// `constraints`, as Figma does, and a frame or mask whose own box changed
// re-places its children the same way. The result is an ordinary template at
// the new size, so compile, the editor and anything else read it unchanged.

import { resizeBackground, resizeFrames, sameSize } from "./relayout";
import type { Element, Size, Template, Variant } from "./types";
import { applyVariant, type VariantElementDelta } from "./variants";

export {
	barcodeBox,
	constrainBox,
	resizeElements,
	resizeVectorPath,
} from "./relayout";

/**
 * The template laid out at `width` x `height` design units: every frame's
 * elements re-placed by their constraints, and the template's own size
 * changed. The same size returns the template itself.
 *
 * Variants are carried: each is applied, the result resized, and its deltas
 * rewritten so every `pos` and `size` a delta already had takes the value its
 * element ends up with, and every override background the resized one. A
 * vector's delta also takes the path its element ends up with when it already
 * set `d`, or when its own `size` makes that path differ from the resized
 * base's. A delta gains no other keys, so one that only recolours stays that
 * way. A variant with its own `size` is laid out from the base at that size,
 * so it is kept as it is.
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
			v.size ? v : resizeVariant(template, resized, v, width, height),
		),
	};
}

function resizeVariant(
	template: Template,
	resized: Template,
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
			const baseFrame = resized.template_data.find((f) => f.name === ov.name);
			const baseById = baseFrame
				? elementsById(baseFrame.elements)
				: new Map<string, Element>();
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
									...(el.type === "vector" &&
									vectorPathChanged(d, el, baseById.get(d.id))
										? { properties: { ...d.properties, d: el.properties.d } }
										: {}),
								};
							}),
						}
					: {}),
			};
		}),
	};
}

function vectorPathChanged(
	delta: VariantElementDelta,
	el: Extract<Element, { type: "vector" }>,
	base: Element | undefined,
): boolean {
	if (delta.properties?.d !== undefined) return true;
	return base?.type === "vector" && base.properties.d !== el.properties.d;
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
