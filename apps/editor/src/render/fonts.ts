import {
	type Background,
	childElements,
	collectFontRequests,
	type Element,
	type Template,
} from "@freshcoat/coatfile";
import { fontBytes, resolveFontRequest } from "freshcoat";

export type ResolvedTemplateFonts = {
	/** Font bytes per family — what the CanvasKit painter shapes and measures with. */
	fonts: Map<string, Uint8Array[]>;
	/** Families the file declares in its `fonts` block. */
	declared: string[];
	/** Undeclared families that Google Fonts happened to have under that name. */
	guessed: string[];
	/** Families nothing produced bytes for. Their text paints with a fallback face. */
	missing: string[];
};

/**
 * Load every font a template's text needs, in the browser.
 *
 * A template's `fonts` block is optional and the kit is deliberately lax about
 * it, so an export can name a family it never describes. The order pipeline
 * covers that gap with fonts stored against the template record; a tool that
 * only ever sees the file has no such record, and text in an undeclared family
 * would paint as nothing at all. So an undeclared family is looked up on Google
 * Fonts by name — the same place the declared `kind: "google"` descriptors point
 * at — and the report says which families came from that guess.
 */
export async function resolveTemplateFonts(
	template: Template,
): Promise<ResolvedTemplateFonts> {
	const requests = collectFontRequests(template);
	const weights = weightsByFamily(template);
	const fonts = new Map<string, Uint8Array[]>();
	const declared: string[] = [];
	const guessed: string[] = [];
	const missing: string[] = [];

	const results = await Promise.all(
		requests.map(async (request) => {
			if ("descriptor" in request) {
				const bytes = await cached(`d:${requestKey(request)}`, () =>
					fontBytes(resolveFontRequest(request)).catch(() => []),
				);
				return { family: request.family, bytes, guessed: false };
			}
			const wanted = weights.get(request.family) ?? new Set([400]);
			const bytes = await cached(
				`g:${request.family}:${[...wanted].sort().join(",")}`,
				() => googleFontBytes(request.family, wanted),
			);
			return { family: request.family, bytes, guessed: true };
		}),
	);

	// Insertion order is the fallback chain order, so keep the request order.
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

/**
 * Every weight the template asks for, in one stylesheet — the same URL shape a
 * template's own `fonts` block declares. The coat engine loads every face the
 * stylesheet lists, so one request covers all the weights and subsets.
 * A family Google doesn't know 404s, and the caller records it as missing.
 */
async function googleFontBytes(
	family: string,
	weights: ReadonlySet<number>,
): Promise<Uint8Array[]> {
	const wght = [...weights].sort((a, b) => a - b).join(";");
	const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
		family,
	)}:wght@${wght}&display=swap`;
	return fontBytes({
		kind: "descriptor",
		descriptor: { kind: "google", family, url },
	}).catch(() => [] as Uint8Array[]);
}

/** The weights each family is actually used at, so no face is fetched needlessly. */
function weightsByFamily(template: Template): Map<string, Set<number>> {
	const out = new Map<string, Set<number>>();
	const add = (family: string, weight: number) => {
		const set = out.get(family);
		if (set) set.add(weight);
		else out.set(family, new Set([weight]));
	};

	const walk = (element: Element | Background) => {
		if (element.type === "text") {
			const { font, spans } = element.properties;
			add(font.family, font.weight ?? 400);
			for (const span of spans ?? []) {
				if (!span.font) continue;
				add(
					span.font.family ?? font.family,
					span.font.weight ?? font.weight ?? 400,
				);
			}
		}
		for (const child of childElements(element)) walk(child);
	};

	for (const frame of template.template_data) {
		walk(frame.background);
		for (const element of frame.elements) walk(element);
	}
	return out;
}

const bytesCache = new Map<string, Promise<Uint8Array[]>>();

/** Font bytes are fetched once per session per source; an empty answer is not
 *  kept, so a family that failed on a flaky network is retried next time. */
function cached(
	key: string,
	load: () => Promise<Uint8Array[]>,
): Promise<Uint8Array[]> {
	const hit = bytesCache.get(key);
	if (hit) return hit;
	const pending = load().then((bytes) => {
		if (bytes.length === 0) bytesCache.delete(key);
		return bytes;
	});
	bytesCache.set(key, pending);
	return pending;
}

function requestKey(
	request: Extract<
		ReturnType<typeof collectFontRequests>[number],
		{ descriptor: unknown }
	>,
): string {
	const d = request.descriptor;
	return d.kind === "local"
		? `${request.family}:local:${d.files.map((f) => `${f.weight}/${f.style ?? ""}/${f.src.length}/${f.src.slice(-48)}`).join(",")}`
		: `${request.family}:${d.kind}:${d.url}`;
}
