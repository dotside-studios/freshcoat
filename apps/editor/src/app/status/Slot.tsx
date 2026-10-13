import { useEditor } from "~/state/hooks";
import type { StatusItem } from "./types";

/** An alignment's items by priority, the highest nearest its edge. */
export function orderItems(
	items: readonly StatusItem[],
	align: StatusItem["align"],
): StatusItem[] {
	return items
		.filter((i) => i.align === align)
		.sort((a, b) =>
			align === "start" ? b.priority - a.priority : a.priority - b.priority,
		);
}

/** Renders one alignment of the bar. Items are direct children of the bar, so
 *  its gap spaces them. */
export function Slot({
	items,
	align,
}: {
	items: readonly StatusItem[];
	align: StatusItem["align"];
}) {
	return (
		<>
			{orderItems(items, align).map((item) =>
				item.when ? (
					<Gated key={item.id} item={item} when={item.when} />
				) : (
					<item.component key={item.id} />
				),
			)}
		</>
	);
}

function Gated({
	item,
	when,
}: {
	item: StatusItem;
	when: NonNullable<StatusItem["when"]>;
}) {
	const shown = useEditor(when);
	return shown ? <item.component /> : null;
}
