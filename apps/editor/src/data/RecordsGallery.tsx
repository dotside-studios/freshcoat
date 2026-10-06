import { cn } from "@freshcoat-js/ui/lib/cn";
import {
	type Column,
	type DataRecord,
	type Dataset,
	type DatasetAsset,
	orientedSize,
	parseAssetRef,
} from "@freshcoat-js/workspace";
import {
	createContext,
	type KeyboardEvent,
	memo,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	GridLayout,
	GridList,
	GridListItem,
	type Selection,
	Size,
	Virtualizer,
} from "react-aria-components";
import { plural } from "~/app/copy";
import PhotoIcon from "~icons/mingcute/pic-line";
import { STATUSES } from "./cells";
import {
	CARD_SIZES,
	type CardSize,
	cardLayout,
	imageColumn,
	thumbWidthFor,
	titleColumn,
} from "./gallery-model";
import type { GridUiStore } from "./grid-state";
import {
	assetMap,
	displayText,
	recordByIdMap,
	recordIndexMap,
	recordIssues,
} from "./model";
import { useRowItems } from "./RecordsGrid";
import { type ThumbWidth, useThumbnail } from "./thumbnails";

export type RecordsGalleryProps = {
	dataset: Dataset;
	rows: readonly DataRecord[];
	selection: Selection;
	onSelectionChange: (selection: Selection) => void;
	selectedIds: readonly string[];
	ui: GridUiStore;
	size: CardSize;
	/** Tablet portrait and below: a fixed number of columns. */
	narrow: boolean;
	/** Enter or a double-click on a card. */
	onOpen: (recordId: string) => void;
	onDeleteRows: (ids: string[]) => void;
	emptyState: ReactNode;
};

type CardContextValue = {
	dataset: Dataset;
	recordById: ReadonlyMap<string, DataRecord>;
	indexOf: (id: string) => number;
	assets: ReadonlyMap<string, DatasetAsset>;
	image: Column | undefined;
	title: Column | undefined;
	size: CardSize;
	thumbWidth: ThumbWidth;
};

const CardContext = createContext<CardContextValue | null>(null);

const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

/**
 * Records as cards of their first photo, in a virtualised grid. Selection is
 * the table's: the same keys, changed by click, Shift-click, Mod-click and
 * Mod+A, so switching views keeps it.
 */
