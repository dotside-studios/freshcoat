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
	assetMap,
	displayText,
	recordByIdMap,
	recordIndexMap,
	recordIssues,
} from "@freshcoat-js/workspace/dataset";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	createContext,
	type KeyboardEvent,
	memo,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Selection } from "react-aria-components";
import { plural } from "~/app/copy";
import PhotoIcon from "~icons/mingcute/pic-line";
import { STATUSES } from "./cells";
import {
	CARD_SIZES,
	type CardLayout,
	type CardSize,
	cardLayout,
	imageColumn,
	thumbWidthFor,
	titleColumn,
} from "./gallery-model";
import type { GridUiStore } from "./grid-state";
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

/** Where the cards go in a grid `width` wide, as react-aria's GridLayout
 *  places them: as many columns as fit at the minimum size, cards grown to
 *  fill them up to the maximum, and the row centred. */
export function cardGrid(layout: CardLayout, width: number) {
	const { minItemSize: min, maxItemSize: max, gap } = layout;
	const columns = Math.max(
		1,
		Math.min(layout.maxColumns, Math.floor(width / (min.width + gap))),
	);
	const maxWidth = Math.min(max.width, width);
	const cardWidth = Math.max(
		min.width,
		Math.min(maxWidth, Math.floor((width - gap * columns) / columns)),
	);
	const space = Math.max(
		0,
		Math.min(gap, Math.floor((width - columns * cardWidth) / (columns + 1))),
	);
	const margin = Math.max(
		0,
		Math.floor((width - columns * cardWidth - space * (columns + 1)) / 2),
	);
	const cardHeight = cardWidth + (min.height - min.width);
	return { columns, cardWidth, cardHeight, space, margin, gap };
}

type Mods = { shift: boolean; mod: boolean };

