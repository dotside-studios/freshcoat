import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { ContextMenu, MenuItem, MenuSeparator } from "@freshcoat-js/ui/menu";
import { treeRow } from "@freshcoat-js/ui/tree";
import { useMemo, useState } from "react";
import { ListBox, ListBoxItem } from "react-aria-components";
import { useController } from "~/app/context";
import type { EditorController } from "~/app/controller";
import { addSide, moveSide, removeSide, setFrameProp } from "~/doc/ops";
import { useEditor } from "~/state/hooks";
import { present } from "~/state/store";
import AddIcon from "~icons/mingcute/add-line";
import SideIcon from "~icons/mingcute/file-line";
import { RenameInput } from "./RenameInput";

/** A name unused by any side: "side-2", "side-3", … */
export function nextSideName(names: string[]): string {
	let n = names.length + 1;
	while (names.includes(`side-${n}`)) n++;
	return `side-${n}`;
}

// After a structural edit, keep showing the side that was showing, by name.
function follow(controller: EditorController, name: string | undefined) {
	const t = controller.template;
	if (!t || name === undefined) return;
	const i = t.template_data.findIndex((f) => f.name === name);
	if (i >= 0) controller.dispatch({ type: "setSide", side: i });
}

export function SidesHeaderActions() {
	const controller = useController();
	return (
		<IconButton
			aria-label="Add side"
			tooltip="Add side"
			className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
			onPress={() => {
				const t = controller.template;
				if (!t) return;
				const name = nextSideName(t.template_data.map((f) => f.name));
				const result = controller.edit((doc) => addSide(doc, name), {
					scope: "base",
				});
				if (result?.ok) follow(controller, name);
			}}
		>
			<AddIcon />
		</IconButton>
	);
}

export function SidesList() {
	const controller = useController();
	// A string, so an edit that leaves the side names alone does not rebuild
	// the list.
	const signature = useEditor((s) =>
		JSON.stringify(present(s)?.template_data.map((f) => f.name) ?? []),
	);
	const side = useEditor((s) => s.side);
	const [renaming, setRenaming] = useState<number | null>(null);
	const [menuSide, setMenuSide] = useState<number | null>(null);

	const names = useMemo(() => JSON.parse(signature) as string[], [signature]);
	const items = useMemo(
		() => names.map((name, index) => ({ id: index, name })),
		[names],
	);
	const selectedKeys = useMemo(() => new Set([side]), [side]);
	const target = menuSide ?? side;
	const current = () =>
		controller.template?.template_data[controller.state.side]?.name;

	const move = (from: number, to: number) => {
		const showing = current();
		const result = controller.edit((t) => moveSide(t, from, to), {
			scope: "base",
		});
		if (result?.ok) follow(controller, showing);
	};

	const menu = (
		<>
			<MenuItem id="rename" onAction={() => setRenaming(target)}>
				Rename
			</MenuItem>
			<MenuItem
				id="up"
				isDisabled={target <= 0}
				onAction={() => move(target, target - 1)}
			>
				Move up
			</MenuItem>
			<MenuItem
				id="down"
				isDisabled={target >= names.length - 1}
				onAction={() => move(target, target + 1)}
			>
				Move down
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				id="delete"
				destructive
				isDisabled={names.length <= 1}
				onAction={() => {
					const showing = target === side ? undefined : current();
					const result = controller.edit((t) => removeSide(t, target), {
						scope: "base",
					});
					if (result?.ok) follow(controller, showing);
				}}
			>
				Delete
			</MenuItem>
		</>
	);

	return (
		<ContextMenu
			menu={menu}
			menuProps={{ "aria-label": "Side actions" }}
			onOpen={(e) => {
				const el = (e.target as Element).closest?.("[data-side]");
				const i = el ? Number(el.getAttribute("data-side")) : null;
				setMenuSide(i);
			}}
			onOpenChange={(open) => {
				if (!open) setMenuSide(null);
			}}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: F2 renames the focused side */}
			<div
				onKeyDown={(e) => {
					if (e.key !== "F2" || renaming !== null) return;
					const el = (e.target as Element).closest?.("[data-side]");
					e.preventDefault();
					setRenaming(el ? Number(el.getAttribute("data-side")) : side);
				}}
			>
				<ListBox
					aria-label="Sides"
					data-testid="sides-list"
					items={items}
					dependencies={[renaming]}
					selectionMode="single"
					disallowEmptySelection
					selectedKeys={selectedKeys}
					onSelectionChange={(keys) => {
						const [k] = keys === "all" ? [] : [...keys];
						if (typeof k === "number")
							controller.dispatch({ type: "setSide", side: k });
					}}
					className="flex max-h-32 flex-col overflow-auto pb-1 outline-none pointer-coarse:max-h-44"
				>
					{(item) => (
						<ListBoxItem
							id={item.id}
							textValue={item.name}
							data-side={item.id}
							className={cn(
								treeRow,
								"gap-1.5 pr-1 pl-2.5 data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent",
							)}
						>
							<SideIcon className="size-3.5 shrink-0 text-fc-muted" />
							{renaming === item.id ? (
								<RenameInput
									initial={item.name}
									label={`Rename side ${item.name}`}
									onCommit={(value) =>
										controller.edit(
											(t) => setFrameProp(t, item.id, { name: value }),
											{ scope: "base" },
										)?.ok ?? false
									}
									onDone={() => setRenaming(null)}
								/>
							) : (
								// biome-ignore lint/a11y/noStaticElementInteractions: double-click is a shortcut; F2 and the context menu rename from the keyboard
								<span
									className="min-w-0 flex-1 truncate"
									onDoubleClick={() => setRenaming(item.id)}
								>
									{item.name}
								</span>
							)}
						</ListBoxItem>
					)}
				</ListBox>
			</div>
		</ContextMenu>
	);
}
