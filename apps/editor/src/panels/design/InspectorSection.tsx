import { PanelSection, type PanelSectionProps } from "@freshcoat-js/ui/panel";
import { createContext, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "freshcoat.inspector.collapsed";

type Collapsed = {
	has(section: string): boolean;
	set(section: string, collapsed: boolean): void;
};

const CollapsedContext = createContext<Collapsed | null>(null);

function readCollapsed(): Set<string> {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
		return new Set(
			Array.isArray(raw) ? raw.filter((s) => typeof s === "string") : [],
		);
	} catch {
		return new Set();
	}
}

/** The inspector sections a person has collapsed, by section id, kept across
 *  selections and sessions. */
export function useInspectorCollapsed(): Collapsed {
	const [collapsed, setCollapsed] = useState(readCollapsed);
	return useMemo(
		() => ({
			has: (section) => collapsed.has(section),
			set: (section, on) => {
				const next = new Set(collapsed);
				if (on) next.add(section);
				else next.delete(section);
				setCollapsed(next);
				try {
					localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
				} catch {
					// Storage is off: the choice lasts for this session.
				}
			},
		}),
		[collapsed],
	);
}

export const InspectorCollapsedProvider = CollapsedContext.Provider;

/** A PanelSection whose collapsed state is remembered by `section`, which
 *  defaults to its title. */
export function InspectorSection({
	section,
	...props
}: PanelSectionProps & { section?: string }) {
	const collapsed = useContext(CollapsedContext);
	const id =
		section ?? (typeof props.title === "string" ? props.title : undefined);
	if (!collapsed || id === undefined) return <PanelSection {...props} />;
	return (
		<PanelSection
			{...props}
			data-section={id}
			isExpanded={!collapsed.has(id)}
			onExpandedChange={(expanded) => collapsed.set(id, !expanded)}
		/>
	);
}
