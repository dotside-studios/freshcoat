import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";

export type TabId = "layer" | "fields" | "export" | "settings";

const TABS: Array<{ id: TabId; label: string }> = [
	{ id: "layer", label: "Layer" },
	{ id: "fields", label: "Fields" },
	{ id: "export", label: "Export" },
	{ id: "settings", label: "Settings" },
];

export function isTabId(value: string): value is TabId {
	return TABS.some((t) => t.id === value);
}

/** The tab row, as the ARIA tabs pattern: one tab stop, arrow keys move
 *  between tabs and select as they go, Home and End jump to the ends. */
export function Tablist(props: {
	value: TabId;
	onChange: (tab: TabId) => void;
}): JSX.Element {
	const listRef = useRef<HTMLDivElement>(null);

	const move = (index: number): void => {
		const next = TABS[(index + TABS.length) % TABS.length];
		props.onChange(next.id);
		listRef.current
			?.querySelector<HTMLButtonElement>(`#tab-${next.id}`)
			?.focus();
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void => {
		const current = TABS.findIndex((t) => t.id === props.value);
		if (e.key === "ArrowRight") move(current + 1);
		else if (e.key === "ArrowLeft") move(current - 1);
		else if (e.key === "Home") move(0);
		else if (e.key === "End") move(TABS.length - 1);
		else return;
		e.preventDefault();
	};

	return (
		<div
			ref={listRef}
			role="tablist"
			aria-label="Plugin sections"
			onKeyDown={onKeyDown}
			style={{
				display: "flex",
				alignItems: "center",
				gap: "2px",
				flexShrink: 0,
				height: "40px",
				padding: "0 8px",
				borderBottom: "1px solid var(--figma-color-border)",
			}}
		>
			{TABS.map((t) => {
				const selected = t.id === props.value;
				return (
					<button
						key={t.id}
						type="button"
						role="tab"
						id={`tab-${t.id}`}
						class="fc-tab"
						aria-selected={selected}
						aria-controls={`panel-${t.id}`}
						tabIndex={selected ? 0 : -1}
						onClick={() => props.onChange(t.id)}
					>
						{t.label}
					</button>
				);
			})}
		</div>
	);
}

/** A tab's content. Every panel stays mounted, so a tab that is not showing
 *  still hears the messages main sends it; `hidden` takes it out of view and
 *  out of the accessibility tree. The showing one fills the height left under
 *  the tabs, so a tab's footer can sit at the bottom of the window. */
export function TabPanel(props: {
	id: TabId;
	active: boolean;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<div
			role="tabpanel"
			id={`panel-${props.id}`}
			aria-labelledby={`tab-${props.id}`}
			hidden={!props.active}
			style={
				props.active
					? { display: "flex", flexDirection: "column", flex: "1 0 auto" }
					: undefined
			}
		>
			{props.children}
		</div>
	);
}
