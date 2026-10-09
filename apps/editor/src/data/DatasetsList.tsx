import { templateStem } from "@freshcoat-js/coatfile/coat";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import {
	ContextMenu,
	Menu,
	MenuItem,
	MenuSeparator,
} from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import { toast } from "@freshcoat-js/ui/toast";
import { treeRow } from "@freshcoat-js/ui/tree";
import { uniqueName } from "@freshcoat-js/workspace";
import {
	duplicateDataset,
	templatesUsing,
} from "@freshcoat-js/workspace/dataset";
import { useMemo, useState } from "react";
import { ListBox, ListBoxItem, MenuTrigger } from "react-aria-components";
import { useController } from "~/app/context";
import { formatNumber } from "~/app/format";
import { RenameInput } from "~/panels/layers/RenameInput";
import { useEditor } from "~/state/hooks";
import AddIcon from "~icons/mingcute/add-line";
import TableIcon from "~icons/mingcute/table-2-line";

/** New dataset actions, shared by the list header and the empty state. */
export type DatasetCreators = {
	newDataset: () => void;
	fromTemplate: () => void;
	importFile: () => void;
	fromPhotos: () => void;
};

export function DatasetsList({ create }: { create: DatasetCreators }) {
	const controller = useController();
	const datasets = useEditor((s) => s.workspace?.datasets);
	const active = useEditor((s) => s.workspace?.activeDatasetId ?? null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [menuId, setMenuId] = useState<string | null>(null);

	const items = useMemo(
		() =>
			(datasets ?? []).map((d) => ({
				id: d.id,
				name: d.name,
				count: d.records.length,
			})),
		[datasets],
	);
	const selectedKeys = useMemo(() => new Set(active ? [active] : []), [active]);
	const target = menuId ?? active;

	const duplicate = (id: string) => {
		const all = controller.state.workspace?.datasets ?? [];
		const source = all.find((d) => d.id === id);
		if (!source) return;
		const copy = duplicateDataset(
			source,
			uniqueName(
				`${source.name} copy`,
				all.map((d) => d.name),
			),
		);
		const index = all.indexOf(source);
		controller.dispatch({
			type: "datasetEdit",
			datasets: [...all.slice(0, index + 1), copy, ...all.slice(index + 1)],
			activeId: copy.id,
		});
	};

	const remove = (id: string) => {
		const ws = controller.state.workspace;
		if (!ws) return;
		const users = templatesUsing(ws.templates, id);
		if (users.length > 0) {
			const names = users.map((t) => templateStem(t.fileName));
			toast(
				`Can't delete: ${names.join(", ")} ${users.length === 1 ? "is" : "are"} bound to it`,
				{ tone: "warning", timeout: 6000 },
			);
			return;
		}
		controller.dispatch({
			type: "datasetEdit",
			datasets: ws.datasets.filter((d) => d.id !== id),
		});
	};

	const rename = (id: string, value: string): boolean => {
		const name = value.trim();
		const all = controller.state.workspace?.datasets ?? [];
		if (!name) return false;
		if (all.some((d) => d.id !== id && d.name === name)) {
			toast(`A dataset called ${name} already exists`, { tone: "warning" });
			return false;
		}
		controller.dispatch({
			type: "datasetEdit",
			datasets: all.map((d) => (d.id === id ? { ...d, name } : d)),
		});
		return true;
	};

	const menu = (
		<>
			<MenuItem id="rename" onAction={() => target && setRenaming(target)}>
				Rename
			</MenuItem>
			<MenuItem id="duplicate" onAction={() => target && duplicate(target)}>
				Duplicate
			</MenuItem>
			<MenuSeparator />
			<MenuItem
				id="delete"
				destructive
				onAction={() => target && remove(target)}
			>
				Delete
			</MenuItem>
		</>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-7 shrink-0 items-center border-fc-border border-b pr-1 pl-2.5 pointer-coarse:h-9">
				<h2 className="min-w-0 flex-1 truncate font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]">
					Datasets
				</h2>
				<MenuTrigger>
					<IconButton
						aria-label="New dataset"
						tooltip="New dataset"
						className="size-5 pointer-coarse:size-7 [&_svg]:size-3.5"
					>
						<AddIcon />
					</IconButton>
					<Popover placement="bottom end">
						<Menu aria-label="New dataset">
							<MenuItem id="new" onAction={create.newDataset}>
								Empty dataset
							</MenuItem>
							<MenuItem id="template" onAction={create.fromTemplate}>
								From template fields
							</MenuItem>
							<MenuItem id="import" onAction={create.importFile}>
								Import file…
							</MenuItem>
							<MenuItem id="photos" onAction={create.fromPhotos}>
								From photos…
							</MenuItem>
						</Menu>
					</Popover>
				</MenuTrigger>
			</div>
			<ContextMenu
				className="min-h-0 flex-1 overflow-auto"
				menu={menu}
				menuProps={{ "aria-label": "Dataset actions" }}
				onOpen={(e) => {
					const el = (e.target as Element).closest?.("[data-dataset]");
					setMenuId(el?.getAttribute("data-dataset") ?? null);
				}}
				onOpenChange={(open) => {
					if (!open) setMenuId(null);
				}}
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: F2 renames the focused dataset */}
				<div
					onKeyDown={(e) => {
						if (renaming !== null) return;
						const el = (e.target as Element).closest?.("[data-dataset]");
						const id = el?.getAttribute("data-dataset") ?? active;
						if (!id) return;
						if (e.key === "F2") {
							e.preventDefault();
							setRenaming(id);
						} else if (e.key === "Delete" || e.key === "Backspace") {
							e.preventDefault();
							remove(id);
						}
					}}
				>
					<ListBox
						aria-label="Datasets"
						data-testid="datasets-list"
						items={items}
						dependencies={[renaming]}
						selectionMode="single"
						disallowEmptySelection
						selectedKeys={selectedKeys}
						onSelectionChange={(keys) => {
							const [k] = keys === "all" ? [] : [...keys];
							if (typeof k === "string")
								controller.dispatch({ type: "setActiveDataset", id: k });
						}}
						className="flex flex-col py-1 outline-none"
					>
						{(item) => (
							<ListBoxItem
								id={item.id}
								textValue={item.name}
								data-dataset={item.id}
								className={cn(
									treeRow,
									"gap-1.5 pr-2 pl-2.5 data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent",
								)}
							>
								<TableIcon className="size-3.5 shrink-0 text-fc-muted" />
								{renaming === item.id ? (
									<RenameInput
										initial={item.name}
										label={`Rename dataset ${item.name}`}
										onCommit={(value) => rename(item.id, value)}
										onDone={() => setRenaming(null)}
									/>
								) : (
									<>
										{/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a shortcut; F2 and the context menu rename from the keyboard */}
										<span
											className="min-w-0 flex-1 truncate"
											onDoubleClick={() => setRenaming(item.id)}
										>
											{item.name}
										</span>
										<span className="shrink-0 text-fc-faint text-fc-sm tabular-nums">
											{formatNumber(item.count)}
										</span>
									</>
								)}
							</ListBoxItem>
						)}
					</ListBox>
				</div>
			</ContextMenu>
		</div>
	);
}
