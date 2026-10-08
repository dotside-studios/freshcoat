import { Button } from "@freshcoat-js/ui/button";
import { inputBase } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { formatShortcut } from "@freshcoat-js/ui/kbd";
import { cn } from "@freshcoat-js/ui/lib/cn";
import {
	Menu,
	MenuItem,
	MenuSection,
	MenuSeparator,
	SubmenuTrigger,
} from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import {
	ToggleButton,
	ToggleGroup,
	ToggleGroupItem,
} from "@freshcoat-js/ui/toggle";
import { Tooltip, TooltipTrigger } from "@freshcoat-js/ui/tooltip";
import type { RecordStatus, TableFormat } from "@freshcoat-js/workspace";
import type { ReactNode } from "react";
import { MenuTrigger } from "react-aria-components";
import AddIcon from "~icons/mingcute/add-line";
import SchemaIcon from "~icons/mingcute/braces-line";
import CloseIcon from "~icons/mingcute/close-line";
import CopyIcon from "~icons/mingcute/copy-2-line";
import DeleteIcon from "~icons/mingcute/delete-2-line";
import DownIcon from "~icons/mingcute/down-line";
import ExportIcon from "~icons/mingcute/download-2-line";
import ImportIcon from "~icons/mingcute/file-import-line";
import FilterIcon from "~icons/mingcute/filter-line";
import FolderIcon from "~icons/mingcute/folder-open-line";
import GalleryIcon from "~icons/mingcute/grid-line";
import LeftPanelIcon from "~icons/mingcute/layout-leftbar-open-line";
import RightPanelIcon from "~icons/mingcute/layout-rightbar-open-line";
import StatusIcon from "~icons/mingcute/list-check-line";
import MoreIcon from "~icons/mingcute/more-1-line";
import PhotoIcon from "~icons/mingcute/pic-line";
import RowIcon from "~icons/mingcute/rows-2-line";
import SearchIcon from "~icons/mingcute/search-line";
import TableIcon from "~icons/mingcute/table-2-line";
import { EXPORT_FORMATS } from "./actions";
import { STATUSES } from "./cells";
import {
	CARD_SIZES,
	type CardSize,
	type RecordsView,
	STATUS_FILTERS,
	type StatusFilter,
} from "./gallery-model";

export type ToolbarActions = {
	addRow: () => void;
	duplicate: () => void;
	remove: () => void;
	setStatus: (status: RecordStatus) => void;
	importFile: () => void;
	importPhotos: () => void;
	importPhotoFolder: () => void;
	newPhotoDataset: (source: "files" | "folder") => void;
	exportAs: (format: TableFormat) => void;
	importSchema: () => void;
	exportSchema: () => void;
};

/** Below this window width the data group folds into a More menu. */
export const FOLD_DATA_BELOW = 1100;

export function ToolButton({
	icon,
	label,
	onPress,
	isDisabled,
	testId,
	menu,
	showLabel = "wide",
	shortcut,
	className,
}: {
	icon: ReactNode;
	label: string;
	onPress?: () => void;
	isDisabled?: boolean;
	testId?: string;
	menu?: boolean;
	/** `wide` and `wider`: the label shows once the toolbar has room;
	 *  `never`: a tooltip instead. */
	showLabel?: "wide" | "wider" | "always" | "never";
	shortcut?: string;
	className?: string;
}) {
	const button = (
		<Button
			variant="ghost"
			aria-label={label.replace(/…$/, "")}
			data-testid={testId}
			onPress={onPress}
			isDisabled={isDisabled}
			className={cn(
				"gap-1 px-1.5 font-normal text-fc-muted data-hovered:text-fc-text",
				className,
			)}
		>
			{icon}
			{showLabel === "never" ? null : (
				<span
					className={cn(
						showLabel === "wide" && "hidden @min-[760px]:inline",
						showLabel === "wider" && "hidden @min-[1000px]:inline",
					)}
				>
					{label}
				</span>
			)}
			{menu ? <DownIcon className="-ml-0.5 size-3! opacity-60" /> : null}
		</Button>
	);
	if (showLabel === "always" || menu) return button;
	return (
		<TooltipTrigger>
			{button}
			<Tooltip>
				{`${label.replace(/…$/, "")}${shortcut ? `  ${formatShortcut(shortcut)}` : ""}`}
			</Tooltip>
		</TooltipTrigger>
	);
}

function Group({ children, label }: { children: ReactNode; label: string }) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset would need a legend and restyling for a toolbar group
		<div role="group" aria-label={label} className="flex items-center gap-0.5">
			{children}
		</div>
	);
}

function Divider() {
	return (
		<span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-fc-border" />
	);
}

/**
 * The records toolbar, in three groups: how the records are viewed, what is
 * done to them, and moving data in and out. The last folds into a More menu
 * on a narrower window.
 */
