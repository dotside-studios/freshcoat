import { childElements } from "./tree";
import type {
	Background,
	BarcodeElement,
	Element,
	FontRequest,
	Template,
} from "./types";
import { applyVariant } from "./variants";

export type FontUsage = { weights: number[]; italic: boolean };

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
export function withVariants(template: Template): Template[] {
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

// The weights and italics each family is used at, across text, spans and
// barcodes in the base design and each variant, in first-use order.
export function fontUsage(template: Template): Map<string, FontUsage> {
	const used = new Map<string, { weights: Set<number>; italic: boolean }>();
	const add = (family: string, weight: number, italic: boolean) => {
		if (!family) return;
		const u = used.get(family);
		if (u) {
			u.weights.add(weight);
			u.italic ||= italic;
		} else used.set(family, { weights: new Set([weight]), italic });
	};
	for (const t of withVariants(template)) {
		const fallbackFamily = defaultFontFamily(t);
		const walk = (el: Element | Background) => {
			if (el.type === "text") {
				const { font, spans } = el.properties;
				add(font.family, font.weight ?? 400, font.style === "italic");
				for (const span of spans ?? []) {
					if (!span.font) continue;
					add(
						span.font.family ?? font.family,
						span.font.weight ?? font.weight ?? 400,
						(span.font.style ?? font.style) === "italic",
					);
				}
			}
			if (el.type === "barcode") {
				const family = barcodeFontFamily(el, fallbackFamily);
				if (family) add(family, 400, false);
			}
			for (const child of childElements(el)) walk(child);
		};
		for (const frame of t.template_data) {
			walk(frame.background);
			for (const el of frame.elements) walk(el);
		}
	}
	const out = new Map<string, FontUsage>();
	for (const [family, u] of used)
		out.set(family, {
			weights: [...u.weights].sort((a, b) => a - b),
			italic: u.italic,
		});
	return out;
}

const CSS2 = "https://fonts.googleapis.com/css2";

// The css2 `family` parameter: each word URI-encoded, joined by `+`.
export function googleFamilyParam(family: string): string {
	return family.trim().split(/\s+/).map(encodeURIComponent).join("+");
}

// A Google Fonts css2 stylesheet URL. Without `weights` it asks for the
// family's default face; an empty list asks for 400. `italic` adds the italic
// of every weight.
export function googleCss2Url(
	family: string,
	weights?: Iterable<number>,
	italic = false,
): string {
	const name = googleFamilyParam(family);
	if (weights === undefined) return `${CSS2}?family=${name}&display=swap`;
	const ws = [...new Set(weights)].sort((a, b) => a - b);
	if (ws.length === 0) ws.push(400);
	const axes = italic
		? `ital,wght@${[...ws.map((w) => `0,${w}`), ...ws.map((w) => `1,${w}`)].join(";")}`
		: `wght@${ws.join(";")}`;
	return `${CSS2}?family=${name}:${axes}&display=swap`;
}

// Identifies the bytes a request resolves to, for caching. A data: src can be
// large; its length and tail identify it well enough.
export function fontRequestKey(request: FontRequest): string {
	if (!("descriptor" in request)) return `${request.family}:none`;
	const d = request.descriptor;
	return d.kind === "local"
		? `${request.family}:local:${d.files.map((f) => `${f.weight}/${f.style ?? ""}/${f.src.length}/${f.src.slice(-48)}`).join(",")}`
		: `${request.family}:${d.kind}:${d.url}`;
}
