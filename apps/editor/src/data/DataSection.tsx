import { Button } from "@freshcoat-js/ui/button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Tab, TabList, TabPanel, Tabs } from "@freshcoat-js/ui/tabs";
import { toast } from "@freshcoat-js/ui/toast";
import {
	type Dataset,
	jsonSchemaToColumns,
	type RecordStatus,
	type TableFormat,
	templateStem,
} from "@freshcoat-js/workspace";
import {
	type DragEvent,
	type ReactNode,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Selection } from "react-aria-components";
import { useController } from "~/app/context";
import { EMPTY, plural } from "~/app/copy";
import { formatBytes, formatNumber } from "~/app/format";
import { useEditor } from "~/state/hooks";
import type { EditorState } from "~/state/store";
import AddIcon from "~icons/mingcute/add-line";
import ImportIcon from "~icons/mingcute/file-import-line";
import FolderIcon from "~icons/mingcute/folder-open-line";
import TemplateIcon from "~icons/mingcute/layout-line";
import PhotoIcon from "~icons/mingcute/pic-line";
import UploadIcon from "~icons/mingcute/upload-2-line";
import {
	dragHasFiles,
	editDataset,
	exportDataset,
	exportJsonSchema,
	filesFromDrop,
	importPhotos,
	isPhotoDrop,
	isTableFile,
	newDatasetFromPhotos,
	type PickedFile,
	photosIntoEmptyDataset,
	pickFiles,
} from "./actions";
import { ColumnsPanel } from "./ColumnsPanel";
import { type Confirm, useConfirm } from "./ConfirmDialog";
import { type DatasetCreators, DatasetsList } from "./DatasetsList";
import { DataToolbar, FOLD_DATA_BELOW } from "./DataToolbar";
import { DataJobBar, ExportSelected } from "./ExportSelected";
import {
	type CardSize,
	filterByStatus,
	photoBytes,
	type RecordsView,
	rememberView,
	type StatusFilter,
	viewFor,
} from "./gallery-model";
import { GridUiStore, selectionIds, useGridUi } from "./grid-state";
import { type ImportTarget, ImportWizard } from "./ImportWizard";
import {
	addRecords,
	applySchema,
	cellIssue,
	columnsFromTemplate,
	deleteRecords,
	duplicateRecords,
	emptyDataset,
	filterRecords,
	issueCount,
	recordIndexMap,
	type SortSpec,
	schemaChanges,
	sortRecords,
	uniqueName,
} from "./model";
import { PhotoImportBar } from "./PhotoImportBar";
import { RecordPanel } from "./RecordPanel";
import { RecordsGallery } from "./RecordsGallery";
import { type GridHandle, RecordsGrid } from "./RecordsGrid";

// The same breakpoint as Edit: below it the side panels cover the grid.
const OVERLAY_BELOW = 960;
// Tablet portrait and below: the gallery takes a fixed number of columns.
const NARROW_GALLERY_BELOW = 821;

export type InspectorTab = "record" | "columns";

type Panels = { left: boolean; right: boolean };

function selectActive(s: EditorState): Dataset | undefined {
	const ws = s.workspace;
	if (!ws) return undefined;
	return ws.datasets.find((d) => d.id === ws.activeDatasetId) ?? ws.datasets[0];
}

