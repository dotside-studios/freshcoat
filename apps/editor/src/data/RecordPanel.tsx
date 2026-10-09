import { formatImageFocus, type Template } from "@freshcoat-js/coatfile";
import { Button } from "@freshcoat-js/ui/button";
import { Checkbox } from "@freshcoat-js/ui/checkbox";
import { ColorInput } from "@freshcoat-js/ui/color";
import { inputBase } from "@freshcoat-js/ui/field";
import { IconButton } from "@freshcoat-js/ui/icon-button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Menu, MenuItem } from "@freshcoat-js/ui/menu";
import { Popover } from "@freshcoat-js/ui/popover";
import {
	type Binding,
	type CellValue,
	type Column,
	type DataRecord,
	type Dataset,
	type DatasetAsset,
	orientedSize,
	parseAssetRef,
	type RecordStatus,
} from "@freshcoat-js/workspace";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useMemo,
	useRef,
	useState,
} from "react";
import { Dialog, DialogTrigger, MenuTrigger } from "react-aria-components";
import { useController } from "~/app/context";
import { formatBytes, formatNumber } from "~/app/format";
import { useEditor } from "~/state/hooks";
import DownIcon from "~icons/mingcute/down-line";
import LeftIcon from "~icons/mingcute/left-line";
import PhotoIcon from "~icons/mingcute/pic-line";
import RightIcon from "~icons/mingcute/right-line";
import { editDataset } from "./actions";
import { ImagePicker, inputModeFor, STATUSES } from "./cells";
import { type GridUiStore, useGridUi } from "./grid-state";
import {
	assetMap,
	cellIssue,
	displayText,
	editText,
	NUMERIC_TYPES,
	setCell,
	valueFromText,
} from "./model";
import {
	cellFocus,
	movedFocus,
	type PhotoFraming,
	photoFraming,
	visibleCrop,
} from "./photo-framing";
import { mayBeTransparent } from "./RecordsGallery";
import { useThumbnail } from "./thumbnails";

const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

/** The template whose framing the record view shows: the open one when it is
 *  bound to `datasetId`, else the first that is. */
function useFramingTemplate(
	datasetId: string,
): { template: Template; binding: Binding } | undefined {
	const ws = useEditor((s) => s.workspace);
	const live = useEditor((s) => s.doc?.history.present);
	return useMemo(() => {
		const bound = ws?.templates.filter(
			(t) => t.binding?.datasetId === datasetId,
		);
		const slot =
			bound?.find((t) => t.id === ws?.activeTemplateId) ?? bound?.[0];
		if (!slot?.binding) return undefined;
		const template =
			slot.id === ws?.activeTemplateId && live
				? live
				: (slot.parked?.doc.history.present ?? slot.template);
		return { template, binding: slot.binding };
	}, [ws, live, datasetId]);
}

/**
 * The focused record: a large view of each of its photos, then a form of
 * every field with the editors the grid uses. Arrows step through the
 * records in the order they are shown.
 */
