import type { FontRequest } from "@freshcoat-js/engine";
import {
	type ByteLoader,
	type FontFetch,
	fontBytes,
	fontRequestKey,
	googleCss2Url,
} from "@freshcoat-js/engine";
import { resolveFontRequest } from "@freshcoat-js/engine/internal";
import {
	barcodeFontFamily,
	defaultFontFamily,
	fontUsage,
	withVariants,
} from "./font-usage";
import { walkElements } from "./tree";
import type { Template } from "./types";

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
		for (const frame of t.template_data)
			walkElements(frame.elements, (el) => {
				if (el.type === "text") usedFamilies.add(el.properties.font.family);
				if (el.type === "barcode") {
					const family = barcodeFontFamily(el, fallbackFamily);
					if (family) usedFamilies.add(family);
				}
			});
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

export type FontFallback = {
	// Namespaces cache keys, so two fallbacks never share entries.
	id: string;
	load(family: string, weights: number[]): Promise<Uint8Array[]>;
};

export function googleFonts(
	opts: { fetch?: FontFetch; load?: ByteLoader } = {},
): FontFallback {
	return {
		id: "google",
		load: (family, weights) =>
			fontBytes(
				{
					kind: "descriptor",
					descriptor: {
						kind: "google",
						family,
						url: googleCss2Url(family, weights),
					},
				},
				opts.load,
				opts.fetch,
			),
	};
}

export type ResolveTemplateFontsOptions = {
	// Every http(s) request goes through it; the global fetch when omitted.
	fetch?: FontFetch;
	// Reads a `local` font file src that is neither data: nor http(s).
	load?: ByteLoader;
	// Looks up a family the `fonts` block does not declare. Google Fonts when
	// omitted, which sends those family names to Google; null disables the
	// lookup.
	fallback?: FontFallback | null;
	// Holds fetched bytes across calls. An empty result is deleted again, so a
	// family that failed is retried on the next call.
	cache?: FontCache;
};

export type ResolvedTemplateFonts = {
	// Font bytes per family, in the order the template uses them.
	fonts: Map<string, Uint8Array[]>;
	// Families the template declares in its `fonts` block.
	declared: string[];
	// Undeclared families the fallback had under that name.
	guessed: string[];
	// Families nothing produced bytes for. Their text paints with a fallback face.
	missing: string[];
};

// Load every font a template's text and barcodes need, in the base design and
// each variant. A declared family loads from its descriptor. A family the
// `fonts` block does not describe is looked up by name through the fallback
// (Google Fonts by default), at the weights the template uses it at. One family
// that fails never takes the others with it: it is reported as missing.
export async function resolveTemplateFonts(
	template: Template,
	options: ResolveTemplateFontsOptions = {},
): Promise<ResolvedTemplateFonts> {
	const { fetch, load, cache } = options;
	const fallback =
		options.fallback === undefined
			? googleFonts({ fetch, load })
			: options.fallback;
	const usage = fontUsage(template);

	const results = await Promise.all(
		collectFontRequests(template).map(async (request) => {
			if ("descriptor" in request) {
				const bytes = await cached(cache, `d:${fontRequestKey(request)}`, () =>
					fontBytes(resolveFontRequest(request), load, fetch),
				);
				return { family: request.family, bytes, guessed: false };
			}
			if (!fallback)
				return { family: request.family, bytes: [], guessed: true };
			const wanted = usage.get(request.family)?.weights ?? [400];
			const bytes = await cached(
				cache,
				`g:${fallback.id}:${request.family}:${wanted.join(",")}`,
				() => fallback.load(request.family, wanted),
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
// describes, with no fallback lookup and no report.
export async function collectFontBytes(
	template: Template,
	options: Omit<ResolveTemplateFontsOptions, "fallback"> = {},
): Promise<Map<string, Uint8Array[]>> {
	return (await resolveTemplateFonts(template, { ...options, fallback: null }))
		.fonts;
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
	if (bytes.length === 0 && cache.get(key) === pending) cache.delete(key);
	return bytes;
}