export function DataSection() {
	const controller = useController();
	const hasWorkspace = useEditor((s) => !!s.workspace);
	const count = useEditor((s) => s.workspace?.datasets.length ?? 0);
	const dataset = useEditor(selectActive);
	const narrow = useBelow(OVERLAY_BELOW);
	// Below the fold width the right panel is a sheet over the records.
	const tablet = useBelow(FOLD_DATA_BELOW);
	const narrowGallery = useBelow(NARROW_GALLERY_BELOW);
	const [panels, setPanels] = useState<Panels>(() => ({
		left: !narrow,
		right: !tablet,
	}));
	const [wizard, setWizard] = useState<ImportTarget | null>(null);
	const [column, setColumn] = useState<string | null>(null);
	const [importNonce, setImportNonce] = useState(0);
	const [tab, setTab] = useState<InspectorTab>("record");
	// Once someone picks a tab, focusing a record no longer changes it.
	const tabChosen = useRef(false);
	const { confirm, element: confirmElement } = useConfirm();

	useEffect(() => {
		setPanels({ left: !narrow, right: !tablet });
	}, [narrow, tablet]);

	const onPanels = useCallback(
		(p: Partial<Panels>) =>
			setPanels((old) => {
				const next = { ...old, ...p };
				// Overlays take turns on a narrow window.
				if (narrow && p.left) next.right = false;
				if (narrow && p.right) next.left = false;
				return next;
			}),
		[narrow],
	);

	const inspector = useMemo(
		() => ({
			tab,
			chooseTab: (next: InspectorTab) => {
				tabChosen.current = true;
				setTab(next);
			},
			/** A record got the focus. */
			recordFocused: () => {
				if (!tabChosen.current) setTab("record");
			},
			/** A record was opened with Enter or a double-click. */
			openRecord: () => {
				setTab("record");
				onPanels({ right: true });
			},
		}),
		[tab, onPanels],
	);

	const create = useMemo<DatasetCreators>(() => {
		const add = (d: Dataset) => {
			const all = controller.state.workspace?.datasets ?? [];
			controller.dispatch({
				type: "datasetEdit",
				datasets: [...all, d],
				activeId: d.id,
			});
		};
		const names = () =>
			controller.state.workspace?.datasets.map((d) => d.name) ?? [];
		return {
			newDataset: () =>
				add(
					emptyDataset(uniqueName("Dataset", names()), [
						{ key: "name", type: "text" },
					]),
				),
			fromTemplate: () => {
				const template = controller.template;
				const ws = controller.state.workspace;
				if (!template || !ws) return;
				const columns = columnsFromTemplate(template);
				if (columns.length === 0) {
					toast("The active template has no fields", { tone: "warning" });
					return;
				}
				const slot = ws.templates.find((t) => t.id === ws.activeTemplateId);
				const base =
					(slot && templateStem(slot.fileName)) || template.name || "Template";
				add(emptyDataset(uniqueName(base, names()), columns));
			},
			importFile: () => setWizard({ newDataset: true }),
			fromPhotos: () => void newDatasetFromPhotos(controller, "files"),
		};
	}, [controller]);

	const [dropping, setDropping] = useState(false);
	const dragDepth = useRef(0);

	// Photos, zips, folders and spreadsheets dropped anywhere in the section go
	// to the open dataset, or make a new one when there is none.
	const onDrop = (e: DragEvent) => {
		dragDepth.current = 0;
		setDropping(false);
		if (!dragHasFiles(e.dataTransfer)) return;
		e.preventDefault();
		e.stopPropagation();
		if (!isPhotoDrop(e.dataTransfer)) {
			const table = [...e.dataTransfer.files].find((f) => isTableFile(f.name));
			if (!table)
				toast("Drop photos, a folder or a spreadsheet", { tone: "warning" });
			else
				setWizard(
					dataset
						? { datasetId: dataset.id, file: table }
						: { newDataset: true, file: table },
				);
			return;
		}
		const target = dataset;
		void filesFromDrop(e.dataTransfer).then(async (files) => {
			if (!target) await newDatasetFromPhotos(controller, files);
			else if (target.records.length === 0)
				await photosIntoEmptyDataset(controller, target.id, files);
			else await importPhotos(controller, target.id, files);
		});
	};

	if (!hasWorkspace) return null;

	const empty = count === 0 || !dataset;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: dropping photos is a shortcut for the Photos menu
		<div
			className="relative flex min-h-0 flex-1 flex-col bg-fc-app"
			data-testid="section-data"
			onDragOver={(e) => {
				if (dragHasFiles(e.dataTransfer)) e.preventDefault();
			}}
			onDragEnter={(e) => {
				if (empty || !dragHasFiles(e.dataTransfer)) return;
				dragDepth.current += 1;
				setDropping(true);
			}}
			onDragLeave={() => {
				dragDepth.current = Math.max(0, dragDepth.current - 1);
				if (dragDepth.current === 0) setDropping(false);
			}}
			onDrop={onDrop}
		>
			{dropping && !empty ? (
				<div
					className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-[8px] border border-fc-accent border-dashed bg-fc-accent-soft/80 text-fc-base text-fc-text"
					data-testid="data-drop-overlay"
				>
					{`Drop photos or a spreadsheet to add them to ${dataset.name}`}
				</div>
			) : null}
			{empty ? (
				<EmptyState
					create={create}
					onTable={(file) => setWizard({ newDataset: true, file })}
				/>
			) : (
				<div className="relative flex min-h-0 flex-1">
					<SidePanel
						side="left"
						open={panels.left}
						overlay={narrow}
						width={220}
						onClose={() => onPanels({ left: false })}
					>
						<DatasetsList create={create} />
					</SidePanel>
					<RecordsPane
						key={dataset.id}
						dataset={dataset}
						panels={panels}
						onPanels={onPanels}
						rightOverlay={tablet}
						foldData={tablet}
						narrowGallery={narrowGallery}
						inspector={inspector}
						column={column}
						onColumn={setColumn}
						onImport={(file) =>
							setWizard({ datasetId: dataset.id, ...(file ? { file } : {}) })
						}
						confirm={confirm}
						importNonce={importNonce}
					/>
				</div>
			)}
			{wizard ? (
				<ImportWizard
					target={wizard}
					onClose={() => setWizard(null)}
					onImported={(id, summary) => {
						toast(summary, { tone: "success", timeout: 6000 });
						setImportNonce((n) => n + 1);
						requestAnimationFrame(() =>
							document
								.querySelector(`[data-dataset="${CSS.escape(id)}"]`)
								?.scrollIntoView({ block: "nearest" }),
						);
					}}
				/>
			) : null}
			{confirmElement}
			<PhotoImportBar />
		</div>
	);
}

