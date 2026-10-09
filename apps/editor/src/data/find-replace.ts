/*
 * Mod+F and Mod+H open Data's find and replace popover. The commands live in
 * the registry, the popover in the records pane, so the pane registers how
 * to open it while it is shown.
 */

export type FindField = "find" | "replace";

let opener: ((field: FindField) => void) | null = null;

/** Lets the shortcuts open the popover; the returned function withdraws it. */
export function registerFindReplace(
	open: (field: FindField) => void,
): () => void {
	opener = open;
	return () => {
		if (opener === open) opener = null;
	};
}

/** Opens the popover with `field` focused, when Data shows records. */
export function openFindReplace(field: FindField): boolean {
	if (!opener) return false;
	opener(field);
	return true;
}
