import {
	type Element,
	nextFreeId as freeId,
	type Template,
	uniquifyElementIdsDeep,
} from "@freshcoat-js/coatfile";
import { walkLayers } from "./path";

/** Every id on a side at any depth, the background's included. */
export function collectIds(t: Template, side: number): Set<string> {
	const out = new Set<string>();
	for (const entry of walkLayers(t, side)) out.add(entry.element.id);
	return out;
}

/**
 * `base` when no layer on the side uses it, else `base-2`, `base-3`, and so on.
 * A base that already ends in `-<n>` counts on from its stem, so a copy of
 * `title-2` is `title-3` rather than `title-2-2`. `taken` adds ids reserved by
 * the caller (layers about to be inserted alongside).
 */
export function uniqueId(
	t: Template,
	side: number,
	base: string,
	taken?: ReadonlySet<string>,
): string {
	return nextFreeId(collectIds(t, side), base, taken);
}

const STUDIO_IDS = { separator: "-", fromStem: true } as const;

export function nextFreeId(
	used: ReadonlySet<string>,
	base: string,
	taken?: ReadonlySet<string>,
): string {
	return freeId(
		base.trim() || "layer",
		(id) => used.has(id) || taken?.has(id) === true,
		STUDIO_IDS,
	);
}

/** Gives `el` and everything nested in it ids unused in `used`, adding each
 *  one it picks to `used`. Unchanged subtrees are returned as they are. */
export function uniquifyTree(el: Element, used: Set<string>): Element {
	return uniquifyElementIdsDeep([el], { ...STUDIO_IDS, used })[0] as Element;
}
