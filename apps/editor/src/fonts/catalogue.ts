import type { FontDescriptor } from "@freshcoat-js/coatfile";

export type FontCategory =
	| "sans"
	| "serif"
	| "display"
	| "handwriting"
	| "mono";

/** One Google Fonts family, as `scripts/update-google-fonts.ts` writes it. */
export type GoogleFontRow = {
	/** family */
	f: string;
	/** category */
	c: FontCategory;
	/** weights, ascending */
	w: number[];
	/** has italics */
	i: boolean;
	/** variable */
	v: boolean;
	/** popularity rank, 1 the most used */
	p: number;
	/** subsets */
	s: string[];
};

export type GoogleFontCatalogue = {
	generatedAt: string;
	families: GoogleFontRow[];
};

let pending: Promise<GoogleFontCatalogue> | null = null;

/** The bundled catalogue, imported on first use so it stays out of startup. */
export function loadCatalogue(): Promise<GoogleFontCatalogue> {
	pending ??= import("./google-fonts.json").then(
		(m) => (m.default ?? m) as unknown as GoogleFontCatalogue,
	);
	return pending;
}

export const CATEGORIES: [FontCategory | "all", string][] = [
	["all", "All"],
	["sans", "Sans"],
	["serif", "Serif"],
	["display", "Display"],
	["handwriting", "Handwriting"],
	["mono", "Mono"],
];

export type FontSort = "popular" | "name";

/** A score at or above which the query appears whole in the name. */
export const CLOSE_MATCH = 600;

/**
 * How well `query` matches `name`, higher is better, or -1 for no match. The
 * letters must appear in order; a whole-name, prefix or word-start match ranks
 * above a scattered one, and fewer gaps rank above more. Matches of one kind
 * tie, so the sort (popularity, usually) orders them.
 */
export function fuzzyScore(name: string, query: string): number {
	const q = query.trim().toLowerCase().replace(/\s+/g, " ");
	if (!q) return 0;
	const n = name.toLowerCase();
	if (n === q) return 1000;
	if (n.startsWith(q)) return 900;
	const at = n.indexOf(q);
	if (at >= 0) return n[at - 1] === " " ? 800 : 700;
	const compact = q.replace(/ /g, "");
	let score = 500;
	let from = 0;
	let last = -1;
	for (const ch of compact) {
		const i = n.indexOf(ch, from);
		if (i < 0) return -1;
		if (last >= 0 && i !== last + 1) score -= 10;
		if (i === 0 || n[i - 1] === " ") score += 5;
		last = i;
		from = i + 1;
	}
	return Math.max(0, Math.min(CLOSE_MATCH - 1, score - n.length / 100));
}

const byName = new Intl.Collator(undefined).compare;

/**
 * The families to list for a query, category and sort. A query ranks by how
 * well each name matches, with the sort breaking ties.
 */
export function filterFamilies<
	T extends { f: string; c?: FontCategory; p?: number },
>(
	rows: readonly T[],
	{
		query = "",
		category = "all",
		sort = "popular",
	}: { query?: string; category?: FontCategory | "all"; sort?: FontSort },
): T[] {
	const bySort = (a: T, b: T) =>
		sort === "name"
			? byName(a.f, b.f)
			: (a.p ?? Number.POSITIVE_INFINITY) - (b.p ?? Number.POSITIVE_INFINITY) ||
				byName(a.f, b.f);
	const inCategory = rows.filter((r) => category === "all" || r.c === category);
	if (!query.trim()) return inCategory.sort(bySort);
	return inCategory
		.map((r) => ({ r, score: fuzzyScore(r.f, query) }))
		.filter((x) => x.score >= 0)
		.sort((a, b) => b.score - a.score || bySort(a.r, b.r))
		.map((x) => x.r);
}

/** The weight a family has that is closest to `wanted`, the heavier on a tie. */
export function nearestWeight(available: readonly number[], wanted: number) {
	let best = available[0] ?? 400;
	for (const w of available) {
		const d = Math.abs(w - wanted);
		const bestD = Math.abs(best - wanted);
		if (d < bestD || (d === bestD && w > best)) best = w;
	}
	return best;
}

const CSS2 = "https://fonts.googleapis.com/css2";

/** The css2 family parameter, spaces as `+`. */
export function familyParam(family: string): string {
	return family.trim().split(/\s+/).map(encodeURIComponent).join("+");
}

/**
 * A `google` descriptor for a catalogue family with the weights a template
 * uses, each moved to the nearest one the family has, and its italics when
 * they are used and it has them.
 */
export function googleDescriptor(
	row: GoogleFontRow,
	weights: Iterable<number>,
	italic = false,
): Extract<FontDescriptor, { kind: "google" }> {
	const ws = [...new Set([...weights].map((w) => nearestWeight(row.w, w)))];
	if (ws.length === 0) ws.push(nearestWeight(row.w, 400));
	ws.sort((a, b) => a - b);
	const axes =
		italic && row.i
			? `ital,wght@${[...ws.map((w) => `0,${w}`), ...ws.map((w) => `1,${w}`)].join(";")}`
			: `wght@${ws.join(";")}`;
	return {
		kind: "google",
		family: row.f,
		url: `${CSS2}?family=${familyParam(row.f)}:${axes}&display=swap`,
	};
}

/** The stylesheet for a preview of a family: just the glyphs of its name. */
export function previewCssUrl(family: string): string {
	return `${CSS2}?family=${familyParam(family)}&text=${encodeURIComponent(family)}`;
}