/**
 * A place to drop photos, a folder or a spreadsheet, with the same choices as
 * buttons. Photos and folders are handed to `onPhotos`, a table file to
 * `onTable`; anything else is refused with a note.
 */
function DropZone({
	title,
	children,
	onPhotos,
	onTable,
	actions,
	testId,
}: {
	title: string;
	children: ReactNode;
	onPhotos: (files: PickedFile[]) => void;
	onTable: (file: File) => void;
	actions: ReactNode;
	testId: string;
}) {
	const [over, setOver] = useState(false);
	const depth = useRef(0);
	return (
		<div className="grid min-h-0 flex-1 place-items-center overflow-auto p-6">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; every drop has a button beside it */}
			<div
				data-testid={testId}
				data-over={over || undefined}
				onDragEnter={(e) => {
					if (!dragHasFiles(e.dataTransfer)) return;
					depth.current += 1;
					setOver(true);
				}}
				onDragLeave={() => {
					depth.current = Math.max(0, depth.current - 1);
					if (depth.current === 0) setOver(false);
				}}
				onDragOver={(e) => {
					if (dragHasFiles(e.dataTransfer)) e.preventDefault();
				}}
				onDrop={(e) => {
					depth.current = 0;
					setOver(false);
					if (!dragHasFiles(e.dataTransfer)) return;
					e.preventDefault();
					e.stopPropagation();
					const dt = e.dataTransfer;
					const table = [...dt.files].find((f) => isTableFile(f.name));
					if (!isPhotoDrop(dt) && table) {
						onTable(table);
						return;
					}
					if (!isPhotoDrop(dt)) {
						toast("Drop photos, a folder or a spreadsheet", {
							tone: "warning",
						});
						return;
					}
					void filesFromDrop(dt).then(onPhotos);
				}}
				className={cn(
					"flex w-full max-w-xl flex-col items-center gap-3 rounded-[8px] border border-dashed px-8 py-10 text-center transition-colors",
					over
						? "border-fc-accent bg-fc-accent-soft"
						: "border-fc-border-strong bg-fc-panel/60",
				)}
			>
				<span
					className={cn(
						"grid size-11 place-items-center rounded-full",
						over ? "bg-fc-accent text-white" : "bg-fc-raised text-fc-muted",
					)}
				>
					<UploadIcon className="size-5" />
				</span>
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold text-[15px]">{title}</h2>
					<p className="max-w-sm text-fc-muted">{children}</p>
				</div>
				<div className="mt-1 flex flex-wrap justify-center gap-2">
					{actions}
				</div>
			</div>
		</div>
	);
}

