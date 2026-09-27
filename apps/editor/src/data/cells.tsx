import { Button } from "@freshcoat-js/ui/button";
import { ColorInput } from "@freshcoat-js/ui/color";
import { inputBase } from "@freshcoat-js/ui/field";
import { formatShortcut } from "@freshcoat-js/ui/kbd";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Popover } from "@freshcoat-js/ui/popover";
import {
	assetRef,
	type Column,
	type DataRecord,
	type Dataset,
	isColor,
	parseAssetRef,
	type RecordStatus,
} from "@freshcoat-js/workspace";
import {
	type KeyboardEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { Dialog, Button as RACButton } from "react-aria-components";
import { STATUS_LABEL } from "~/app/copy";
import CheckIcon from "~icons/mingcute/check-line";
import ImportIcon from "~icons/mingcute/file-import-line";
import { AssetThumb } from "./AssetThumb";
import { useGrid } from "./grid-context";
import { useGridUi } from "./grid-state";
import { cellIssue, displayText, editText, NUMERIC_TYPES } from "./model";

export const STATUSES: { id: RecordStatus; label: string; tone: string }[] = [
	{
		id: "pending",
		label: STATUS_LABEL.pending,
		tone: "bg-fc-active text-fc-text",
	},
	{
		id: "exported",
		label: STATUS_LABEL.exported,
		tone: "bg-fc-success/20 text-fc-success-text",
	},
	{
		id: "failed",
		label: STATUS_LABEL.failed,
		tone: "bg-fc-danger/20 text-fc-danger-text",
	},
	{
		id: "skipped",
		label: STATUS_LABEL.skipped,
		tone: "bg-transparent text-fc-faint",
	},
];

const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

/** Types edited in place with a plain input; the rest open a popover or
 *  toggle. */
export function editsInline(column: Column): boolean {
	return !["boolean", "longText", "color", "image"].includes(column.type);
}

export function IndexCell({ id }: { id: string }) {
	const { indexOf } = useGrid();
	return (
		<span className="block w-full truncate text-right text-fc-faint tabular-nums">
			{indexOf(id) + 1}
		</span>
	);
}

/** The badge opens the grid's one status menu; a menu per row would cost
 *  every visible row a set of react-aria hooks. */
export function StatusCell({ id }: { id: string }) {
	const { openStatusMenu, recordById } = useGrid();
	const record = recordById.get(id);
	if (!record) return null;
	const status = STATUS_BY_ID.get(record.status) ?? STATUSES[0];
	if (!status) return null;
	return (
		<button
			type="button"
			aria-label={`Status: ${status.label}`}
			aria-haspopup="menu"
			title={record.error}
			data-testid="status-badge"
			className={cn(
				"inline-flex h-4 max-w-full cursor-default items-center rounded-full px-1.5 font-medium text-[10px] uppercase tracking-wide outline-none hover:brightness-125 focus-visible:outline-1 focus-visible:outline-fc-accent focus-visible:outline-solid pointer-coarse:h-5",
				status.tone,
				record.status === "skipped" && "border border-fc-border-strong",
			)}
			// The row would take these as a press that toggles its selection.
			onPointerDown={(e) => e.stopPropagation()}
			onMouseDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") e.stopPropagation();
			}}
			onClick={(e) => {
				e.stopPropagation();
				openStatusMenu(record.id, e.currentTarget);
			}}
		>
			<span className="truncate">{status.label}</span>
		</button>
	);
}

