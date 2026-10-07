import { parseSvg } from "@freshcoat-js/engine/svg";
import { looksLikeSvg } from "./svg";

export { type SvgElements, svgToElements } from "@freshcoat-js/coatfile/svg";

type Size = { width: number; height: number };

/** The trimmed markup when `text` is one well-formed SVG document. */
export function svgMarkup(text: string): string | null {
	const trimmed = text.trim();
	if (!looksLikeSvg(trimmed)) return null;
	try {
		parseSvg(trimmed);
		return trimmed;
	} catch {
		return null;
	}
}

export function svgSize(markup: string): Size {
	const { width, height } = parseSvg(markup);
	return { width, height };
}
