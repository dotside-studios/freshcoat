import { useSyncExternalStore } from "react";

/** Whether the status bar shows render timings. Off by default, and saved
 *  per browser like the theme, since it is a preference about the editor
 *  rather than about a workspace. */
export const RENDER_STATS_KEY = "freshcoat.renderStats";

const listeners = new Set<() => void>();
let on: boolean | null = null;

export function renderStatsOn(): boolean {
	if (on === null) {
		try {
			on = localStorage.getItem(RENDER_STATS_KEY) === "1";
		} catch {
			on = false;
		}
	}
	return on;
}

export function setRenderStats(next: boolean): void {
	on = next;
	try {
		if (next) localStorage.setItem(RENDER_STATS_KEY, "1");
		else localStorage.removeItem(RENDER_STATS_KEY);
	} catch {
		// Private windows can refuse storage; the choice still holds for the tab.
	}
	for (const l of listeners) l();
}

export function toggleRenderStats(): void {
	setRenderStats(!renderStatsOn());
}

export function useRenderStats(): boolean {
	return useSyncExternalStore((l) => {
		listeners.add(l);
		return () => listeners.delete(l);
	}, renderStatsOn);
}
