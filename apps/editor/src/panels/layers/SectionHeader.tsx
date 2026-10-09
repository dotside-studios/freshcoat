import { ChevronRightIcon } from "@freshcoat-js/ui/icons";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { type ReactNode, useState } from "react";

/** The left panel's sections, in the order they stack. */
export type LeftSection = "templates" | "sides" | "variants" | "layers";

export const COLLAPSED_KEY = "freshcoat.leftPanel.collapsed";

const SECTIONS: readonly LeftSection[] = [
	"templates",
	"sides",
	"variants",
	"layers",
];

/** What the person chose for each section they have toggled: true when
 *  collapsed. Older storage kept a list of the collapsed sections. */
type Choices = Partial<Record<LeftSection, boolean>>;

function readChoices(): Choices {
	try {
		const raw: unknown = JSON.parse(
			localStorage.getItem(COLLAPSED_KEY) ?? "{}",
		);
		const out: Choices = {};
		if (Array.isArray(raw)) {
			for (const s of SECTIONS) if (raw.includes(s)) out[s] = true;
		} else if (raw && typeof raw === "object") {
			for (const s of SECTIONS) {
				const v = (raw as Record<string, unknown>)[s];
				if (typeof v === "boolean") out[s] = v;
			}
		}
		return out;
	} catch {
		return {};
	}
}

/**
 * Which left panel sections are collapsed. A section the person has not
 * toggled is collapsed when `single` says it holds one entry; once toggled,
 * their choice is remembered in localStorage.
 */
export function useCollapsedSections(single: (id: LeftSection) => boolean) {
	const [choices, setChoices] = useState(readChoices);
	const isCollapsed = (id: LeftSection) => choices[id] ?? single(id);
	const toggle = (id: LeftSection) => {
		const next = { ...choices, [id]: !isCollapsed(id) };
		setChoices(next);
		try {
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
		} catch {
			// Storage is off: the section still toggles for this session.
		}
	};
	return { isCollapsed, toggle };
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
