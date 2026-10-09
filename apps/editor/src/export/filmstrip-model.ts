import { DEFAULT_VARIANT_ID, type Template } from "@freshcoat-js/coatfile";
import type { DataRecord, Dataset } from "@freshcoat-js/workspace";
import { VARIANT_EXPORT } from "~/app/copy";

/** Which records the filmstrip and the stepper walk through. */
export type FilmstripScope = "export" | "all" | "failed";

export type FilmstripEntry = {
	record: DataRecord;
	/** the record's position in its dataset, from 0 */
	index: number;
	/** whether the preset exports it */
	planned: boolean;
	/** the variant the cell previews, when every variant is exported and a
	 *  record has a cell per variant */
	variant?: PreviewVariant;
};

/** A variant as the export preview names it. `token` is its id, or
 *  `default` for Default, as plan keys and file names say it. */
export type PreviewVariant = {
	token: string;
	id?: string;
	label: string;
	swatch?: string;
};

/** How plan keys and file names name a variant: its id, or `default`. */
export function variantToken(variantId: string | undefined): string {
	return variantId ?? DEFAULT_VARIANT_ID;
}

/** The variant an id names, with its label and swatch from the template:
 *  Default when the id is undefined, which has no swatch, as in the Variants
 *  list. An id the template lacks keeps the id as its label. */
export function previewVariant(
	template: Template | undefined,
	variantId: string | undefined,
): PreviewVariant {
	if (variantId === undefined)
		return { token: variantToken(undefined), label: VARIANT_EXPORT.default };
	const found = template?.variants?.find((v) => v.id === variantId);
	return {
		token: variantId,
		id: variantId,
		label: found?.label ?? variantId,
		...(found?.swatch ? { swatch: found.swatch } : {}),
	};
}

/** A cell's key: the record's id, and its variant when it has one. */
export function entryKey(entry: Pick<FilmstripEntry, "record" | "variant">) {
	return entry.variant
		? `${entry.record.id}:${entry.variant.token}`
		: entry.record.id;
}

/** Every entry once per variant `variantsOf` lists for its record, in that
 *  order: the cells of a strip that exports every variant. */
export function withVariantEntries(
	entries: readonly FilmstripEntry[],
	template: Template | undefined,
	variantsOf: (record: DataRecord) => readonly (string | undefined)[],
): FilmstripEntry[] {
	return entries.flatMap((entry) =>
		variantsOf(entry.record).map((id) => ({
			...entry,
			variant: previewVariant(template, id),
		})),
	);
}

/**
 * The records a scope shows, in dataset order: the ones the preset exports,
 * every record, or the failed ones (by status, or by the last job's result).
 */
export function filmstripEntries(
	dataset: Pick<Dataset, "records"> | undefined,
	planned: ReadonlySet<string>,
	scope: FilmstripScope,
	failed: ReadonlySet<string> = new Set(),
): FilmstripEntry[] {
	if (!dataset) return [];
	const out: FilmstripEntry[] = [];
	dataset.records.forEach((record, index) => {
		const inPlan = planned.has(record.id);
		const keep =
			scope === "all"
				? true
				: scope === "failed"
					? record.status === "failed" || failed.has(record.id)
					: inPlan;
		if (keep) out.push({ record, index, planned: inPlan });
	});
	return out;
}

/** The keys that move through a filmstrip. */
export const FILMSTRIP_KEYS = [
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
	"Home",
	"End",
	"PageUp",
	"PageDown",
] as const;

/**
 * Where a key moves the current position in a list of `count`, or null when
 * the key is not one of the filmstrip's. `page` is how many cells fit. With
 * nothing current, any step lands on the first cell (End on the last).
 */
export function stepIndex(
	current: number,
	key: string,
	count: number,
	page = 1,
): number | null {
	if (count <= 0) return null;
	const last = count - 1;
	const clamp = (n: number) => Math.max(0, Math.min(last, n));
	const by = Math.max(1, page);
	if (current < 0) {
		if (key === "End") return last;
		return (FILMSTRIP_KEYS as readonly string[]).includes(key) ? 0 : null;
	}
	switch (key) {
		case "ArrowLeft":
		case "ArrowUp":
			return clamp(current - 1);
		case "ArrowRight":
		case "ArrowDown":
			return clamp(current + 1);
		case "Home":
			return 0;
		case "End":
			return last;
		case "PageUp":
			return clamp(current - by);
		case "PageDown":
			return clamp(current + by);
		default:
			return null;
	}
}

/** How many whole cells a viewport shows, at least one. */
export function cellsPerPage(viewport: number, cell: number): number {
	return cell > 0 ? Math.max(1, Math.floor(viewport / cell)) : 1;
}

/** How a click on a cell changes the selection. */
export type SelectGesture = {
	/** Shift: the range from the anchor */
	range: boolean;
	/** Mod: toggle one record, or add a range to what is selected */
	toggle: boolean;
};

/**
 * The selection after a click on `id`, or null when the click only previews
 * (no modifier). Shift selects the records from `anchor` to `id` in `order`,
 * replacing the selection, or adding to it with Mod held too; an anchor that
 * is not in `order` makes the range just `id`. Mod alone toggles `id`.
 */
export function selectionAfterClick(
	selection: readonly string[],
	order: readonly string[],
	anchor: string | null,
	id: string,
	gesture: SelectGesture,
): string[] | null {
	if (gesture.range) {
		const to = order.indexOf(id);
		if (to < 0) return null;
		const at = anchor === null ? -1 : order.indexOf(anchor);
		const from = at < 0 ? to : at;
		const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
		return gesture.toggle ? [...new Set([...selection, ...range])] : range;
	}
	if (gesture.toggle)
		return selection.includes(id)
			? selection.filter((s) => s !== id)
			: [...selection, id];
	return null;
}