function EmptyState({
	create,
	onTable,
}: {
	create: DatasetCreators;
	onTable: (file: File) => void;
}) {
	const controller = useController();
	return (
		<div className="flex min-h-0 flex-1 flex-col" data-testid="data-empty">
			<DropZone
				testId="data-drop-zone"
				title={EMPTY.datasets}
				onPhotos={(files) => void newDatasetFromPhotos(controller, files)}
				onTable={onTable}
				actions={
					<>
						<Button variant="primary" onPress={create.fromPhotos}>
							<PhotoIcon />
							From photos…
						</Button>
						<Button
							onPress={() => void newDatasetFromPhotos(controller, "folder")}
						>
							<FolderIcon />
							From a folder…
						</Button>
						<Button onPress={create.importFile}>
							<ImportIcon />
							Import file…
						</Button>
						<Button onPress={create.fromTemplate}>
							<TemplateIcon />
							From template fields
						</Button>
						<Button variant="ghost" onPress={create.newDataset}>
							<AddIcon />
							New dataset
						</Button>
					</>
				}
			>
				Drop photos, a folder or a spreadsheet
			</DropZone>
		</div>
	);
}

type Inspector = {
	tab: InspectorTab;
	chooseTab: (tab: InspectorTab) => void;
	recordFocused: () => void;
	openRecord: () => void;
};

const CARD_SIZE_KEY = "freshcoat.gallery.cardSize";

function savedCardSize(): CardSize {
	try {
		const v = localStorage.getItem(CARD_SIZE_KEY);
		if (v === "s" || v === "m" || v === "l") return v;
	} catch {}
	return "m";
}

