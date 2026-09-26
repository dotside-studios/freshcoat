import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type Theme = "light" | "dark";

/**
 * The preference is saved; `?theme=` overrides it for this tab only. The
 * inline script in index.html applies the same rules before first paint, so
 * keep the two in step.
 */
export const THEME_STORAGE_KEY = "freshcoat.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

export function parseThemePreference(
	value: string | null | undefined,
): ThemePreference | null {
	return value === "light" || value === "dark" || value === "system"
		? value
		: null;
}

function readStored(): ThemePreference {
	try {
		return (
			parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)) ?? "light"
		);
	} catch {
		return "light";
	}
}

function readOverride(): Theme | null {
	const value = new URLSearchParams(location.search).get("theme");
	return value === "light" || value === "dark" ? value : null;
}

let preference: ThemePreference = "light";
let override: Theme | null = null;

export function resolveTheme(
	pref: ThemePreference,
	prefersDark: boolean,
): Theme {
	return pref === "system" ? (prefersDark ? "dark" : "light") : pref;
}

function apply() {
	const theme =
		override ?? resolveTheme(preference, matchMedia(DARK_QUERY).matches);
	document.documentElement.dataset.theme = theme;
	document
		.querySelector('meta[name="color-scheme"]')
		?.setAttribute("content", theme);
}

/** Reads the preference and the URL, applies them and follows the system. */
export function initTheme() {
	preference = readStored();
	override = readOverride();
	apply();
	matchMedia(DARK_QUERY).addEventListener("change", () => {
		if (!override && preference === "system") apply();
	});
}

export function getThemePreference(): ThemePreference {
	return preference;
}

/** Saves the preference. Choosing one also drops this tab's `?theme=`. */
export function setThemePreference(next: ThemePreference) {
	preference = next;
	override = null;
	try {
		localStorage.setItem(THEME_STORAGE_KEY, next);
	} catch {
		// Private windows can refuse storage; the choice still holds for the tab.
	}
	apply();
	for (const l of listeners) l();
}

export function useThemePreference(): ThemePreference {
	return useSyncExternalStore((l) => {
		listeners.add(l);
		return () => listeners.delete(l);
	}, getThemePreference);
}
