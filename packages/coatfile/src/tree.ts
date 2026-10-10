import type { Background, Element } from "./types";

/** The elements nested directly inside one: a frame's children, a mask's
 *  shape followed by the content it masks, or the operands of a vector's
 *  boolean operation. */
export function childElements(el: Element | Background): Element[] {
	if (el.type === "frame") return el.properties.children;
	if (el.type === "mask")
		return [el.properties.mask, ...el.properties.children];
	if (el.type === "vector") return el.properties.boolean?.operands ?? [];
	return [];
}

/** Visits every element in `elements` and everything nested in it, each one
 *  before what it holds and in `childElements` order. A visit that returns
 *  false skips that element's contents. */
export function walkElements(
	elements: readonly Element[],
	visit: (el: Element) => boolean | void,
): void {
	for (const el of elements)
		if (visit(el) !== false) walkElements(childElements(el), visit);
}

/** Every element in `elements` and nested in them, in `walkElements` order. */
export function allElements(elements: readonly Element[]): Element[] {
	const out: Element[] = [];
	walkElements(elements, (el) => {
		out.push(el);
	});
	return out;
}