export const RecordsGallery = memo(function RecordsGallery({
	dataset,
	rows,
	selection,
	onSelectionChange,
	selectedIds,
	ui,
	size,
	narrow,
	onOpen,
	onDeleteRows,
	emptyState,
}: RecordsGalleryProps) {
	const items = useRowItems(rows);
	const wrapper = useRef<HTMLDivElement>(null);
	// A narrow window divides the grid's own width between a fixed number
	// of columns, so the grid is measured.
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = wrapper.current;
		if (!el || !narrow || typeof ResizeObserver === "undefined") return;
		const measure = () =>
			setWidth(
				el.querySelector<HTMLElement>("[role=grid]")?.clientWidth ??
					el.clientWidth,
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [narrow]);
	const layout = useMemo(() => {
		const l = cardLayout(size, narrow, width);
		return {
			minItemSize: new Size(l.minItemSize.width, l.minItemSize.height),
			maxItemSize: new Size(l.maxItemSize.width, l.maxItemSize.height),
			maxColumns: l.maxColumns,
			minSpace: new Size(l.gap, l.gap),
			maxHorizontalSpace: l.gap,
			preserveAspectRatio: true,
		};
	}, [size, narrow, width]);

	const ctx = useMemo<CardContextValue>(() => {
		const indexMap = recordIndexMap(dataset.records);
		const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
		// The well is the card less its padding, at the widest a card grows.
		const well = layout.maxItemSize.width - 24;
		return {
			dataset,
			recordById: recordByIdMap(dataset.records),
			indexOf: (id) => indexMap.get(id) ?? -1,
			assets: assetMap(dataset.assets),
			image: imageColumn(dataset.columns),
			title: titleColumn(dataset.columns),
			size,
			thumbWidth: thumbWidthFor(well, dpr || 1),
		};
	}, [dataset, size, layout]);

	const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
		const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
		if ((e.key === "Delete" || e.key === "Backspace") && plain) {
			if (selectedIds.length === 0) return;
			e.preventDefault();
			e.stopPropagation();
			onDeleteRows([...selectedIds]);
		}
	};

	const onFocusCapture = (e: React.FocusEvent<HTMLDivElement>) => {
		const row = (e.target as HTMLElement).closest?.<HTMLElement>("[data-row]")
			?.dataset.row;
		if (!row) return;
		const col = ui.get().active?.col ?? dataset.columns[0]?.key ?? "";
		ui.set({ active: { row, col } });
	};

	return (
		<CardContext.Provider value={ctx}>
			<div
				ref={wrapper}
				data-testid="records-gallery"
				data-card-size={size}
				className="relative flex min-h-0 flex-1 flex-col bg-fc-app"
				onKeyDownCapture={onKeyDownCapture}
				onFocusCapture={onFocusCapture}
			>
				<Virtualizer layout={GridLayout} layoutOptions={layout}>
					<GridList
						aria-label={`Records of ${dataset.name}`}
						layout="grid"
						items={items}
						selectionMode="multiple"
						selectionBehavior="replace"
						selectedKeys={selection}
						onSelectionChange={onSelectionChange}
						onAction={(key) => onOpen(String(key))}
						renderEmptyState={() => (
							<div className="px-3 py-10 text-center text-fc-faint text-fc-sm">
								{emptyState}
							</div>
						)}
						// A composited scroller: scrolling moves a layer instead of
						// repainting every card on the page each frame.
						className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-fc-app outline-none will-change-scroll [scrollbar-gutter:stable]"
					>
						{(item) => (
							<GridListItem
								id={item.id}
								textValue={item.id}
								data-row={item.id}
								className={cn(
									"group flex h-full cursor-default select-none flex-col rounded-[5px] p-1 outline-none",
									"data-hovered:bg-fc-hover data-selected:bg-fc-accent-soft",
									"data-focus-visible:outline-2 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid data-focus-visible:outline-offset-1",
								)}
							>
								<Card id={item.id} />
							</GridListItem>
						)}
					</GridList>
				</Virtualizer>
			</div>
		</CardContext.Provider>
	);
});

