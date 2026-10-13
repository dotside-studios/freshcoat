import { useMemo } from "react";
import { createExternalStore } from "~/state/external-store";
import { STATUS_ITEMS } from "./items";

/** Which status items the person turned off or on, saved per browser like
 *  the theme. Only the choices that differ from an item's default are kept. */
export const STATUS_ITEMS_KEY = "freshcoat.statusItems";

/** Saved before items could be hidden: "1" meant the render timings were on. */
const LEGACY_RENDER_STATS_KEY = "freshcoat.renderStats";

/** Item id to whether the person hid it. */
type Overrides = Readonly<Record<string, boolean>>;

function save(overrides: Overrides): void {
	try {
		if (Object.keys(overrides).length === 0)
			localStorage.removeItem(STATUS_ITEMS_KEY);
		else localStorage.setItem(STATUS_ITEMS_KEY, JSON.stringify(overrides));
	} catch {
		// Private windows can refuse storage; the choice still holds for the tab.
	}
}

function load(): Overrides {
	const overrides: Record<string, boolean> = {};
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(STATUS_ITEMS_KEY) ?? "{}",
		);
		if (parsed && typeof parsed === "object")
			for (const [id, hidden] of Object.entries(parsed))
				if (typeof hidden === "boolean") overrides[id] = hidden;
	} catch {
		// Unreadable storage or JSON: start from the defaults.
	}
	try {
		const legacy = localStorage.getItem(LEGACY_RENDER_STATS_KEY);
		if (legacy !== null) {
			if (legacy === "1") overrides.render = false;
			localStorage.removeItem(LEGACY_RENDER_STATS_KEY);
			save(overrides);
		}
	} catch {
		// As above.
	}
	return overrides;
}

const overrides = createExternalStore<Overrides>(load);

const hiddenByDefault = (id: string): boolean =>
	STATUS_ITEMS.find((i) => i.id === id)?.hiddenByDefault ?? false;

export function isStatusItemHidden(id: string): boolean {
	return overrides.get()[id] ?? hiddenByDefault(id);
}

export function toggleStatusItem(id: string): void {
	const hidden = !isStatusItemHidden(id);
	const { [id]: _, ...rest } = overrides.get();
	const next =
		hidden === hiddenByDefault(id) ? rest : { ...rest, [id]: hidden };
	save(next);
	overrides.set(next);
}

/** The ids of the items that are hidden now. */
export function useHiddenStatusItems(): ReadonlySet<string> {
	const current = overrides.useStore();
	return useMemo(
		() =>
			new Set(
				STATUS_ITEMS.filter((i) => current[i.id] ?? i.hiddenByDefault).map(
					(i) => i.id,
				),
			),
		[current],
	);
}