export function DataToolbar({
	view,
	onView,
	cardSize,
	onCardSize,
	statusFilter,
	onStatusFilter,
	query,
	onQuery,
	selected,
	hasColumns,
	actions,
	panels,
	onPanels,
	foldData,
	exportSelected,
}: {
	view: RecordsView;
	onView: (view: RecordsView) => void;
	cardSize: CardSize;
	onCardSize: (size: CardSize) => void;
	statusFilter: StatusFilter;
	onStatusFilter: (filter: StatusFilter) => void;
	query: string;
	onQuery: (q: string) => void;
	selected: number;
	hasColumns: boolean;
	actions: ToolbarActions;
	panels: { left: boolean; right: boolean };
	onPanels: (p: Partial<{ left: boolean; right: boolean }>) => void;
	foldData: boolean;
	/** "Export selected", shown while records are selected */
	exportSelected?: ReactNode;
}) {
	const filtering = statusFilter !== "all";
	const filterLabel =
		STATUS_FILTERS.find((f) => f.id === statusFilter)?.label ?? "All records";
	return (
		<div
			className="@container flex h-9 shrink-0 items-center gap-0.5 border-fc-border border-b bg-fc-panel px-1.5 pointer-coarse:h-11"
			data-testid="data-toolbar"
		>
			<ToggleButton
				aria-label="Datasets panel"
				tooltip="Datasets panel"
				isSelected={panels.left}
				onChange={(v) => onPanels({ left: v })}
			>
				<LeftPanelIcon />
			</ToggleButton>
			<Divider />
			<Group label="View">
				<ToggleGroup
					aria-label="View"
					data-testid="view-switch"
					selectedKeys={[view]}
					onSelectionChange={(keys) => {
						const [k] = [...keys];
						if (k === "table" || k === "gallery") onView(k);
					}}
				>
					<ToggleGroupItem id="table" aria-label="Table" tooltip="Table">
						<TableIcon />
					</ToggleGroupItem>
					<ToggleGroupItem id="gallery" aria-label="Gallery" tooltip="Gallery">
						<GalleryIcon />
					</ToggleGroupItem>
				</ToggleGroup>
				<div className="relative ml-1 flex w-36 min-w-20 shrink items-center @min-[680px]:w-48">
					<SearchIcon className="pointer-events-none absolute left-1.5 size-3.5 text-fc-faint" />
					<input
						type="search"
						aria-label="Search records"
						placeholder="Search"
						value={query}
						onChange={(e) => onQuery(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Escape") onQuery("");
						}}
						className={cn(
							inputBase,
							"h-fc-control pr-6 pl-6 hover:border-fc-border-strong focus:border-fc-accent [&::-webkit-search-cancel-button]:hidden",
						)}
					/>
					{query ? (
						<IconButton
							aria-label="Clear search"
							onPress={() => onQuery("")}
							className="absolute right-0 size-5 [&_svg]:size-3"
						>
							<CloseIcon />
						</IconButton>
					) : null}
				</div>
				<MenuTrigger>
					<Button
						variant="ghost"
						aria-label={`Show: ${filterLabel}`}
						data-testid="status-filter"
						className={cn(
							"gap-1 px-1.5 font-normal",
							filtering
								? "bg-fc-accent-soft text-fc-text data-hovered:bg-fc-accent-soft"
								: "text-fc-muted data-hovered:text-fc-text",
						)}
					>
						<FilterIcon className={filtering ? "text-fc-accent" : undefined} />
						<span className={cn(!filtering && "hidden @min-[1000px]:inline")}>
							{filtering ? filterLabel : "Filter"}
						</span>
						<DownIcon className="-ml-0.5 size-3! opacity-60" />
					</Button>
					<Popover placement="bottom start">
						<Menu
							aria-label="Show records"
							selectionMode="single"
							selectedKeys={[statusFilter]}
							onAction={(k) => onStatusFilter(k as StatusFilter)}
						>
							{STATUS_FILTERS.map((f) => (
								<MenuItem key={f.id} id={f.id}>
									{f.label}
								</MenuItem>
							))}
						</Menu>
					</Popover>
				</MenuTrigger>
			</Group>
			<Divider />
			<Group label="Records">
				<MenuTrigger>
					<ToolButton
						icon={<AddIcon />}
						label="Add"
						testId="add-menu"
						showLabel="always"
						menu
					/>
					<Popover placement="bottom start">
						<Menu
							aria-label="Add records"
							disabledKeys={hasColumns ? [] : ["row"]}
						>
							<MenuItem id="row" icon={<RowIcon />} onAction={actions.addRow}>
								Record
							</MenuItem>
							<MenuItem
								id="photos"
								icon={<PhotoIcon />}
								onAction={actions.importPhotos}
							>
								Photos…
							</MenuItem>
							<MenuItem
								id="folder"
								icon={<FolderIcon />}
								onAction={actions.importPhotoFolder}
							>
								Folder of photos…
							</MenuItem>
							<MenuSeparator />
							<MenuSection title="New dataset">
								<MenuItem
									id="new-files"
									onAction={() => actions.newPhotoDataset("files")}
								>
									From photos…
								</MenuItem>
								<MenuItem
									id="new-folder"
									onAction={() => actions.newPhotoDataset("folder")}
								>
									From a folder…
								</MenuItem>
							</MenuSection>
						</Menu>
					</Popover>
				</MenuTrigger>
				<ToolButton
					icon={<CopyIcon />}
					label="Duplicate"
					testId="duplicate-rows"
					showLabel="never"
					isDisabled={selected === 0}
					onPress={actions.duplicate}
				/>
				<ToolButton
					icon={<DeleteIcon />}
					label="Delete"
					testId="delete-rows"
					showLabel="never"
					shortcut="Mod+Backspace"
					isDisabled={selected === 0}
					onPress={actions.remove}
				/>
				<MenuTrigger>
					<ToolButton
						icon={<StatusIcon />}
						label="Mark"
						testId="status-menu"
						showLabel="wider"
						isDisabled={selected === 0}
						menu
					/>
					<Popover placement="bottom start">
						<Menu
							aria-label="Set status"
							onAction={(k) => actions.setStatus(k as RecordStatus)}
						>
							{STATUSES.map((s) => (
								<MenuItem key={s.id} id={s.id}>
									{`Mark ${s.label.toLowerCase()}`}
								</MenuItem>
							))}
						</Menu>
					</Popover>
				</MenuTrigger>
				{exportSelected}
			</Group>
			{foldData ? null : (
				<>
					<Divider />
					<Group label="Data">
						<ToolButton
							icon={<ImportIcon />}
							label="Import…"
							testId="import-records"
							onPress={actions.importFile}
						/>
						<MenuTrigger>
							<ToolButton
								icon={<ExportIcon />}
								label="Download"
								testId="download-menu"
								menu
							/>
							<Popover placement="bottom start">
								<ExportMenu actions={actions} />
							</Popover>
						</MenuTrigger>
						<MenuTrigger>
							<ToolButton
								icon={<SchemaIcon />}
								label="Schema"
								testId="schema-menu"
								menu
							/>
							<Popover placement="bottom start">
								<SchemaMenu actions={actions} />
							</Popover>
						</MenuTrigger>
					</Group>
				</>
			)}
			<span className="min-w-0 flex-1" />
			{view === "gallery" ? (
				<ToggleGroup
					aria-label="Card size"
					data-testid="card-size"
					selectedKeys={[cardSize]}
					onSelectionChange={(keys) => {
						const [k] = [...keys];
						if (k === "s" || k === "m" || k === "l") onCardSize(k);
					}}
					className="mr-1"
				>
					{(Object.keys(CARD_SIZES) as CardSize[]).map((s) => (
						<ToggleGroupItem
							key={s}
							id={s}
							aria-label={`${CARD_SIZES[s].label} cards`}
							tooltip={`${CARD_SIZES[s].label} cards`}
							className="min-w-5 font-medium"
						>
							{s.toUpperCase()}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			) : null}
			{foldData ? (
				<MenuTrigger>
					<IconButton
						aria-label="More"
						tooltip="Import, download and schema"
						data-testid="data-more"
					>
						<MoreIcon />
					</IconButton>
					<Popover placement="bottom end">
						<Menu aria-label="More">
							<MenuItem
								id="import"
								icon={<ImportIcon />}
								onAction={actions.importFile}
							>
								Import…
							</MenuItem>
							<SubmenuTrigger>
								<MenuItem id="download" icon={<ExportIcon />}>
									Download
								</MenuItem>
								<Popover placement="end top">
									<ExportMenu actions={actions} />
								</Popover>
							</SubmenuTrigger>
							<SubmenuTrigger>
								<MenuItem id="schema" icon={<SchemaIcon />}>
									Schema
								</MenuItem>
								<Popover placement="end top">
									<SchemaMenu actions={actions} />
								</Popover>
							</SubmenuTrigger>
						</Menu>
					</Popover>
				</MenuTrigger>
			) : null}
			<ToggleButton
				aria-label="Record and columns panel"
				tooltip="Record and columns panel"
				isSelected={panels.right}
				onChange={(v) => onPanels({ right: v })}
			>
				<RightPanelIcon />
			</ToggleButton>
		</div>
	);
}

function ExportMenu({ actions }: { actions: ToolbarActions }) {
	return (
		<Menu
			aria-label="Download records"
			onAction={(k) => actions.exportAs(k as TableFormat)}
		>
			{EXPORT_FORMATS.map((f) => (
				<MenuItem key={f.id} id={f.id}>
					{f.label}
				</MenuItem>
			))}
		</Menu>
	);
}

function SchemaMenu({ actions }: { actions: ToolbarActions }) {
	return (
		<Menu aria-label="JSON schema">
			<MenuItem id="import" onAction={actions.importSchema}>
				Import JSON schema…
			</MenuItem>
			<MenuSeparator />
			<MenuItem id="export" onAction={actions.exportSchema}>
				Download JSON schema
			</MenuItem>
		</Menu>
	);
}