const Card = memo(function Card({ id }: { id: string }) {
	const ctx = useContext(CardContext);
	if (!ctx) throw new Error("Card outside <RecordsGallery>");
	const record = ctx.recordById.get(id);
	if (!record) return null;
	const { dataset, image, title, assets, size } = ctx;
	const sha = image ? parseAssetRef(record.values[image.key]) : null;
	const asset = sha ? assets.get(sha) : undefined;
	const heading = title ? displayText(title, record.values[title.key]) : "";
	const index = ctx.indexOf(id) + 1;
	const issues = recordIssues(dataset, record).length;
	const status = STATUS_BY_ID.get(record.status) ?? STATUSES[0];
	const seen =
		asset?.width !== undefined && asset.height !== undefined
			? orientedSize({
					width: asset.width,
					height: asset.height,
					orientation: asset.orientation,
				})
			: undefined;
	const small = size === "s";

	return (
		<>
			<div
				className={cn(
					"relative min-h-0 flex-1 rounded-[3px] bg-fc-panel",
					"shadow-[inset_0_0_0_1px_var(--color-fc-border)] group-data-selected:shadow-[inset_0_0_0_2px_var(--color-fc-accent)]",
				)}
			>
				<div
					className={cn(
						"absolute flex items-center justify-center",
						small ? "inset-1.5" : "inset-2",
					)}
				>
					{asset ? (
						<CardPhoto asset={asset} seen={seen} width={ctx.thumbWidth} />
					) : (
						<span
							className="flex flex-col items-center gap-1 text-fc-faint"
							title={
								image
									? record.values[image.key]
										? `No photo named ${String(record.values[image.key])}`
										: `No ${image.key}`
									: "No image column"
							}
						>
							<PhotoIcon className={small ? "size-5" : "size-7"} />
							{small ? null : (
								<span className="text-fc-xs">
									{image ? "No photo" : "No image column"}
								</span>
							)}
						</span>
					)}
				</div>
				{issues ? (
					<span
						data-testid="card-issues"
						title={plural(issues, "issue")}
						className="absolute top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-fc-danger px-1 font-semibold text-[10px] text-white tabular-nums shadow-(--shadow-fc-control)"
					>
						{issues}
					</span>
				) : null}
			</div>
			<div
				className="flex shrink-0 flex-col justify-center gap-px px-0.5"
				style={{ height: CARD_SIZES[size].caption }}
			>
				<div className="flex min-w-0 items-center gap-1.5">
					{small ? <StatusDot status={record.status} named /> : null}
					<span
						className={cn(
							"min-w-0 flex-1 truncate",
							small ? "text-fc-sm" : "text-fc-base",
							heading ? "text-fc-text" : "text-fc-faint",
						)}
						data-testid="card-title"
					>
						{heading || `Record ${index}`}
					</span>
				</div>
				{small ? null : (
					<div className="flex min-w-0 items-center gap-1.5 text-fc-faint text-fc-sm tabular-nums">
						<span
							data-testid="card-status"
							className={cn(
								"inline-flex shrink-0 items-center gap-1",
								record.status === "exported" && "text-fc-success-text",
								record.status === "failed" && "text-fc-danger-text",
								record.status === "pending" && "text-fc-muted",
							)}
						>
							<StatusDot status={record.status} />
							{status?.label}
						</span>
						<span className="min-w-0 flex-1 truncate text-right">
							{seen ? `${seen.width} × ${seen.height}` : `#${index}`}
						</span>
					</div>
				)}
			</div>
		</>
	);
});

/** A status as a dot, named for assistive tech when no label is beside it. */
function StatusDot({
	status,
	named,
}: {
	status: DataRecord["status"];
	named?: boolean;
}) {
	const label = STATUS_BY_ID.get(status)?.label;
	return (
		<span
			{...(named
				? { role: "img", "aria-label": label, title: label }
				: { "aria-hidden": true })}
			className={cn(
				"size-1.5 shrink-0 rounded-full",
				status === "exported"
					? "bg-fc-success"
					: status === "failed"
						? "bg-fc-danger"
						: status === "skipped"
							? "border border-fc-faint"
							: "bg-fc-faint",
			)}
		/>
	);
}

/** Whether a photo can have transparent pixels to show a checkerboard
 *  through. A JPEG cannot, and painting one under it costs every frame. */
export function mayBeTransparent(asset: Pick<DatasetAsset, "contentType">) {
	return asset.contentType !== "image/jpeg";
}

/** The photo at its own aspect, so the checkerboard shows only through its
 *  transparent pixels, with a box of the same shape until it is made. */
function CardPhoto({
	asset,
	seen,
	width,
}: {
	asset: DatasetAsset;
	seen: { width: number; height: number } | undefined;
	width: ThumbWidth;
}) {
	const url = useThumbnail(asset, width);
	const landscape = !seen || seen.width >= seen.height;
	return (
		<span
			className={cn(
				"block max-h-full max-w-full overflow-hidden rounded-[1px]",
				seen && (landscape ? "w-full" : "h-full"),
				url ? mayBeTransparent(asset) && "fc-checkerboard" : "bg-fc-hover",
				!seen && !url && "size-1/2",
			)}
			style={
				seen ? { aspectRatio: `${seen.width} / ${seen.height}` } : undefined
			}
		>
			{url ? (
				<img
					src={url}
					alt=""
					draggable={false}
					className={cn(
						"block",
						seen ? "size-full object-cover" : "max-h-full max-w-full",
					)}
				/>
			) : null}
		</span>
	);
}
