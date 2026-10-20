import type { Autosave, AutosaveStore } from "~/app/autosave";

export async function readSaved(
	store: AutosaveStore,
): Promise<Autosave | null> {
	const read = await store.read();
	return read.status === "found" ? read.autosave : null;
}
