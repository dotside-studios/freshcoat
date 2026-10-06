export type SlugOptions = { sep?: "-" | "_"; fallback?: string };

/** Lowercase `s` and join its alphanumeric runs with `sep`; `fallback` when
 *  nothing is left. */
export function slug(
	s: string,
	{ sep = "-", fallback = "" }: SlugOptions = {},
): string {
	const out = s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, sep)
		.replace(new RegExp(`^${sep}+|${sep}+$`, "g"), "");
	return out || fallback;
}
