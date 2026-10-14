import { useMemo, useState } from "react";

const STORAGE_KEY = "freshcoat.export.collapsed";

export type SettingsSectionId =
	| "records"
	| "binding"
	| "format"
	| "size"
	| "print"
	| "files"
	| "checks";

/** The settings sections a person has opened or collapsed, by id. */
export type ExportCollapsed = {
	has(section: SettingsSectionId, fallback?: boolean): boolean;
	set(section: SettingsSectionId, collapsed: boolean): void;
};

function read(): Record<string, boolean> {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			return {};
		return Object.fromEntries(
			Object.entries(raw).filter(([, v]) => typeof v === "boolean"),
		);
	} catch {
		return {};
	}
}

/** Collapsed settings sections, kept across presets and sessions. A section
 *  nobody touched is open, or `fallback` where one is given. */
export function useExportCollapsed(): ExportCollapsed {
	const [choices, setChoices] = useState(read);
	return useMemo(
		() => ({
			has: (section, fallback = false) => choices[section] ?? fallback,
			set: (section, collapsed) => {
				const next = { ...choices, [section]: collapsed };
				setChoices(next);
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
				} catch {
					// Storage is off: the choice lasts for this session.
				}
			},
		}),
		[choices],
	);
}
