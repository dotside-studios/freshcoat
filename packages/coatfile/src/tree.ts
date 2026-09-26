import type { Background, Element } from "./types";

/** The elements nested directly inside one: a frame's children, or a mask's
 *  shape followed by the content it masks. */
export function childElements(el: Element | Background): Element[] {
	if (el.type === "frame") return el.properties.children;
	if (el.type === "mask")
		return [el.properties.mask, ...el.properties.children];
	return [];
}
