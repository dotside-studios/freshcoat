import { ContextMenu, MenuItem } from "@freshcoat-js/ui/menu";
import { useEditor } from "~/state/hooks";
import { STATUS_ITEMS } from "./status/items";
import { orderItems, Slot } from "./status/Slot";
import { toggleStatusItem, useHiddenStatusItems } from "./status/visibility";

export function StatusBar() {
	const section = useEditor((s) => s.section);
	const hidden = useHiddenStatusItems();
	const available = STATUS_ITEMS.filter(
		(i) => i.sections === "all" || i.sections.includes(section),
	);
	const items = available.filter((i) => i.pinned || !hidden.has(i.id));
	const listed = (["start", "end"] as const).flatMap((align) =>
		orderItems(available, align).filter((i) => !i.pinned),
	);
	return (
		<ContextMenu
			className="contents"
			menuProps={{
				"aria-label": "Status bar items",
				selectionMode: "multiple",
				selectedKeys: listed.filter((i) => !hidden.has(i.id)).map((i) => i.id),
				onAction: (id) => toggleStatusItem(String(id)),
			}}
			menu={listed.map((i) => (
				<MenuItem key={i.id} id={i.id}>
					{i.name}
				</MenuItem>
			))}
		>
			<footer
				data-testid={section === "data" ? "data-status" : undefined}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: focus gives the keyboard the bar's context menu (Shift+F10) even when no item in it is focusable
				tabIndex={0}
				className="@container flex h-6 shrink-0 has-[>:only-child]:hidden items-center gap-4 overflow-hidden whitespace-nowrap border-fc-border border-t bg-fc-app px-3 text-fc-muted text-fc-sm tabular-nums outline-none focus-visible:-outline-offset-1 focus-visible:outline-1 focus-visible:outline-fc-accent focus-visible:outline-solid pointer-coarse:h-8"
			>
				<Slot items={items} align="start" />
				<span className="flex-1" />
				<Slot items={items} align="end" />
			</footer>
		</ContextMenu>
	);
}
