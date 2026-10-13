import { useSyncExternalStore } from "react";

// One choice for the session, shared by the canvas and the sheet preview.
let shown = true;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

/** Whether the canvas and the sheet preview paint the bleed. */
export function bleedShown(): boolean {
	return shown;
}

export function setBleedShown(on: boolean): void {
	if (on === shown) return;
	shown = on;
	for (const fn of listeners) fn();
}

/** View > Bleed. */
export function toggleBleed(): void {
	setBleedShown(!shown);
}

export function useBleedShown(): boolean {
	return useSyncExternalStore(subscribe, bleedShown, bleedShown);
}
