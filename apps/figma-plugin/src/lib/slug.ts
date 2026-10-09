/** Lowercase `s` and join its alphanumeric runs with `-`; `fallback` when
 *  nothing is left. */
export function slug(
	s: string,
	{ fallback = "" }: { fallback?: string } = {},
): string {
	const out = s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return out || fallback;
}