/** A data cell: its value, its editor while editing, and an issue mark. */
export function RecordCell({ id, column }: { id: string; column: Column }) {
	const grid = useGrid();
	const editing = useGridUi(grid.ui, (s) =>
		s.editing?.row === id && s.editing.col === column.key
			? (s.editing.seed ?? "")
			: null,
	);
	const selectAll = useGridUi(grid.ui, (s) => !!s.editing?.select);
	const anchor = useRef<HTMLDivElement>(null);
	const record = grid.recordById.get(id);
	if (!record) return null;
	const issue = cellIssue(grid.dataset, record, column.key);
	const value = record.values[column.key];
	const cell = { row: id, col: column.key };

	const toggle = () => grid.setValue(record.id, column.key, value !== true);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the grid cell takes the keyboard; this takes the pointer so a click focuses the cell instead of toggling the row
		// biome-ignore lint/a11y/useKeyWithClickEvents: the grid routes Enter, Space and F2 for the same actions
		<div
			ref={anchor}
			data-invalid={issue ? "" : undefined}
			title={issue}
			className={cn(
				"relative -mx-2 flex h-full min-w-0 flex-1 items-center gap-1.5 px-2",
				NUMERIC_TYPES.has(column.type) && "justify-end tabular-nums",
			)}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				if ((e.target as Element).closest("[data-cell-editor]")) {
					e.stopPropagation();
					return;
				}
				// Modified clicks go to the row, which extends or toggles selection.
				if (e.shiftKey || e.metaKey || e.ctrlKey) return;
				e.stopPropagation();
				const el = e.currentTarget.closest<HTMLElement>("[role=gridcell]");
				const wasActive = !!el && document.activeElement === el;
				el?.focus();
				// A second tap on a touch screen edits, as a double-click does.
				if (wasActive && e.pointerType !== "mouse" && editing === null) {
					if (column.type === "boolean") toggle();
					else grid.startEdit(cell);
				}
			}}
			onMouseDown={(e) => {
				if (e.shiftKey || e.metaKey || e.ctrlKey) return;
				e.stopPropagation();
				if (!(e.target as Element).closest("[data-cell-editor]"))
					e.preventDefault();
			}}
			onClick={(e) => {
				if (e.shiftKey || e.metaKey || e.ctrlKey) return;
				e.stopPropagation();
				if (
					column.type === "boolean" &&
					(e.target as Element).closest("[data-bool]")
				)
					toggle();
			}}
			onDoubleClick={(e) => {
				e.stopPropagation();
				if (editing !== null || column.type === "boolean") return;
				grid.startEdit(cell);
			}}
		>
			{editing !== null && editsInline(column) ? (
				<InlineEditor
					column={column}
					initial={editText(column, value)}
					seed={editing}
					selectAll={selectAll}
				/>
			) : (
				<CellValueView column={column} record={record} />
			)}
			{editing !== null && !editsInline(column) ? (
				<PopoverEditor column={column} record={record} anchor={anchor} />
			) : null}
			{issue ? (
				<span
					aria-hidden="true"
					data-testid="invalid-mark"
					className="pointer-events-none absolute top-0 right-0 size-0 border-t-[7px] border-t-fc-danger border-l-[7px] border-l-transparent"
				/>
			) : null}
			{issue ? <span className="sr-only">{issue}</span> : null}
		</div>
	);
}

function CellValueView({
	column,
	record,
}: {
	column: Column;
	record: DataRecord;
}) {
	const { assets } = useGrid();
	const value = record.values[column.key];
	switch (column.type) {
		case "boolean":
			return (
				<span
					data-bool=""
					role="img"
					aria-label={value === true ? "Yes" : "No"}
					className={cn(
						"flex size-3.5 shrink-0 items-center justify-center rounded-[2px] border pointer-coarse:size-[18px]",
						value === true
							? "border-fc-accent bg-fc-accent text-white"
							: "border-fc-border-strong bg-fc-raised",
						typeof value !== "boolean" &&
							value !== undefined &&
							value !== null &&
							"border-fc-danger",
					)}
				>
					{value === true ? <CheckIcon className="size-3" /> : null}
				</span>
			);
		case "color": {
			const text = typeof value === "string" ? value : "";
			if (!text) return null;
			return (
				<>
					<span
						className="size-3 shrink-0 rounded-[2px] shadow-[inset_0_0_0_1px_var(--color-fc-swatch-ring)]"
						style={isColor(text) ? { background: text } : undefined}
					/>
					<span className="min-w-0 truncate">{text}</span>
				</>
			);
		}
		case "image": {
			const sha = parseAssetRef(value);
			const asset = sha ? assets.get(sha) : undefined;
			if (value === null || value === undefined || value === "") return null;
			return (
				<>
					{asset ? (
						<AssetThumb
							asset={asset}
							className="size-4 shrink-0 rounded-[2px] bg-fc-raised object-cover pointer-coarse:size-6"
						/>
					) : null}
					<span className="min-w-0 truncate">
						{displayText(column, value, assets)}
					</span>
				</>
			);
		}
		case "longText": {
			const text = displayText(column, value);
			const first = text.split("\n", 1)[0] ?? "";
			return (
				<span className="min-w-0 truncate">
					{first}
					{first.length < text.length ? " …" : ""}
				</span>
			);
		}
		default:
			return (
				<span className="min-w-0 truncate">
					{displayText(column, value, assets)}
				</span>
			);
	}
}

