import { createExternalStore } from "~/state/external-store";

/** Whether the status bar shows render timings. Off by default, and saved
 *  per browser like the theme, since it is a preference about the editor
 *  rather than about a workspace. */
export const RENDER_STATS_KEY = "freshcoat.renderStats";

const on = createExternalStore(() => {
	try {
		return localStorage.getItem(RENDER_STATS_KEY) === "1";
	} catch {
		return false;
	}
});

export function renderStatsOn(): boolean {
	return on.get();
}

export function setRenderStats(next: boolean): void {
	try {
		if (next) localStorage.setItem(RENDER_STATS_KEY, "1");
		else localStorage.removeItem(RENDER_STATS_KEY);
	} catch {
		// Private windows can refuse storage; the choice still holds for the tab.
	}
	on.set(next);
}

export function toggleRenderStats(): void {
	setRenderStats(!renderStatsOn());
}

export function useRenderStats(): boolean {
	return on.useStore();
}
