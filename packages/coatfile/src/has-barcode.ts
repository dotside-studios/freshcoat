import { childElements } from "./tree";
import type { Background, Element, Template } from "./types";

/** Whether any side of `template` draws a barcode, at any depth. */
export function hasBarcode(template: Template): boolean {
	const walk = (el: Element | Background): boolean =>
		el.type === "barcode" || childElements(el).some(walk);
	return template.template_data.some(
		(frame) => walk(frame.background) || frame.elements.some(walk),
	);
}
