import {
	type ByteLoader,
	type FontFetch,
	fontBytes,
	resolveFontRequest,
} from "@freshcoat-js/engine";
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

export type FontCache = {
	get(key: string): Promise<Uint8Array[] | undefined> | undefined;
	set(key: string, bytes: Promise<Uint8Array[]>): unknown;
	delete(key: string): unknown;
};

export type ResolveTemplateFontsOptions = {
	// Every http(s) request goes through it; the global fetch when omitted.
	fetch?: FontFetch;
	// Reads a `local` font file src that is neither data: nor http(s).
	load?: ByteLoader;
	// Look an undeclared family up on Google Fonts by name. Defaults to true.
	guessGoogle?: boolean;
	// Holds fetched bytes across calls. An empty result is deleted again, so a
	// family that failed is retried on the next call.
	cache?: FontCache;
};

export type ResolvedTemplateFonts = {
	// Font bytes per family, in the order the template uses them.
	fonts: Map<string, Uint8Array[]>;
	// Families the template declares in its `fonts` block.
	declared: string[];
	// Undeclared families Google Fonts had under that name.
	guessed: string[];
	// Families nothing produced bytes for. Their text paints with a fallback face.
	missing: string[];
};

// Load every font a template's text and barcodes need, in the base design and
// each variant. A declared family loads from its descriptor. A family the
// `fonts` block does not describe is looked up on Google Fonts by name, at the
// weights the template uses it at, unless `guessGoogle` is false. One family
// that fails never takes the others with it: it is reported as missing.
export async function resolveTemplateFonts(
	template: Template,
	options: ResolveTemplateFontsOptions = {},
): Promise<ResolvedTemplateFonts> {
	const { fetch, load, cache, guessGoogle = true } = options;
	const weights = weightsByFamily(template);

	const results = await Promise.all(
		collectFontRequests(template).map(async (request) => {
			if ("descriptor" in request) {
				const bytes = await cached(cache, `d:${requestKey(request)}`, () =>
					fontBytes(resolveFontRequest(request), load, fetch),
				);
				return { family: request.family, bytes, guessed: false };
			}
			if (!guessGoogle)
				return { family: request.family, bytes: [], guessed: true };
			const wanted = [...(weights.get(request.family) ?? [400])].sort(
				(a, b) => a - b,
			);
			const bytes = await cached(
				cache,
				`g:${request.family}:${wanted.join(",")}`,
				() =>
					fontBytes(
						{
							kind: "descriptor",
							descriptor: {
								kind: "google",
								family: request.family,
								url: googleStylesheetUrl(request.family, wanted),
							},
						},
						load,
						fetch,
					),
			);
			return { family: request.family, bytes, guessed: true };
		}),
	);

	const fonts = new Map<string, Uint8Array[]>();
	const declared: string[] = [];
	const guessed: string[] = [];
	const missing: string[] = [];
	for (const { family, bytes, guessed: isGuess } of results) {
		if (!isGuess) declared.push(family);
		if (bytes.length === 0) {
			missing.push(family);
			continue;
		}
		fonts.set(family, bytes);
		if (isGuess) guessed.push(family);
	}
	return {
		fonts,
		declared: declared.sort(),
		guessed: guessed.sort(),
		missing: missing.sort(),
	};
}

// The declared-only resolution: the bytes of every family the `fonts` block
// describes, with no Google guess and no report.
export async function collectFontBytes(
	template: Template,
	options: Omit<ResolveTemplateFontsOptions, "guessGoogle"> = {},
): Promise<Map<string, Uint8Array[]>> {
	return (
		await resolveTemplateFonts(template, { ...options, guessGoogle: false })
	).fonts;
}

// One stylesheet for every weight, the URL shape a declared `google` font has.
function googleStylesheetUrl(family: string, weights: number[]): string {
	return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
		family,
	)}:wght@${weights.join(";")}&display=swap`;
}

// The weights each family is used at, across text, spans and barcodes in the
// base design and each variant, so no face is fetched needlessly.
export function weightsByFamily(template: Template): Map<string, Set<number>> {
	const out = new Map<string, Set<number>>();
	const add = (family: string, weight: number) => {
		const set = out.get(family);
		if (set) set.add(weight);
		else out.set(family, new Set([weight]));
	};
	for (const t of withVariants(template)) {
		const fallbackFamily = defaultFontFamily(t);
		const walk = (el: Element | Background) => {
			if (el.type === "text") {
				const { font, spans } = el.properties;
				add(font.family, font.weight ?? 400);
				for (const span of spans ?? []) {
					if (!span.font) continue;
					add(
						span.font.family ?? font.family,
						span.font.weight ?? font.weight ?? 400,
					);
				}
			}
			if (el.type === "barcode") {
				const family = barcodeFontFamily(el, fallbackFamily);
				if (family) add(family, 400);
			}
			for (const child of childElements(el)) walk(child);
		};
		for (const frame of t.template_data) {
			walk(frame.background);
			for (const el of frame.elements) walk(el);
		}
	}
	return out;
}

async function cached(
	cache: FontCache | undefined,
	key: string,
	fetchBytes: () => Promise<Uint8Array[]>,
): Promise<Uint8Array[]> {
	const load = () =>
		fetchBytes().then(
			(bytes) => bytes.filter((b) => b.length > 0),
			() => [] as Uint8Array[],
		);
	if (!cache) return load();
	const hit = cache.get(key);
	if (hit) {
		const bytes = await hit.catch(() => undefined);
		if (bytes?.length) return bytes;
	}
	const pending = load();
	cache.set(key, pending);
	const bytes = await pending;
	if (bytes.length === 0) cache.delete(key);
	return bytes;
}

function requestKey(
	request: Extract<FontRequest, { descriptor: unknown }>,
): string {
	const d = request.descriptor;
	return d.kind === "local"
		? `${request.family}:local:${d.files.map((f) => `${f.weight}/${f.style ?? ""}/${f.src.length}/${f.src.slice(-48)}`).join(",")}`
		: `${request.family}:${d.kind}:${d.url}`;
}