export function RecordPanel({
	dataset,
	rows,
	ui,
	onImportPhotos,
	onFocusRecord,
}: {
	dataset: Dataset;
	rows: readonly DataRecord[];
	ui: GridUiStore;
	onImportPhotos: () => void;
	/** Moves the focus to another record, as the arrows do. */
	onFocusRecord: (id: string) => void;
}) {
	const activeId = useGridUi(ui, (s) => s.active?.row ?? null);
	const record = activeId
		? dataset.records.find((r) => r.id === activeId)
		: undefined;
	const at = record ? rows.findIndex((r) => r.id === record.id) : -1;
	const assets = useMemo(() => assetMap(dataset.assets), [dataset.assets]);
	const controller = useController();
	const framing = useFramingTemplate(dataset.id);

	if (!record) {
		return (
			<div
				className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
				data-testid="record-panel"
			>
				<PhotoIcon className="size-7 text-fc-faint" />
				<p className="max-w-52 text-fc-muted">No record selected</p>
			</div>
		);
	}

	const step = (by: -1 | 1) => {
		const next = rows[at + by];
		if (next) onFocusRecord(next.id);
	};
	const images = dataset.columns.filter((c) => c.type === "image");
	const index = dataset.records.indexOf(record) + 1;

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			data-testid="record-panel"
			data-record={record.id}
		>
			<div className="flex h-8 shrink-0 items-center gap-1 border-fc-border border-b pr-1 pl-2.5 pointer-coarse:h-10">
				<span className="min-w-0 flex-1 truncate text-fc-muted tabular-nums">
					<span className="font-medium text-fc-text">Record {index}</span>
					{at < 0 ? (
						<span className="text-fc-faint"> · filtered out</span>
					) : at + 1 === index && rows.length === dataset.records.length ? (
						<span className="text-fc-faint">
							{" "}
							of {formatNumber(rows.length)}
						</span>
					) : (
						<span className="text-fc-faint">
							{" "}
							· {formatNumber(at + 1)} of {formatNumber(rows.length)} shown
						</span>
					)}
				</span>
				<StatusMenu dataset={dataset} record={record} />
				<IconButton
					aria-label="Previous record"
					tooltip="Previous record"
					isDisabled={at <= 0}
					onPress={() => step(-1)}
					className="size-6 pointer-coarse:size-8"
				>
					<LeftIcon />
				</IconButton>
				<IconButton
					aria-label="Next record"
					tooltip="Next record"
					isDisabled={at < 0 || at >= rows.length - 1}
					onPress={() => step(1)}
					className="size-6 pointer-coarse:size-8"
				>
					<RightIcon />
				</IconButton>
			</div>
			{record.status === "failed" && record.error ? (
				<div
					className="flex shrink-0 items-start gap-2 border-fc-border border-b py-2 pr-1 pl-2.5"
					data-testid="record-error"
				>
					<p className="m-0 min-w-0 flex-1 break-words pt-0.5 text-fc-danger-text text-fc-sm">
						{record.error}
					</p>
					<Button
						variant="ghost"
						size="sm"
						onPress={() => {
							controller.dispatch({ type: "setRecord", id: record.id });
							controller.dispatch({ type: "setSection", section: "export" });
						}}
					>
						Show in Export
					</Button>
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto">
				{images.length ? (
					<div className="flex flex-col gap-3 border-fc-border border-b p-2.5">
						{images.map((c) => {
							const frame = framing
								? photoFraming(
										framing.template,
										framing.binding,
										dataset,
										record,
										c.key,
									)
								: undefined;
							return (
								<RecordPhoto
									key={c.key}
									column={c}
									value={record.values[c.key]}
									assets={assets}
									showLabel={images.length > 1}
									framing={
										frame && {
											...frame,
											focus: record.values[frame.focusColumn],
											onFocus: (text) =>
												editDataset(
													controller,
													dataset.id,
													(d) => setCell(d, record.id, frame.focusColumn, text),
													`cell:${dataset.id}:${record.id}:${frame.focusColumn}`,
												),
										}
									}
								/>
							);
						})}
					</div>
				) : null}
				<div
					className="grid grid-cols-[minmax(72px,34%)_1fr] items-start gap-x-2 gap-y-1.5 p-2.5"
					data-testid="record-fields"
				>
					{dataset.columns.map((c) => (
						<Field
							key={`${record.id}:${c.key}`}
							dataset={dataset}
							record={record}
							column={c}
							onImportPhotos={onImportPhotos}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function StatusMenu({
	dataset,
	record,
}: {
	dataset: Dataset;
	record: DataRecord;
}) {
	const controller = useController();
	const status = STATUS_BY_ID.get(record.status) ?? STATUSES[0];
	return (
		<MenuTrigger>
			<Button
				variant="ghost"
				size="sm"
				aria-label={`Status: ${status?.label}`}
				data-testid="record-status"
				className="px-1"
			>
				<span
					className={cn(
						"inline-flex h-4 items-center rounded-full px-1.5 font-medium text-[10px] uppercase tracking-wide",
						status?.tone,
						record.status === "skipped" && "border border-fc-border-strong",
					)}
				>
					{status?.label}
				</span>
				<DownIcon className="size-3! opacity-60" />
			</Button>
			<Popover placement="bottom end">
				<Menu
					aria-label="Set status"
					selectionMode="single"
					selectedKeys={[record.status]}
					onAction={(key) =>
						controller.dispatch({
							type: "setRecordStatus",
							datasetId: dataset.id,
							ids: [record.id],
							status: key as RecordStatus,
						})
					}
				>
					{STATUSES.map((s) => (
						<MenuItem key={s.id} id={s.id}>
							{s.label}
						</MenuItem>
					))}
				</Menu>
			</Popover>
		</MenuTrigger>
	);
}

/** One image field, large, with what the photo is. */
type Framing = PhotoFraming & {
	focus: CellValue | undefined;
	onFocus: (text: string) => void;
};

function RecordPhoto({
	column,
	value,
	assets,
	showLabel,
	framing,
}: {
	column: Column;
	value: CellValue | undefined;
	assets: ReadonlyMap<string, DatasetAsset>;
	showLabel: boolean;
	framing?: Framing;
}) {
	const sha = parseAssetRef(value);
	const asset = sha ? assets.get(sha) : undefined;
	const url = useThumbnail(asset, 640);
	const seen =
		asset?.width !== undefined && asset.height !== undefined
			? orientedSize({
					width: asset.width,
					height: asset.height,
					orientation: asset.orientation,
				})
			: undefined;
	return (
		<figure className="flex flex-col gap-1.5" data-testid="record-photo">
			<div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[3px] bg-fc-app p-2 shadow-[inset_0_0_0_1px_var(--color-fc-border)]">
				{asset ? (
					<span
						className={cn(
							"relative block max-h-full max-w-full overflow-hidden",
							!url && "bg-fc-hover",
						)}
						style={
							!url && seen
								? {
										aspectRatio: `${seen.width} / ${seen.height}`,
										[seen.width >= seen.height ? "width" : "height"]: "100%",
									}
								: undefined
						}
					>
						{url ? (
							<img
								src={url}
								alt={asset.name}
								draggable={false}
								className={cn(
									"block max-h-full max-w-full",
									mayBeTransparent(asset) && "fc-checkerboard",
								)}
							/>
						) : null}
						{framing && seen ? (
							<FramingOverlay
								framing={framing}
								photoAspect={seen.width / seen.height}
							/>
						) : null}
					</span>
				) : (
					<span className="flex flex-col items-center gap-1 text-fc-faint text-fc-sm">
						<PhotoIcon className="size-7" />
						{value ? `No photo named ${String(value)}` : "No photo"}
					</span>
				)}
			</div>
			{asset ? (
				<figcaption className="flex min-w-0 flex-col gap-px">
					<span className="flex min-w-0 items-baseline gap-1.5">
						{showLabel ? (
							<span className="shrink-0 font-fc-mono text-[11px] text-fc-muted">
								{column.key}
							</span>
						) : null}
						<span className="min-w-0 truncate text-fc-text" title={asset.name}>
							{asset.name}
						</span>
					</span>
					<span
						className="text-fc-faint text-fc-sm tabular-nums"
						data-testid="record-photo-info"
					>
						{[
							seen ? `${seen.width} × ${seen.height}` : null,
							formatBytes(asset.size),
							asset.contentType.replace(/^image\//, "").toUpperCase(),
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</figcaption>
			) : null}
		</figure>
	);
}

const NUDGE = 0.01;

/** The part of the photo the template shows, dragged or nudged with the
 *  arrow keys to move the photo in its box. Commits when the drag ends. */
function FramingOverlay({
	framing,
	photoAspect,
}: {
	framing: Framing;
	photoAspect: number;
}) {
	const saved = cellFocus(framing.focus);
	const [draft, setDraft] = useState<typeof saved | null>(null);
	const drag = useRef<{ x: number; y: number; w: number; h: number } | null>(
		null,
	);
	const focus = draft ?? saved;
	const crop = visibleCrop(photoAspect, framing.aspect, focus);
	const commit = (next: typeof saved) =>
		framing.onFocus(formatImageFocus(next));
	const moved = (e: PointerEvent) => {
		const d = drag.current;
		if (!d) return saved;
		return movedFocus(
			visibleCrop(photoAspect, framing.aspect, saved),
			saved,
			(e.clientX - d.x) / d.w,
			(e.clientY - d.y) / d.h,
		);
	};
	const pct = (n: number) => `${n * 100}%`;
	return (
		<span
			role="slider"
			tabIndex={0}
			aria-label="Photo framing"
			aria-valuetext={`${Math.round(focus.x * 100)}%, ${Math.round(focus.y * 100)}%`}
			aria-valuenow={Math.round(focus.x * 100)}
			data-testid="photo-framing"
			className="absolute cursor-grab touch-none shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] outline-1 outline-white outline-solid focus-visible:outline-2 focus-visible:outline-fc-accent active:cursor-grabbing"
			style={{
				left: pct(crop.x),
				top: pct(crop.y),
				width: pct(crop.width),
				height: pct(crop.height),
			}}
			onPointerDown={(e) => {
				const box = e.currentTarget.parentElement?.getBoundingClientRect();
				if (!box?.width || !box.height) return;
				e.currentTarget.setPointerCapture(e.pointerId);
				drag.current = {
					x: e.clientX,
					y: e.clientY,
					w: box.width,
					h: box.height,
				};
				setDraft(saved);
			}}
			onPointerMove={(e) => {
				if (drag.current) setDraft(moved(e));
			}}
			onPointerUp={(e) => {
				if (!drag.current) return;
				const next = moved(e);
				drag.current = null;
				setDraft(null);
				commit(next);
			}}
			onPointerCancel={() => {
				drag.current = null;
				setDraft(null);
			}}
			onKeyDown={(e: KeyboardEvent) => {
				const by: Record<string, [number, number]> = {
					ArrowLeft: [-NUDGE, 0],
					ArrowRight: [NUDGE, 0],
					ArrowUp: [0, -NUDGE],
					ArrowDown: [0, NUDGE],
				};
				const step = by[e.key];
				if (!step) return;
				e.preventDefault();
				commit(movedFocus(crop, focus, step[0], step[1]));
			}}
		/>
	);
}

function Field({
	dataset,
	record,
	column,
	onImportPhotos,
}: {
	dataset: Dataset;
	record: DataRecord;
	column: Column;
	onImportPhotos: () => void;
}) {
	const controller = useController();
	const value = record.values[column.key];
	const issue = cellIssue(dataset, record, column.key);
	const id = `field-${record.id}-${column.key}`;
	const set = (next: CellValue) =>
		editDataset(
			controller,
			dataset.id,
			(d) => setCell(d, record.id, column.key, next),
			`cell:${dataset.id}:${record.id}:${column.key}`,
		);
	const label = column.title ?? column.key;

	let editor: ReactNode;
	switch (column.type) {
		case "boolean":
			editor = (
				<Checkbox
					aria-label={label}
					isSelected={value === true}
					isInvalid={!!issue}
					onChange={(on) => set(on)}
					className="h-fc-control"
				/>
			);
			break;
		case "color":
			editor = (
				<ColorInput
					aria-label={label}
					value={typeof value === "string" ? value : ""}
					onChange={(next) => set(next === "" ? null : next)}
				/>
			);
			break;
		case "image":
			editor = (
				<ImageField
					dataset={dataset}
					column={column}
					value={value}
					onPick={(text) =>
						set(
							text === "" ? null : valueFromText(column, text, dataset.assets),
						)
					}
					onImportPhotos={onImportPhotos}
				/>
			);
			break;
		default:
			editor = (
				<TextValue
					id={id}
					column={column}
					value={value}
					invalid={!!issue}
					onCommit={(text) =>
						set(
							text === "" ? null : valueFromText(column, text, dataset.assets),
						)
					}
				/>
			);
	}

	return (
		<>
			<label
				htmlFor={id}
				className="flex h-fc-control min-w-0 items-center gap-0.5 font-fc-mono text-[11px] text-fc-muted"
				title={column.title ? `${column.title} (${column.key})` : column.key}
			>
				<span className="truncate">{column.key}</span>
				{column.required ? (
					<span className="text-fc-danger" aria-hidden="true">
						*
					</span>
				) : null}
			</label>
			<div className="flex min-w-0 flex-col gap-0.5" data-field={column.key}>
				{editor}
				{issue ? (
					<span
						className="text-fc-danger-text text-fc-sm"
						data-testid="field-issue"
					>
						{issue}
					</span>
				) : null}
			</div>
		</>
	);
}

/** A text box that commits on Enter or blur, as a grid cell does. */
function TextValue({
	id,
	column,
	value,
	invalid,
	onCommit,
}: {
	id: string;
	column: Column;
	value: CellValue | undefined;
	invalid: boolean;
	onCommit: (text: string) => void;
}) {
	const initial = editText(column, value);
	const [draft, setDraft] = useState<string | null>(null);
	const cancelled = useRef(false);
	const long = column.type === "longText";
	const commit = () => {
		if (draft !== null && draft !== initial) onCommit(draft);
		setDraft(null);
	};
	const shared = {
		id,
		value: draft ?? initial,
		"aria-invalid": invalid || undefined,
		spellCheck: long,
		autoComplete: "off",
		onFocus: () => {
			cancelled.current = false;
		},
		onBlur: () => {
			if (!cancelled.current) commit();
		},
		className: cn(
			inputBase,
			"hover:border-fc-border-strong focus:border-fc-accent aria-invalid:border-fc-danger/70",
			NUMERIC_TYPES.has(column.type) && "text-right tabular-nums",
		),
	};
	if (long)
		return (
			<textarea
				{...shared}
				rows={3}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						cancelled.current = true;
						setDraft(null);
						e.currentTarget.blur();
					} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						commit();
					}
				}}
				className={cn(shared.className, "block resize-y py-1 leading-normal")}
			/>
		);
	return (
		<input
			{...shared}
			type={column.type === "date" ? "date" : "text"}
			inputMode={inputModeFor(column)}
			onChange={(e) => setDraft(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					commit();
				} else if (e.key === "Escape") {
					cancelled.current = true;
					setDraft(null);
					e.currentTarget.blur();
				}
			}}
			className={cn(shared.className, "h-fc-control")}
		/>
	);
}

function ImageField({
	dataset,
	column,
	value,
	onPick,
	onImportPhotos,
}: {
	dataset: Dataset;
	column: Column;
	value: CellValue | undefined;
	onPick: (text: string) => void;
	onImportPhotos: () => void;
}) {
	const [open, setOpen] = useState(false);
	const assets = useMemo(() => assetMap(dataset.assets), [dataset.assets]);
	const text = displayText(column, value, assets);
	return (
		<DialogTrigger isOpen={open} onOpenChange={setOpen}>
			<Button
				variant="default"
				aria-label={`Choose ${column.title ?? column.key}`}
				className="w-full min-w-0 justify-start font-normal"
			>
				<PhotoIcon className="text-fc-muted" />
				<span className={cn("min-w-0 truncate", !text && "text-fc-faint")}>
					{text || "Choose a photo…"}
				</span>
			</Button>
			<Popover placement="bottom end" className="w-72">
				<Dialog
					aria-label={`Choose ${column.title ?? column.key}`}
					className="flex flex-col gap-2 p-2 outline-none"
				>
					<ImagePicker
						dataset={dataset}
						importPhotos={onImportPhotos}
						value={typeof value === "string" ? value : ""}
						onPick={(next) => {
							setOpen(false);
							onPick(next);
						}}
					/>
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}