function RecordsPane({
	dataset,
	panels,
	onPanels,
	rightOverlay,
	foldData,
	narrowGallery,
	inspector,
	column,
	onColumn,
	onImport,
	confirm,
	importNonce,
}: {
	dataset: Dataset;
	panels: Panels;
	onPanels: (p: Partial<Panels>) => void;
	rightOverlay: boolean;
	foldData: boolean;
	narrowGallery: boolean;
	inspector: Inspector;
	column: string | null;
	onColumn: (key: string | null) => void;
	onImport: (file?: File) => void;
	confirm: Confirm;
	importNonce: number;
}) {
	const controller = useController();
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [sort, setSort] = useState<SortSpec | undefined>();
	const [selection, setSelection] = useState<Selection>(() => new Set());
	const [view, setViewState] = useState<RecordsView>(() => viewFor(dataset));
	const [cardSize, setCardSizeState] = useState<CardSize>(savedCardSize);
	const ui = useMemo(() => new GridUiStore(), []);
	const grid = useRef<GridHandle>(null);
	const datasetId = dataset.id;

	const setView = useCallback(
		(next: RecordsView) => {
			rememberView(datasetId, next);
			setViewState(next);
		},
		[datasetId],
	);
	const setCardSize = (next: CardSize) => {
		setCardSizeState(next);
		try {
			localStorage.setItem(CARD_SIZE_KEY, next);
		} catch {}
	};

	const indexMap = recordIndexMap(dataset.records);
	const searched = useMemo(
		() => filterRecords(dataset.records, dataset, deferredQuery),
		[dataset, deferredQuery],
	);
	const filtered = useMemo(
		() => filterByStatus(searched, dataset, statusFilter),
		[searched, dataset, statusFilter],
	);
	const rows = useMemo(
		() =>
			sortRecords(
				filtered,
				dataset.columns,
				sort,
				(id) => indexMap.get(id) ?? 0,
			),
		[filtered, dataset.columns, sort, indexMap],
	);

	const selectedIds = useMemo(
		() => selectionIds(selection, rows),
		[selection, rows],
	);

	// Focusing a record, in either view, brings up the Record tab.
	const { recordFocused } = inspector;
	useEffect(() => {
		let last = ui.get().active?.row ?? null;
		return ui.subscribe(() => {
			const row = ui.get().active?.row ?? null;
			if (row === last) return;
			last = row;
			if (row) recordFocused();
		});
	}, [ui, recordFocused]);

	useEffect(() => {
		if (importNonce === 0) return;
		setQuery("");
		setStatusFilter("all");
		setSelection(new Set());
		const scroller = document.querySelector<HTMLElement>(
			"[data-testid=records-grid] [role=grid], [data-testid=records-gallery] [role=grid]",
		);
		if (scroller) scroller.scrollTop = 0;
	}, [importNonce]);

	const deleteRows = useCallback(
		async (ids: string[]) => {
			if (ids.length === 0) return;
			if (ids.length > 1) {
				const answer = await confirm({
					title: "Delete records",
					message: `Delete ${plural(ids.length, "record")}? You can undo this.`,
					confirmLabel: "Delete",
					destructive: true,
				});
				if (answer !== "confirm") return;
			}
			editDataset(controller, datasetId, (d) => deleteRecords(d, ids));
			setSelection(new Set());
			const active = ui.get().active;
			if (active && ids.includes(active.row)) ui.set({ active: null });
		},
		[confirm, controller, datasetId, ui],
	);

	const onImportPhotos = useCallback(
		() => void importPhotos(controller, datasetId),
		[controller, datasetId],
	);

	const focusRecord = useCallback(
		(id: string) => {
			const col = ui.get().active?.col ?? dataset.columns[0]?.key ?? "";
			ui.set({ active: { row: id, col } });
		},
		[ui, dataset.columns],
	);

	const { openRecord } = inspector;
	const onOpen = useCallback(
		(id: string) => {
			focusRecord(id);
			openRecord();
		},
		[focusRecord, openRecord],
	);

	const empty = dataset.records.length === 0;
	const onEmptyPhotos = (source: PickedFile[] | "files" | "folder") =>
		void photosIntoEmptyDataset(controller, datasetId, source);

	const actions = {
		addRow: () => {
			setQuery("");
			setStatusFilter("all");
			let added: string[] = [];
			editDataset(controller, datasetId, (d) => {
				const out = addRecords(d);
				added = out.ids;
				return out.dataset;
			});
			const id = added[0];
			if (!id) return;
			if (view === "table")
				requestAnimationFrame(() => grid.current?.reveal(id, undefined, true));
			else {
				setSelection(new Set([id]));
				onOpen(id);
			}
		},
		duplicate: () => {
			const ids = selectedIds.length
				? selectedIds
				: ui.get().active
					? [ui.get().active?.row as string]
					: [];
			let created: string[] = [];
			editDataset(controller, datasetId, (d) => {
				const out = duplicateRecords(d, ids);
				created = out.ids;
				return out.dataset;
			});
			if (created.length) setSelection(new Set(created));
		},
		remove: () => void deleteRows([...selectedIds]),
		setStatus: (status: RecordStatus) =>
			controller.dispatch({
				type: "setRecordStatus",
				datasetId,
				ids: [...selectedIds],
				status,
			}),
		importFile: () => onImport(),
		importPhotos: empty ? () => onEmptyPhotos("files") : onImportPhotos,
		importPhotoFolder: () =>
			empty
				? onEmptyPhotos("folder")
				: void importPhotos(controller, datasetId, "folder"),
		newPhotoDataset: (source: "files" | "folder") =>
			void newDatasetFromPhotos(controller, source),
		exportAs: (format: TableFormat) => void exportDataset(dataset, format),
		exportSchema: () => void exportJsonSchema(dataset),
		importSchema: () => void importSchema(),
	};

	const importSchema = async () => {
		const [file] = await pickFiles({ accept: ".json,application/json" });
		if (!file) return;
		let doc: unknown;
		try {
			doc = JSON.parse(await file.text());
		} catch {
			toast(`${file.name} isn't JSON`, { tone: "danger" });
			return;
		}
		const { columns, warnings } = jsonSchemaToColumns(doc);
		if (columns.length === 0) {
			toast(warnings[0] ?? `No columns in ${file.name}`, {
				tone: "danger",
			});
			return;
		}
		const current =
			controller.state.workspace?.datasets.find((d) => d.id === datasetId) ??
			dataset;
		const replace = schemaChanges(current, columns, "replace");
		const merge = schemaChanges(current, columns, "merge");
		const list = (label: string, keys: string[]) =>
			keys.length ? (
				<li>
					{label}: {keys.join(", ")}
				</li>
			) : null;
		const answer = await confirm({
			title: "Import JSON schema",
			message: (
				<div className="flex flex-col gap-2">
					<p>
						{plural(columns.length, "column")} in {file.name}
					</p>
					<ul className="list-disc pl-4 text-fc-sm">
						{list("New", merge.added)}
						{list("Changed", merge.changed)}
						{list("Replace removes", replace.removed)}
					</ul>
					<p className="text-fc-sm">
						Merge keeps columns the schema doesn't name
					</p>
				</div>
			),
			confirmLabel: "Replace columns",
			alternative: "Merge",
		});
		if (answer === "cancel") return;
		editDataset(controller, datasetId, (d) =>
			applySchema(d, columns, answer === "confirm" ? "replace" : "merge"),
		);
		if (warnings.length)
			toast(
				`${plural(warnings.length, "note")}: ${warnings.slice(0, 3).join("; ")}${warnings.length > 3 ? "…" : ""}`,
				{ tone: "warning", timeout: 8000 },
			);
		else toast("Schema imported", { tone: "success" });
	};

	const emptyState: ReactNode =
		dataset.columns.length === 0
			? EMPTY.columns
			: dataset.records.length === 0
				? EMPTY.records
				: EMPTY.noMatch;

	return (
		<>
			<div className="flex min-w-0 flex-1 flex-col" data-testid="records-pane">
				<DataToolbar
					view={view}
					onView={setView}
					cardSize={cardSize}
					onCardSize={setCardSize}
					statusFilter={statusFilter}
					onStatusFilter={setStatusFilter}
					query={query}
					onQuery={setQuery}
					selected={selectedIds.length}
					hasColumns={dataset.columns.length > 0}
					actions={actions}
					panels={panels}
					onPanels={onPanels}
					foldData={foldData}
					exportSelected={
						selectedIds.length > 0 ? (
							<ExportSelected datasetId={datasetId} ids={selectedIds} />
						) : null
					}
				/>
				{empty ? (
					<DropZone
						testId="dataset-drop-zone"
						title={EMPTY.records}
						onPhotos={onEmptyPhotos}
						onTable={(file) => onImport(file)}
						actions={
							<>
								<Button
									variant="primary"
									onPress={() => onEmptyPhotos("files")}
								>
									<PhotoIcon />
									Add photos…
								</Button>
								<Button onPress={() => onEmptyPhotos("folder")}>
									<FolderIcon />
									Add a folder…
								</Button>
								<Button onPress={() => onImport()}>
									<ImportIcon />
									Import file…
								</Button>
								{dataset.columns.length ? (
									<Button variant="ghost" onPress={actions.addRow}>
										<AddIcon />
										Add a record
									</Button>
								) : null}
							</>
						}
					>
						Drop photos, a folder or a spreadsheet
					</DropZone>
				) : view === "gallery" ? (
					<RecordsGallery
						dataset={dataset}
						rows={rows}
						selection={selection}
						onSelectionChange={setSelection}
						selectedIds={selectedIds}
						ui={ui}
						size={cardSize}
						narrow={narrowGallery}
						onOpen={onOpen}
						onDeleteRows={deleteRows}
						emptyState={emptyState}
					/>
				) : (
					<RecordsGrid
						ref={grid}
						dataset={dataset}
						rows={rows}
						sort={sort}
						onSortChange={setSort}
						selection={selection}
						onSelectionChange={setSelection}
						selectedIds={selectedIds}
						ui={ui}
						onColumnFocus={onColumn}
						onDeleteRows={deleteRows}
						onImportPhotos={onImportPhotos}
						emptyState={emptyState}
					/>
				)}
				<DataJobBar onShowFailed={() => setStatusFilter("failed")} />
				<DataStatusBar
					dataset={dataset}
					shown={rows.length}
					selected={selectedIds.length}
					ui={ui}
				/>
			</div>
			<SidePanel
				side="right"
				open={panels.right}
				overlay={rightOverlay}
				width={300}
				onClose={() => onPanels({ right: false })}
			>
				<Tabs
					selectedKey={inspector.tab}
					onSelectionChange={(key) => inspector.chooseTab(key as InspectorTab)}
					className="min-h-0 flex-1"
				>
					<TabList aria-label="Inspector">
						<Tab id="record">Record</Tab>
						<Tab id="columns">Columns</Tab>
					</TabList>
					<TabPanel id="record" className="flex flex-col overflow-hidden">
						<RecordPanel
							dataset={dataset}
							rows={rows}
							ui={ui}
							onImportPhotos={onImportPhotos}
							onFocusRecord={(id) => {
								focusRecord(id);
								if (selectedIds.length <= 1) setSelection(new Set([id]));
							}}
						/>
					</TabPanel>
					<TabPanel id="columns" className="flex flex-col overflow-hidden">
						<ColumnsPanel
							dataset={dataset}
							selected={column}
							onSelect={onColumn}
							confirm={confirm}
						/>
					</TabPanel>
				</Tabs>
			</SidePanel>
		</>
	);
}

