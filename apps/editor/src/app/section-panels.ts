import { useEffect, useSyncExternalStore } from "react";

export type PanelSide = "left" | "right";

/** The side panels of the section on screen, when it keeps its own rather
 *  than the editor's. */
export type SectionPanels = {
	left: boolean;
	right: boolean;
	set: (panels: Partial<Record<PanelSide, boolean>>) => void;
};

let current: SectionPanels | null = null;
const listeners = new Set<() => void>();

function publish(next: SectionPanels | null) {
	current = next;
	for (const l of listeners) l();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function sectionPanels(): SectionPanels | null {
	return current;
}

export function useSectionPanels(): SectionPanels | null {
	return useSyncExternalStore(subscribe, sectionPanels, sectionPanels);
}

/** Hands the menu bar's panel toggles to a section while it shows. */
export function useProvideSectionPanels(panels: SectionPanels | null) {
	const { left, right, set } = panels ?? {};
	useEffect(() => {
		if (left === undefined || right === undefined || !set) return;
		const mine = { left, right, set };
		publish(mine);
		return () => {
			if (current === mine) publish(null);
		};
	}, [left, right, set]);
}
