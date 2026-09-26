/*
 * Mod+E opens Data's "Export selected" popover. The command lives in the
 * registry, the popover in the records pane, so the pane registers how to
 * open it while it has records selected.
 */

let opener: (() => void) | null = null;

/** Lets Mod+E open the popover; the returned function withdraws it. */
export function registerExportSelected(open: () => void): () => void {
	opener = open;
	return () => {
		if (opener === open) opener = null;
	};
}

/** Opens the popover, when records are selected. */
export function openExportSelected(): boolean {
	if (!opener) return false;
	opener();
	return true;
}