function DataStatusBar({
	dataset,
	shown,
	selected,
	ui,
}: {
	dataset: Dataset;
	shown: number;
	selected: number;
	ui: GridUiStore;
}) {
	const issues = useMemo(() => issueCount(dataset), [dataset]);
	const bytes = useMemo(() => photoBytes(dataset), [dataset]);
	const active = useGridUi(ui, (s) => s.active);
	const record = active
		? dataset.records.find((r) => r.id === active.row)
		: undefined;
	const activeIssue =
		record && active ? cellIssue(dataset, record, active.col) : undefined;
	const n = dataset.records.length;
	const photos = dataset.assets.length;
	return (
		<footer
			data-testid="data-status"
			className="flex h-6 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-fc-border border-t bg-fc-panel px-3 text-fc-muted text-fc-sm tabular-nums pointer-coarse:h-8"
		>
			<span className="min-w-0 truncate font-medium text-fc-text">
				{dataset.name}
			</span>
			<span data-testid="data-status-records">
				{shown !== n ? `${formatNumber(shown)} of ` : ""}
				{plural(n, "record")}
			</span>
			{selected ? (
				<span className="text-fc-text" data-testid="data-status-selected">
					{formatNumber(selected)} selected
				</span>
			) : null}
			<span className={issues ? "text-fc-danger-text" : undefined}>
				{plural(issues, "issue")}
			</span>
			<span>{plural(dataset.columns.length, "column")}</span>
			{photos ? (
				<span data-testid="data-status-photos">
					{plural(photos, "photo")}, {formatBytes(bytes)}
				</span>
			) : null}
			{activeIssue && active ? (
				<span className="min-w-0 truncate text-fc-danger-text">
					{active.col}: {activeIssue}
				</span>
			) : null}
		</footer>
	);
}

