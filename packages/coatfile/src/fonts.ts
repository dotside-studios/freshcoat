import { fontBytes, resolveFontRequest } from "freshcoat";
import { childElements } from "./tree";
import type {
	Background,
	BarcodeElement,
	Element,
	FontRequest,
	Template,
} from "./types";
import { applyVariant } from "./variants";

// The family a barcode's text and placeholder label use when the element names
// none: the template's first declared font, else the first family a text
// element uses. Undefined when the template has neither, and the painter's own
// fallback draws it. A variant can change that family, so it is asked of the
// template with the variant applied, which is what `compile` draws.
export function defaultFontFamily(template: Template): string | undefined {
	const declared = template.fonts?.[0]?.family;
	if (declared) return declared;
	let found: string | undefined;
	const walk = (el: Element | Background) => {
		if (found) return;
		if (el.type === "text") {
			found = el.properties.font.family;
			return;
		}
		for (const child of childElements(el)) walk(child);
	};
	for (const frame of template.template_data) {
		walk(frame.background);
		for (const el of frame.elements) walk(el);
	}
	return found;
}

// The base design followed by each variant applied to it, which is every
// template `compile` can be asked to draw.
function withVariants(template: Template): Template[] {
	return [
		template,
		...(template.variants ?? []).map((v) => applyVariant(template, v.id)),
	];
}

export function barcodeFontFamily(
	el: BarcodeElement,
	fallback: string | undefined,
): string | undefined {
	return el.properties.fontFamily || fallback;
}

// The FontRequests a template needs, gathered exactly as compileFrame does: every
// family referenced by a text element (walking nested frames and backgrounds,
// in the base design and in each variant applied to it),
// resolved against template.fonts for a descriptor — a bare `{ family }` when the
// family isn't declared. Kept in step with compile.ts's asset collection; changing
// how one discovers fonts means changing the other.
export function collectFontRequests(template: Template): FontRequest[] {
	const declaredByFamily = new Map(
		(template.fonts ?? []).map((f) => [f.family, f] as const),
	);

	const usedFamilies = new Set<string>();
	for (const t of withVariants(template)) {
		const fallbackFamily = defaultFontFamily(t);
		const walk = (el: Element | Background) => {
			if (el.type === "text") usedFamilies.add(el.properties.font.family);
			if (el.type === "barcode") {
				const family = barcodeFontFamily(el, fallbackFamily);
				if (family) usedFamilies.add(family);
			}
			for (const child of childElements(el)) walk(child);
		};
		for (const frame of t.template_data) {
			walk(frame.background);
			for (const el of frame.elements) walk(el);
		}
	}

	return [...usedFamilies].map((family) => {
		const descriptor = declaredByFamily.get(family);
		return descriptor ? { family, descriptor } : { family };
	});
}

// Fetch every font a template uses as bytes, keyed by family: what the
// CanvasKit painter and the Paragraph text engine shape with.
//
// Resolution is per-family: a descriptor that doesn't fetch (a family declared
// against a stylesheet URL that 404s, a CDN that's down, a timeout) leaves that
// family out of the map and out of the painter's fallback chain, where it falls
// back by name. It must not take the other families with it — the map is the
// painter's ENTIRE font supply, so one dead URL propagating out of here renders
// every glyph in the template, in every family, as tofu.
export async function collectFontBytes(
	template: Template,
): Promise<Map<string, Uint8Array[]>> {
	const out = new Map<string, Uint8Array[]>();
	for (const req of collectFontRequests(template)) {
		try {
			const bytes = await fontBytes(resolveFontRequest(req));
			if (bytes.length) out.set(req.family, bytes);
		} catch {
			// Unresolvable family — see above.
		}
	}
	return out;
}
