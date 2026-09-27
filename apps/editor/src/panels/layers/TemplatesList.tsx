import { COAT_EXTENSION } from "@freshcoat-js/coatfile/coat";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import {
	ContextMenu,
	Menu,
	MenuItem,
	MenuSeparator,
} from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { treeRow } from "@freshcoat-js/ui/tree";
import { templateStem } from "@freshcoat-js/workspace";
import { useMemo, useState } from "react";
import { ListBox, ListBoxItem, MenuTrigger } from "react-aria-components";
import { useController } from "~/app/context";
import { readsDataset } from "~/binding/binding";
import { PRESETS } from "~/doc/new-document";
import { useEditor } from "~/state/hooks";
import AddIcon from "~icons/mingcute/add-line";
import TemplateIcon from "~icons/mingcute/layout-line";
import LinkIcon from "~icons/mingcute/link-line";
import { RenameInput } from "./RenameInput";

/** The workspace's templates; the active one is what Edit shows. */
export function TemplatesList() {
	const controller = useController();
	// A string of what the rows show, so edits inside a template do not
	// rebuild the list.
	const signature = useEditor((s) =>
		JSON.stringify(
			s.workspace?.templates.map((t) => [
				t.id,
				t.fileName,
				readsDataset(t.binding),
			]) ?? [],
		),
	);
	const active = useEditor((s) => s.workspace?.activeTemplateId ?? null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [menuId, setMenuId] = useState<string | null>(null);

	const items = useMemo(
		() =>
			(JSON.parse(signature) as [string, string, boolean][]).map(
				([id, fileName, bound]) => ({ id, fileName, bound }),
			),
		[signature],
	);
	const selectedKeys = useMemo(() => new Set(active ? [active] : []), [active]);
	const target = menuId ?? active;

	const menu = (
		<>
			<MenuItem id="rename" onAction={() => target && setRenaming(target)}>
				Rename
			</MenuItem>
			<MenuItem
				id="duplicate"
				onAction={() =>
					target &&
					controller.dispatch({ type: "duplicateTemplate", id: target })
				}
			>
				Duplicate
			</MenuItem>
			<MenuItem
				id="export"
				onAction={() => {
					if (target && target !== active) controller.switchTemplate(target);
					void controller.save("coat");
				}}
			>
				Export as .coat
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				id="delete"
				destructive
				isDisabled={items.length <= 1}
				onAction={() => target && controller.removeTemplate(target)}
			>
				Delete
			</MenuItem>
		</>
	);

	return (
		<ContextMenu
			menu={menu}
			menuProps={{ "aria-label": "Template actions" }}
			onOpen={(e) => {
				const el = (e.target as Element).closest?.("[data-template]");
				setMenuId(el?.getAttribute("data-template") ?? null);
			}}
			onOpenChange={(open) => {
				if (!open) setMenuId(null);
			}}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: F2 renames the focused template */}
			<div
				onKeyDown={(e) => {
					if (e.key !== "F2" || renaming !== null) return;
					const el = (e.target as Element).closest?.("[data-template]");
					e.preventDefault();
					setRenaming(el?.getAttribute("data-template") ?? active);
				}}
			>
				<ListBox
					aria-label="Templates"
					data-testid="templates-list"
					items={items}
					dependencies={[renaming]}
					selectionMode="single"
					disallowEmptySelection
					selectedKeys={selectedKeys}
					onSelectionChange={(keys) => {
						const [k] = keys === "all" ? [] : [...keys];
						if (typeof k === "string") controller.switchTemplate(k);
					}}
					className="flex max-h-32 flex-col overflow-auto pb-1 outline-none pointer-coarse:max-h-44"
				>
					{(item) => (
						<ListBoxItem
							id={item.id}
							textValue={item.fileName}
							data-template={item.id}
							className={cn(
								treeRow,
								"gap-1.5 pr-1 pl-2.5 data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent",
							)}
						>
							<TemplateIcon className="size-3.5 shrink-0 text-fc-muted" />
							{renaming === item.id ? (
								<RenameInput
									initial={item.fileName}
									label={`Rename template ${item.fileName}`}
									onCommit={(value) => {
										const name = value.trim();
										if (!name) return false;
										controller.dispatch({
											type: "renameTemplateEntry",
											id: item.id,
											fileName: /\.(coat|tkit)(\.json)?$/i.test(name)
												? name
												: `${name}${COAT_EXTENSION}`,
										});
										return true;
									}}
									onDone={() => setRenaming(null)}
								/>
							) : (
								// biome-ignore lint/a11y/noStaticElementInteractions: double-click is a shortcut; F2 and the context menu rename from the keyboard
								<span
									className="min-w-0 flex-1 truncate"
									onDoubleClick={() => setRenaming(item.id)}
								>
									{templateStem(item.fileName)}
								</span>
							)}
							{item.bound ? (
								<LinkIcon
									aria-label="Bound to a dataset"
									className="size-3.5 shrink-0 text-fc-accent"
								/>
							) : null}
						</ListBoxItem>
					)}
				</ListBox>
			</div>
		</ContextMenu>
	);
}

export function TemplatesHeaderActions() {
	const controller = useController();
	return (
		<MenuTrigger>
			<IconButton
				aria-label="Add template"
				tooltip="Add template"
				className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
			>
				<AddIcon />
			</IconButton>
			<Popover placement="bottom end">
				<Menu
					aria-label="New template"
					onAction={(id) => {
						const preset = PRESETS.find((p) => p.id === id);
						if (preset) controller.newTemplate(preset);
					}}
				>
					{PRESETS.map((p) => (
						<MenuItem key={p.id} id={p.id}>
							{`${p.name} · ${p.width}×${p.height}`}
						</MenuItem>
					))}
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}
