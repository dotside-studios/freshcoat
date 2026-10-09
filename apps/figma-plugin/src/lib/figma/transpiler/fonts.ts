import type { Template } from "@freshcoat-js/coatfile";
import { fontUsage, googleCss2Url } from "@freshcoat-js/coatfile/fonts";
import { SYSTEM_SAFE } from "./font-catalog";

export type GoogleFontDescriptor = {
	kind: "google";
	family: string;
	url: string;
};

// Figma's font catalog is Google Fonts, so every non-system family is declared as
// Google. System fonts (in SYSTEM_SAFE) are filtered out — they resolve on the OS
// and cannot be web-declared. A partial block (some families undeclared) is valid;
// omitted families fall back at render via the painter's name-guess.
export function collectFontDescriptors(template: {
	template_data: unknown[];
	variants?: unknown[];
}): GoogleFontDescriptor[] {
	const descriptors: GoogleFontDescriptor[] = [];
	for (const [family, { weights, italic }] of fontUsage(
		template as unknown as Template,
	)) {
		if (SYSTEM_SAFE.has(family)) continue;
		descriptors.push({
			kind: "google",
			family,
			url: googleCss2Url(family, weights, italic),
		});
	}
	return descriptors;
}
