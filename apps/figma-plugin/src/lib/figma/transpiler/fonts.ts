import { childElements, type Element } from "@freshcoat-js/coatfile";
import { SYSTEM_SAFE } from "./font-catalog";

export type GoogleFontDescriptor = {
	kind: "google";
	family: string;
	url: string;
};

export function googleCss2Url(
	family: string,
	weights: number[],
	italic: boolean,
): string {
	const fam = family.replace(/ /g, "+");
	const ws = [...new Set(weights.length > 0 ? weights : [400])].sort(
		(a, b) => a - b,
	);
	const axis = italic
		? `ital,wght@${ws.flatMap((w) => [`0,${w}`, `1,${w}`]).join(";")}`
		: `wght@${ws.join(";")}`;
	return `https://fonts.googleapis.com/css2?family=${fam}:${axis}&display=swap`;
}

type Used = { weights: Set<number>; italic: boolean };
type FontLike = { family?: unknown; weight?: unknown; style?: unknown };

function addFont(map: Map<string, Used>, font: FontLike | undefined): void {
	if (!font || typeof font.family !== "string" || font.family.length === 0)
		return;
	const u = map.get(font.family) ?? {
		weights: new Set<number>(),
		italic: false,
	};
	if (typeof font.weight === "number") u.weights.add(font.weight);
	if (font.style === "italic") u.italic = true;
	map.set(font.family, u);
}

function walk(elements: Element[] | undefined, map: Map<string, Used>): void {
	for (const el of elements ?? []) {
		if (el.type === "text") {
			const base = el.properties.font;
			addFont(map, base);
			// A span inherits whatever of the base font it does not override.
			for (const s of el.properties.spans ?? [])
				if (s.font) addFont(map, { ...base, ...s.font });
		} else {
			walk(childElements(el), map);
		}
	}
}

// Figma's font catalog is Google Fonts, so every non-system family is declared as
// Google. System fonts (in SYSTEM_SAFE) are filtered out — they resolve on the OS
// and cannot be web-declared. A partial block (some families undeclared) is valid;
// omitted families fall back at render via the painter's name-guess.
export function collectFontDescriptors(
	templateData: Array<{ elements?: unknown[] }>,
): GoogleFontDescriptor[] {
	const used = new Map<string, Used>();
	for (const frame of templateData)
		walk(frame.elements as Element[] | undefined, used);

	const descriptors: GoogleFontDescriptor[] = [];
	for (const family of used.keys()) {
		if (SYSTEM_SAFE.has(family)) continue;
		const u = used.get(family);
		if (!u) continue;
		descriptors.push({
			kind: "google",
			family,
			url: googleCss2Url(family, [...u.weights], u.italic),
		});
	}
	return descriptors;
}
