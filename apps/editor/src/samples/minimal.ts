import type { Element, Template } from "@freshcoat/coatfile";
import { fixtures } from "@freshcoat/coatfile/fixtures";
import { VEND_SANS, VEND_SANS_FAMILY } from "./vend-sans";

/** coatfile's minimal fixture, set in the embedded Vend Sans so it renders
 *  offline like every other sample. */
export function minimal(): Template {
	const t = fixtures.minimalCard;
	const setFont = (el: Element): Element =>
		el.type === "text"
			? {
					...el,
					properties: {
						...el.properties,
						font: { ...el.properties.font, family: VEND_SANS_FAMILY },
					},
				}
			: el;
	return {
		...t,
		fonts: [VEND_SANS],
		template_data: t.template_data.map((f) => ({
			...f,
			elements: f.elements.map(setFont),
		})),
	};
}
