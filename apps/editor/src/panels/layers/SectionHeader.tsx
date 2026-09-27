import { ChevronRightIcon } from "@freshcoat-js/ui/icons";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { type ReactNode, useCallback, useState } from "react";

/** The left panel's sections, in the order they stack. */
export type LeftSection = "templates" | "sides" | "variants" | "layers";

export const COLLAPSED_KEY = "freshcoat.leftPanel.collapsed";

const SECTIONS: readonly LeftSection[] = [
	"templates",
	"sides",
	"variants",
	"layers",
];

function readCollapsed(): Set<LeftSection> {
	try {
		const raw: unknown = JSON.parse(
			localStorage.getItem(COLLAPSED_KEY) ?? "[]",
		);
		if (!Array.isArray(raw)) return new Set();
		return new Set(SECTIONS.filter((s) => raw.includes(s)));
	} catch {
		return new Set();
	}
}

/**
 * Which left panel sections are collapsed, remembered in localStorage.
 * Every section starts expanded when nothing is stored or storage is off.
 */
export function useCollapsedSections() {
	const [collapsed, setCollapsed] = useState(readCollapsed);
	const toggle = useCallback((id: LeftSection) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			try {
				localStorage.setItem(
					COLLAPSED_KEY,
					JSON.stringify(SECTIONS.filter((s) => next.has(s))),
				);
			} catch {
				// Storage is off: the section still toggles for this session.
			}
			return next;
		});
	}, []);
	return { collapsed, toggle };
}

/**
 * A left panel section's header: a button that shows or hides the section
 * body, and an actions slot that stays usable while it is collapsed.
 */
export function SectionHeader({
	title,
	expanded,
	controls,
	onToggle,
	actions,
}: {
	title: string;
	expanded: boolean;
	/** The id of the body this header shows and hides. */
	controls: string;
	onToggle: () => void;
	actions?: ReactNode;
}) {
	return (
		<div className="flex h-7 shrink-0 items-center pr-1 pointer-coarse:h-9">
			<h2 className="m-0 flex h-full min-w-0 flex-1">
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={controls}
					onClick={onToggle}
					className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1 pl-1.5 text-left font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em] outline-none hover:text-fc-text focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-fc-accent focus-visible:-outline-offset-2"
				>
					<ChevronRightIcon
						className={cn(
							"size-3 shrink-0 transition-transform duration-100",
							expanded && "rotate-90",
						)}
					/>
					<span className="truncate">{title}</span>
				</button>
			</h2>
			{actions}
		</div>
	);
}
