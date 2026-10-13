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

/** How each kind of edge is stroked: a theme colour as stroke and fill
 *  classes, and dash lengths in screen pixels, since the outlines are
 *  non-scaling. */
export const SLICE_EDGE: Record<
	Edge,
	{ stroke: string; text: string; dash: string }
> = {
	none: {
		stroke: "stroke-fc-slice-cut",
		text: "fill-fc-slice-cut",
		dash: "5 3",
	},
	through: {
		stroke: "stroke-fc-slice-cut",
		text: "fill-fc-slice-cut",
		dash: "5 3",
	},
	kiss: {
		stroke: "stroke-fc-slice-kiss",
		text: "fill-fc-slice-kiss",
		dash: "5 3",
	},
	score: {
		stroke: "stroke-fc-slice-score",
		text: "fill-fc-slice-score",
		dash: "14 4",
	},
	perforate: {
		stroke: "stroke-fc-slice-cut",
		text: "fill-fc-slice-cut",
		dash: "1.5 3",
	},
};
