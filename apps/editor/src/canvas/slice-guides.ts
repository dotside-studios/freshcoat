import type { ResolvedSlice } from "@freshcoat-js/coatfile";
import { useSyncExternalStore } from "react";

// One choice for the session, like the bleed.
let shown = true;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

export function slicesShown(): boolean {
	return shown;
}

export function setSlicesShown(on: boolean): void {
	if (on === shown) return;
	shown = on;
	for (const fn of listeners) fn();
}

/** View > Slices. */
export function toggleSlices(): void {
	setSlicesShown(!shown);
}

export function useSlicesShown(): boolean {
	return useSyncExternalStore(subscribe, slicesShown, slicesShown);
}

type Edge = ResolvedSlice["edge"];

/** How each kind of edge is stroked. Dash lengths are in screen pixels, since
 *  the outlines are non-scaling. */
export const SLICE_EDGE: Record<Edge, { stroke: string; dash: string }> = {
	none: { stroke: "#e5383b", dash: "5 3" },
	through: { stroke: "#e5383b", dash: "5 3" },
	kiss: { stroke: "#d11fb4", dash: "5 3" },
	score: { stroke: "#2f6fed", dash: "14 4" },
	perforate: { stroke: "#e5383b", dash: "1.5 3" },
};