/** Whether the window is narrower than `px`, following resizes. */
function useBelow(px: number): boolean {
	const [below, setBelow] = useState(
		() => typeof window !== "undefined" && window.innerWidth < px,
	);
	useEffect(() => {
		if (!window.matchMedia) return;
		const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
		const on = () => setBelow(mq.matches);
		on();
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, [px]);
	return below;
}

function SidePanel({
	side,
	open,
	overlay,
	width,
	onClose,
	children,
}: {
	side: "left" | "right";
	open: boolean;
	overlay: boolean;
	width: number;
	onClose: () => void;
	children: ReactNode;
}) {
	// Escape closes a sheet before anything under it takes the key.
	useEffect(() => {
		if (!open || !overlay) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			const el = e.target as HTMLElement | null;
			if (
				el?.closest?.(
					"input,textarea,select,[role=dialog],[role=menu],[role=listbox]",
				)
			)
				return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open, overlay, onClose]);

	if (!open) return null;
	return (
		<>
			{overlay ? (
				<div
					aria-hidden="true"
					className="absolute inset-0 z-20 bg-fc-scrim"
					onPointerDown={onClose}
				/>
			) : null}
			<aside
				data-testid={`data-panel-${side}`}
				className={cn(
					"relative z-30 flex min-h-0 shrink-0 flex-col bg-fc-panel",
					side === "left"
						? "border-fc-border border-r"
						: "border-fc-border border-l",
					overlay &&
						cn(
							"absolute inset-y-0 max-w-[85vw] shadow-(--shadow-fc-sheet)",
							side === "left" ? "left-0" : "right-0",
						),
				)}
				style={{ width }}
			>
				{children}
			</aside>
		</>
	);
}
