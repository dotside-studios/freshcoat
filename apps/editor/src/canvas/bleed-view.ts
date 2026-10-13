import { createExternalStore } from "~/state/external-store";

// One choice for the session, shared by the canvas and the sheet preview.
const shown = createExternalStore(true);

/** Whether the canvas and the sheet preview paint the bleed. */
export function bleedShown(): boolean {
	return shown.get();
}

export function setBleedShown(on: boolean): void {
	shown.set(on);
}

/** View > Bleed. */
export function toggleBleed(): void {
	setBleedShown(!shown.get());
}

export function useBleedShown(): boolean {
	return shown.useStore();
}
