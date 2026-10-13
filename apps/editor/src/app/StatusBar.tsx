import { useEditor } from "~/state/hooks";
import { STATUS_ITEMS } from "./status/items";
import { Slot } from "./status/Slot";

export function StatusBar() {
	const section = useEditor((s) => s.section);
	const items = STATUS_ITEMS.filter(
		(i) => i.sections === "all" || i.sections.includes(section),
	);
	return (
		<footer
			data-testid={section === "data" ? "data-status" : undefined}
			className="@container flex h-6 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-fc-border border-t bg-fc-app px-3 text-fc-muted text-fc-sm tabular-nums pointer-coarse:h-8"
		>
			<Slot items={items} align="start" />
			<span className="flex-1" />
			<Slot items={items} align="end" />
		</footer>
	);
}
