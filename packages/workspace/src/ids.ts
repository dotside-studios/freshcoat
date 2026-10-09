const KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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
	return KEY_PATTERN.test(key);
}

/** A valid column key made from any header or property name:
 *  `First Name` gives `first_name`, `2nd` gives `_2nd`. */
export function slug(text: string): string {
	const ascii = text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (ascii === "") return "column";
	return /^[0-9]/.test(ascii) ? `_${ascii}` : ascii;
}

/** `base`, or `base_2`, `base_3`… whichever is not taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}_${n}`;
		if (!used.has(candidate)) return candidate;
	}
}