/**
 * Records as cards of their first photo, in a grid that mounts only the rows
 * of cards in view. Selection is the table's: the same keys, changed by
 * click, Shift-click, Mod-click and Mod+A, so switching views keeps it.
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
	const keys = useMemo(() => items.map((i) => i.id), [items]);
	const scroller = useRef<HTMLDivElement>(null);
	const anchor = useRef<string | null>(null);
	const latest = useRef({ keys, selection, onSelectionChange });
	latest.current = { keys, selection, onSelectionChange };

	const [box, setBox] = useState({ width: 0, height: 0 });
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const measure = () =>
			setBox((prev) =>
				prev.width === el.clientWidth && prev.height === el.clientHeight
					? prev
					: { width: el.clientWidth, height: el.clientHeight },
			);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	const layout = useMemo(
		() => cardLayout(size, narrow, box.width),
		[size, narrow, box.width],
	);
	const grid = useMemo(
		() => cardGrid(layout, box.width || 800),
		[layout, box.width],
	);
	const rowStride = grid.cardHeight + grid.gap;
	const rowCount = Math.ceil(keys.length / grid.columns);

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

	const [focused, setFocused] = useState<string | null>(null);
	const focusedIndex = useMemo(
		() => (focused === null ? -1 : keys.indexOf(focused)),
		[keys, focused],
	);
	const focusedRow =
		focusedIndex < 0 ? -1 : Math.floor(focusedIndex / grid.columns);

	const virtualizer = useVirtualizer({
		count: rowCount,
		getScrollElement: () => scroller.current,
		estimateSize: useCallback(() => rowStride, [rowStride]),
		paddingStart: grid.gap,
		overscan: 1,
		initialRect: { width: 800, height: 600 },
		observeElementRect: (instance, cb) => {
			const el = instance.scrollElement;
			if (!el) return;
			const read = () => cb({ width: el.clientWidth, height: el.clientHeight });
			read();
			if (typeof ResizeObserver === "undefined") return;
			const observer = new ResizeObserver(read);
			observer.observe(el);
			return () => observer.disconnect();
		},
		// The focused card stays mounted, so focus is not lost on scroll.
		rangeExtractor: useCallback(
			(range: {
				startIndex: number;
				endIndex: number;
				overscan: number;
				count: number;
			}) => {
				const out: number[] = [];
				const start = Math.max(0, range.startIndex - range.overscan);
				const end = Math.min(range.count - 1, range.endIndex + range.overscan);
				for (let i = start; i <= end; i++) out.push(i);
				if (focusedRow >= 0 && focusedRow < range.count) {
					if (focusedRow < start) out.unshift(focusedRow);
					else if (focusedRow > end) out.push(focusedRow);
				}
				return out;
			},
			[focusedRow],
		),
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: new card sizes or a resized box re-lay the rows
	useLayoutEffect(() => {
		virtualizer.measure();
	}, [virtualizer, rowStride, box]);

	const select = (key: string, { shift, mod }: Mods) => {
		const { keys, selection, onSelectionChange } = latest.current;
		if (shift && anchor.current) {
			const a = keys.indexOf(anchor.current);
			const b = keys.indexOf(key);
			if (a >= 0 && b >= 0) {
				onSelectionChange(
					new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1)),
				);
				return;
			}
		}
		anchor.current = key;
		if (mod) {
			const next = new Set<string | number>(
				selection === "all" ? keys : selection,
			);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			onSelectionChange(next);
		} else onSelectionChange(new Set([key]));
	};

	const focusAt = (index: number) => {
		const el = scroller.current;
		const key = latest.current.keys[index];
		if (!el || key === undefined) return;
		setFocused(key);
		const top = grid.gap + Math.floor(index / grid.columns) * rowStride;
		if (top < el.scrollTop) el.scrollTop = top - grid.gap;
		else if (top + grid.cardHeight > el.scrollTop + el.clientHeight)
			el.scrollTop = top + grid.cardHeight + grid.gap - el.clientHeight;
		const selector = `[data-row="${CSS.escape(key)}"]`;
		let tries = 0;
		const tick = () => {
			const target = el.querySelector<HTMLElement>(selector);
			if (target) target.focus();
			else if (tries++ < 30) requestAnimationFrame(tick);
		};
		tick();
	};

	const cardOf = (target: EventTarget) => {
		const el = (target as HTMLElement).closest?.<HTMLElement>(
			"[role=row][data-row]",
		);
		return el && scroller.current?.contains(el) ? el : null;
	};

	const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
		const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
		if ((e.key === "Delete" || e.key === "Backspace") && plain) {
			if (selectedIds.length === 0) return;
			e.preventDefault();
			e.stopPropagation();
			onDeleteRows([...selectedIds]);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const card = cardOf(e.target);
		const key = card?.dataset.row;
		if (!key || e.altKey) return;
		const mod = e.metaKey || e.ctrlKey;
		const { keys, selection } = latest.current;
		if (mod && !e.shiftKey && e.key.toLowerCase() === "a") {
			e.preventDefault();
			onSelectionChange("all");
			return;
		}
		if (e.key === "Escape") {
			if (selection !== "all" && selection.size === 0) return;
			e.preventDefault();
			onSelectionChange(new Set());
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			onOpen(key);
			return;
		}
		if (e.key === " ") {
			e.preventDefault();
			select(key, { shift: e.shiftKey, mod });
			return;
		}
		const at = keys.indexOf(key);
		const cols = grid.columns;
		const page = cols * Math.max(1, Math.floor(box.height / rowStride) || 1);
		let next = at;
		switch (e.key) {
			case "ArrowRight":
				next = at + 1;
				break;
			case "ArrowLeft":
				next = at - 1;
				break;
			case "ArrowDown":
				next = at + cols;
				break;
			case "ArrowUp":
				next = at - cols;
				break;
			case "PageDown":
				next = Math.min(keys.length - 1, at + page);
				break;
			case "PageUp":
				next = Math.max(0, at - page);
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = keys.length - 1;
				break;
			default:
				return;
		}
		e.preventDefault();
		if (next < 0 || next >= keys.length || next === at) return;
		const target = keys[next] as string;
		if (!mod) select(target, { shift: e.shiftKey, mod: false });
		focusAt(next);
	};

	const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
		const row = cardOf(e.target)?.dataset.row;
		if (!row) return;
		setFocused(row);
		const col = ui.get().active?.col ?? dataset.columns[0]?.key ?? "";
		ui.set({ active: { row, col } });
	};

	const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
		const key = cardOf(e.target)?.dataset.row;
		if (!key) return;
		select(key, { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
	};

	const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
		const key = cardOf(e.target)?.dataset.row;
		if (key) onOpen(key);
	};

	const rowsInView = virtualizer.getVirtualItems();
	const focusMounted =
		focusedRow >= 0 && rowsInView.some((r) => r.index === focusedRow);
	const tabIndexAt = focusMounted
		? focusedIndex
		: (rowsInView[0]?.index ?? 0) * grid.columns;
	const isSelected = (key: string) => selection === "all" || selection.has(key);

	return (
		<CardContext.Provider value={ctx}>
			<div
				data-testid="records-gallery"
				data-card-size={size}
				className="relative flex min-h-0 flex-1 flex-col bg-fc-app"
				onKeyDownCapture={onKeyDownCapture}
			>
				{/* biome-ignore lint/a11y/useSemanticElements: an ARIA grid of cards, which no HTML element is */}
				<div
					ref={scroller}
					role="grid"
					aria-label={`Records of ${dataset.name}`}
					aria-multiselectable="true"
					aria-rowcount={keys.length}
					tabIndex={-1}
					onKeyDown={onKeyDown}
					onFocus={onFocus}
					onClick={onClick}
					onDoubleClick={onDoubleClick}
					// A composited scroller: scrolling moves a layer instead of
					// repainting every card on the page each frame.
					className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-fc-app outline-none will-change-scroll [scrollbar-gutter:stable]"
				>
					{keys.length === 0 ? (
						<div className="px-3 py-10 text-center text-fc-faint text-fc-sm">
							{emptyState}
						</div>
					) : (
						<div
							className="relative w-full"
							style={{ height: virtualizer.getTotalSize() }}
						>
							{rowsInView.flatMap((row) => {
								const first = row.index * grid.columns;
								return keys
									.slice(first, first + grid.columns)
									.map((key, c) => (
										<GalleryCard
											key={key}
											id={key}
											index={first + c}
											selected={isSelected(key)}
											tabbable={first + c === tabIndexAt}
											x={
												grid.margin +
												grid.space +
												c * (grid.cardWidth + grid.space)
											}
											y={row.start}
											width={grid.cardWidth}
											height={grid.cardHeight}
										/>
									));
							})}
						</div>
					)}
				</div>
			</div>
		</CardContext.Provider>
	);
});

const GalleryCard = memo(function GalleryCard({
	id,
	index,
	selected,
	tabbable,
	x,
	y,
	width,
	height,
}: {
	id: string;
	index: number;
	selected: boolean;
	tabbable: boolean;
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a card is a row of the ARIA grid
		<div
			role="row"
			aria-rowindex={index + 1}
			aria-selected={selected}
			data-row={id}
			data-selected={selected ? "" : undefined}
			tabIndex={tabbable ? 0 : -1}
			className={cn(
				"group absolute top-0 left-0 flex cursor-default select-none flex-col rounded-[5px] p-1 outline-none",
				"hover:bg-fc-hover data-selected:bg-fc-accent-soft",
				"focus-visible:outline-2 focus-visible:outline-fc-accent focus-visible:outline-solid focus-visible:outline-offset-1",
			)}
			style={{ width, height, transform: `translate(${x}px, ${y}px)` }}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: the card's one cell */}
			{/* biome-ignore lint/a11y/useFocusableInteractive: the card takes the focus, not its cell */}
			<div role="gridcell" className="flex min-h-0 flex-1 flex-col">
				<Card id={id} />
			</div>
		</div>
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
