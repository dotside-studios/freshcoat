// The one place the editor configures Immer; every recipe imports it from here.
//
// Two rules keep recipes cheap, both measured in src/tests/perf/state.bench.ts:
// - Auto-freeze is off. Freezing every 10k-record dataset and renderer
//   geometry Map on each change costs more than it protects.
// - With auto-freeze off, Immer walks every unfrozen object a finished recipe
//   left in place, looking for drafts inside it, until each draft the recipe
//   touched is finalized. So a recipe drafts only small objects: it reads from
//   the base, writes whole values into its own draft, and uses `produceAt` for
//   one element of a list. Drafting `w.presets` from a workspace draft walks
//   every record of every dataset and every parked history before it: 8 ms a
//   change with 10k records, against 10 µs for the same write one level up.
//
// Maps and Sets (`geometry`, `hidden`, `locked`) are never drafted: without
// `enableMapSet`, reading one off a draft throws. They are assigned as new
// instances.

import { produce as immerProduce, setAutoFreeze } from "immer";

setAutoFreeze(false);

/** A writable view of `T` in which Maps, Sets and functions stay as they are,
 *  since recipes replace them and never draft them. */
export type Draft<T> = T extends
	| ReadonlyMap<unknown, unknown>
	| ReadonlySet<unknown>
	| ((...args: never[]) => unknown)
	? T
	: T extends object
		? { -readonly [K in keyof T]: Draft<T[K]> }
		: T;

/** Immer's `produce`, for recipes that edit the draft and return nothing. */
export function produce<T>(base: T, recipe: (draft: Draft<T>) => void): T {
	return immerProduce(base, recipe as never) as T;
}

/** `produce` on the element at `index` alone; the list is copied only when
 *  the element changes. The recipe gets the element's base to read from. */
export function produceAt<T>(
	list: T[],
	index: number,
	recipe: (draft: Draft<T>, base: T) => void,
): T[] {
	if (index < 0 || index >= list.length) return list;
	const item = list[index] as T;
	const next = produce(item, (d) => recipe(d, item));
	if (next === item) return list;
	return produce(list, (d) => {
		d[index] = next as Draft<T>;
	});
}