const stopKeys = (e: KeyboardEvent) => e.stopPropagation();

/** The on-screen keyboard a column's text editor asks for. */
export function inputModeFor(
	column: Column,
): "numeric" | "decimal" | "email" | "url" | undefined {
	return column.type === "integer"
		? "numeric"
		: column.type === "number"
			? "decimal"
			: column.type === "email"
				? "email"
				: column.type === "url"
					? "url"
					: undefined;
}

function InlineEditor({
	column,
	initial,
	seed,
	selectAll,
}: {
	column: Column;
	initial: string;
	seed: string;
	selectAll: boolean;
}) {
	const grid = useGrid();
	const ref = useRef<HTMLInputElement>(null);
	const [text, setText] = useState(() => (seed ? seed : initial));
	const date = column.type === "date";

	useEffect(() => {
		grid.draft.current = seed ? seed : initial;
		const el = ref.current;
		if (!el) return;
		el.focus();
		if (selectAll) el.select();
		else if (!date) el.setSelectionRange(el.value.length, el.value.length);
	}, [grid, seed, initial, date, selectAll]);

	return (
		<input
			ref={ref}
			data-cell-editor=""
			aria-label={`Edit ${column.title ?? column.key}`}
			type={date ? "date" : "text"}
			inputMode={inputModeFor(column)}
			spellCheck={false}
			autoComplete="off"
			value={text}
			onChange={(e) => {
				setText(e.target.value);
				grid.draft.current = e.target.value;
			}}
			onBlur={() => grid.finishEdit("commit")}
			className={cn(
				inputBase,
				"-mx-1.5 h-[calc(100%-2px)] border-fc-accent px-1.5 py-0 data-hovered:border-fc-accent [color-scheme:dark]",
				NUMERIC_TYPES.has(column.type) && "text-right",
			)}
		/>
	);
}

