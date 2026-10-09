import { FIELD_ID, fieldKeyFrom } from "@freshcoat-js/coatfile/mustache";

/** `<prefix>_` and 16 hex digits, e.g. `r_1a2b3c4d5e6f7a8b`. */
export function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** A `newId(prefix)` not in `taken`. */
export function freshId(prefix: string, taken: ReadonlySet<string>): string {
	let id = newId(prefix);
	while (taken.has(id)) id = newId(prefix);
	return id;
}

export function isValidKey(key: string): boolean {
	return FIELD_ID.test(key);
}

/** A valid column key made from any header or property name:
 *  `First Name` gives `first_name`, `2nd` gives `_2nd`. */
export function slug(text: string): string {
	return fieldKeyFrom(text, "column");
}

/** `base`, or `base_2`, `base_3`… whichever is not taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
	return firstFree(base, taken, "_", false);
}

/** `name`, or `name 2`, `name 3`… whichever is not taken. */
export function uniqueName(
	name: string,
	taken: Iterable<string>,
	options: { caseInsensitive?: boolean } = {},
): string {
	return firstFree(name, taken, " ", options.caseInsensitive ?? false);
}

function firstFree(
	base: string,
	taken: Iterable<string>,
	separator: string,
	caseInsensitive: boolean,
): string {
	const fold = (s: string) => (caseInsensitive ? s.toLowerCase() : s);
	const used = new Set(Array.from(taken, fold));
	if (!used.has(fold(base))) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}${separator}${n}`;
		if (!used.has(fold(candidate))) return candidate;
	}
}