/** longText, colour and image edit in a popover anchored to the cell. */
function PopoverEditor({
	column,
	record,
	anchor,
}: {
	column: Column;
	record: DataRecord;
	anchor: RefObject<HTMLDivElement | null>;
}) {
	const grid = useGrid();
	const value = record.values[column.key];
	const cancelled = useRef(false);
	const [text, setText] = useState(() => {
		const start = editText(column, value);
		grid.draft.current = start;
		return start;
	});

	const close = (how: "commit" | "cancel") => {
		cancelled.current = how === "cancel";
		grid.finishEdit(how);
	};

	return (
		<Popover
			triggerRef={anchor}
			isOpen
			placement="bottom start"
			onOpenChange={(open) => {
				if (!open) close(cancelled.current ? "cancel" : "commit");
			}}
			className={column.type === "longText" ? "w-80" : "w-64"}
		>
			<Dialog
				aria-label={`Edit ${column.title ?? column.key}`}
				data-cell-editor=""
				className="flex flex-col gap-2 p-2 outline-none"
			>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: keys inside the editor stay out of the grid and the app shortcuts */}
				<div
					className="flex flex-col gap-2"
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							close("cancel");
						} else if (
							e.key === "Enter" &&
							(e.metaKey || e.ctrlKey || column.type !== "longText")
						) {
							e.preventDefault();
							close("commit");
						}
						stopKeys(e);
					}}
				>
					{column.type === "longText" ? (
						<>
							<textarea
								autoFocus
								aria-label={column.title ?? column.key}
								rows={6}
								value={text}
								onChange={(e) => {
									setText(e.target.value);
									grid.draft.current = e.target.value;
								}}
								className={cn(inputBase, "block resize-y py-1 leading-normal")}
							/>
							<div className="flex items-center justify-end gap-2">
								<span className="mr-auto text-fc-faint text-fc-sm">
									{formatShortcut("Mod+Enter")} to save
								</span>
								<Button variant="ghost" onPress={() => close("cancel")}>
									Cancel
								</Button>
								<Button variant="primary" onPress={() => close("commit")}>
									Save
								</Button>
							</div>
						</>
					) : column.type === "color" ? (
						<ColorEditor
							initial={text}
							onChange={(next) => {
								setText(next);
								grid.draft.current = next;
							}}
							onDone={() => close("commit")}
						/>
					) : (
						<ImagePicker
							dataset={grid.dataset}
							importPhotos={grid.importPhotos}
							value={typeof value === "string" ? value : ""}
							onPick={(next) => {
								grid.draft.current = next;
								close("commit");
							}}
						/>
					)}
				</div>
			</Dialog>
		</Popover>
	);
}

function ColorEditor({
	initial,
	onChange,
	onDone,
}: {
	initial: string;
	onChange: (value: string) => void;
	onDone: () => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<>
			<ColorInput
				aria-label="Color"
				value={value}
				onChange={(next) => {
					setValue(next);
					onChange(next);
				}}
			/>
			<div className="flex items-center justify-end gap-2">
				<Button
					variant="ghost"
					onPress={() => {
						setValue("");
						onChange("");
						onDone();
					}}
				>
					Clear
				</Button>
				<Button variant="primary" onPress={onDone}>
					Done
				</Button>
			</div>
		</>
	);
}

/** The dataset's photos to choose one from, as a cell or a form field
 *  edits an image column. */
export function ImagePicker({
	dataset,
	importPhotos,
	value,
	onPick,
}: {
	dataset: Pick<Dataset, "assets">;
	importPhotos: () => void;
	value: string;
	onPick: (value: string) => void;
}) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const assets = dataset.assets.filter(
		(a) => !q || a.name.toLowerCase().includes(q),
	);
	const current = parseAssetRef(value);
	return (
		<>
			{dataset.assets.length > 8 ? (
				<input
					aria-label="Filter photos"
					placeholder="Filter photos"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className={cn(inputBase, "h-fc-control")}
				/>
			) : null}
			{dataset.assets.length === 0 ? (
				<p className="px-1 text-fc-muted text-fc-sm">No photos</p>
			) : (
				<div className="grid max-h-60 grid-cols-4 gap-1 overflow-auto">
					{assets.map((a) => (
						<RACButton
							key={a.sha256}
							aria-label={a.name}
							onPress={() => onPick(assetRef(a.sha256))}
							className={cn(
								"flex min-w-0 flex-col items-center gap-0.5 rounded-[3px] p-1 outline-none data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid data-hovered:bg-fc-hover",
								current === a.sha256 && "bg-fc-accent-soft",
							)}
						>
							<AssetThumb
								asset={a}
								className="size-12 rounded-[2px] bg-fc-panel object-cover"
							/>
							<span className="w-full truncate text-center text-[10px] text-fc-muted">
								{a.name}
							</span>
						</RACButton>
					))}
				</div>
			)}
			<div className="flex items-center justify-end gap-2">
				<Button
					variant="ghost"
					onPress={() => {
						onPick(value);
						importPhotos();
					}}
				>
					<ImportIcon />
					Import photos…
				</Button>
				<Button variant="ghost" onPress={() => onPick("")}>
					Clear
				</Button>
			</div>
		</>
	);
}
