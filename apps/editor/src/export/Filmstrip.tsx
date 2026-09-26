import { isMac } from "@freshcoat/ui/kbd";
import { cn } from "@freshcoat/ui/lib/cn";
import type { DataRecord, DatasetAsset } from "@freshcoat/workspace";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { VariantSwatch } from "~/app/VariantSwatch";
import { AssetThumb } from "~/data/AssetThumb";
import CheckIcon from "~icons/mingcute/check-line";
import {
	cellsPerPage,
	entryKey,
	type FilmstripEntry,
	selectionAfterClick,
	stepIndex,
} from "./filmstrip-model";
import { STATUS_TONE } from "./RecordsList";

/** A cell's width, and its thumbnail box. */
export const FILM_CELL = 92;
const THUMB_W = 84;
const THUMB_H = 60;

export function Filmstrip({
	entries,
	currentId,
	onPick,
	assetFor,
	labelFor,
	aspect,
	emptyText,
	selection = [],
	onSelectionChange,
}: {
	entries: readonly FilmstripEntry[];
	/** the current cell's key (`entryKey`): the record's id, with its
	 *  variant when the cells carry one */
	currentId: string | null;
	onPick: (id: string, entry: FilmstripEntry) => void;
	/** the photo a record's thumbnail shows, if it has one */
	assetFor: (record: DataRecord) => DatasetAsset | undefined;
	labelFor: (record: DataRecord) => string;
	/** width / height of a record without a photo, as its tile */
	aspect: number;
	emptyText: string;
	/** the records chosen for export, apart from the one previewed */
	selection?: readonly string[];
	/** Shift-click selects a range, Mod-click toggles, Mod+A selects every
	 *  cell, Space toggles the current one and Escape clears */
	onSelectionChange?: (ids: string[]) => void;
}) {
	const scrollerRef = useRef<HTMLDivElement>(null);
	// Where a Shift-click range starts: the last cell clicked, else the
	// current one.
	const anchorRef = useRef<string | null>(null);
	const checked = useMemo(() => new Set(selection), [selection]);
	// The records in strip order, once each: a record has a cell per
	// variant when every variant is exported, and selection is by record.
	const order = useMemo(
		() => [...new Set(entries.map((e) => e.record.id))],
		[entries],
	);
	const current = currentId
		? entries.findIndex((e) => entryKey(e) === currentId)
		: -1;
	// A cell's width to spare either side of the current one where there is
	// room, so the next record is visible before it is stepped to.
	const viewport = scrollerRef.current?.clientWidth ?? 0;
	const spare = Math.max(0, Math.min(FILM_CELL, (viewport - FILM_CELL) / 2));

	const virtualizer = useVirtualizer({
		horizontal: true,
		count: entries.length,
		getScrollElement: () => scrollerRef.current,
		estimateSize: () => FILM_CELL,
		getItemKey: (i) => {
			const entry = entries[i];
			return entry ? entryKey(entry) : i;
		},
		overscan: 4,
		scrollPaddingStart: spare,
		scrollPaddingEnd: spare,
		// The current cell stays mounted wherever the strip is scrolled, so
		// aria-activedescendant always names an element.
		rangeExtractor: (range) => {
			const start = Math.max(0, range.startIndex - range.overscan);
			const end = Math.min(range.count - 1, range.endIndex + range.overscan);
			const out: number[] = [];
			for (let i = start; i <= end; i++) out.push(i);
			if (current >= 0 && current < range.count && !out.includes(current))
				out.push(current);
			return out.sort((a, b) => a - b);
		},
	});

	// Keep the current cell in view as it moves, by key, stepper or link.
	useEffect(() => {
		if (current >= 0) virtualizer.scrollToIndex(current, { align: "auto" });
	}, [current, virtualizer]);

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (onSelectionChange && !e.altKey && !e.shiftKey) {
			const mod = isMac ? e.metaKey : e.ctrlKey;
			if (mod && e.code === "KeyA") {
				e.preventDefault();
				onSelectionChange(order);
				return;
			}
			if (!e.ctrlKey && !e.metaKey) {
				if (e.key === "Escape" && selection.length > 0) {
					e.preventDefault();
					onSelectionChange([]);
					return;
				}
				const id = entries[current]?.record.id;
				if (e.key === " " && id !== undefined) {
					e.preventDefault();
					onSelectionChange(
						checked.has(id)
							? selection.filter((s) => s !== id)
							: [...selection, id],
					);
					return;
				}
			}
		}
		if (e.altKey || e.ctrlKey || e.metaKey) return;
		const next = stepIndex(
			current,
			e.key,
			entries.length,
			cellsPerPage(e.currentTarget.clientWidth, FILM_CELL),
		);
		if (next === null) return;
		e.preventDefault();
		const entry = entries[next];
		if (entry && next !== current) onPick(entry.record.id, entry);
	};

	const optionId = (entry: FilmstripEntry) => `filmstrip-${entryKey(entry)}`;
	const tileW =
		aspect >= THUMB_W / THUMB_H ? THUMB_W : Math.round(THUMB_H * aspect);
	const tileH =
		aspect >= THUMB_W / THUMB_H ? Math.round(THUMB_W / aspect) : THUMB_H;

	return (
		<div
			ref={scrollerRef}
			role="listbox"
			aria-label="Records"
			aria-orientation="horizontal"
			aria-activedescendant={
				current >= 0 && entries[current]
					? optionId(entries[current])
					: undefined
			}
			tabIndex={0}
			data-testid="export-filmstrip"
			className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-fc-accent)]"
			onWheel={(e) => {
				// A mouse wheel scrolls the strip sideways.
				if (Math.abs(e.deltaY) > Math.abs(e.deltaX))
					e.currentTarget.scrollLeft += e.deltaY;
			}}
			onKeyDown={onKeyDown}
		>
			{entries.length === 0 ? (
				<div className="grid h-full place-items-center px-4 text-center text-fc-faint text-fc-sm">
					{emptyText}
				</div>
			) : (
				<div
					className="relative h-full"
					style={{ width: virtualizer.getTotalSize() }}
				>
					{virtualizer.getVirtualItems().map((cell) => {
						const at = cell.index;
						const entry = entries[at];
						if (!entry) return null;
						const { record, variant } = entry;
						const selected = at === current;
						const isChecked = checked.has(record.id);
						const asset = assetFor(record);
						const label = labelFor(record);
						return (
							// biome-ignore lint/a11y/useFocusableInteractive: the listbox holds focus and names the current option with aria-activedescendant
							// biome-ignore lint/a11y/useKeyWithClickEvents: the listbox's arrow keys choose, as a click does
							<div
								key={cell.key}
								id={optionId(entry)}
								role="option"
								aria-selected={selected}
								aria-checked={onSelectionChange ? isChecked : undefined}
								aria-setsize={entries.length}
								aria-posinset={at + 1}
								aria-label={`${entry.index + 1}. ${label}${variant ? `, ${variant.label}` : ""}, ${record.status}`}
								title={`${entry.index + 1} · ${label}${variant ? ` · ${variant.label}` : ""}${entry.planned ? "" : " · not in this export"}`}
								data-record={record.id}
								data-variant={variant?.token}
								data-status={record.status}
								className="group/cell absolute top-0 flex h-full cursor-default flex-col items-center justify-center gap-1 px-1"
								style={{ left: cell.start, width: cell.size }}
								onPointerDown={(e) => {
									// Keep the keyboard on the strip, not the cell.
									e.preventDefault();
									scrollerRef.current?.focus({ preventScroll: true });
								}}
								onClick={(e) => {
									const next = onSelectionChange
										? selectionAfterClick(
												selection,
												order,
												anchorRef.current ??
													entries[current]?.record.id ??
													null,
												record.id,
												{
													range: e.shiftKey,
													toggle: isMac ? e.metaKey : e.ctrlKey,
												},
											)
										: null;
									if (!e.shiftKey) anchorRef.current = record.id;
									if (next) onSelectionChange?.(next);
									else onPick(record.id, entry);
								}}
							>
								<div
									className={cn(
										"relative flex items-center justify-center overflow-hidden rounded-[3px] bg-fc-raised",
										selected
											? "outline-2 outline-fc-accent outline-offset-1 outline-solid"
											: "group-hover/cell:outline-1 group-hover/cell:outline-fc-border-strong group-hover/cell:outline-solid",
										isChecked &&
											!selected &&
											"outline-2 outline-fc-accent/60 outline-solid",
										!entry.planned && !isChecked && "opacity-45",
									)}
									style={{ width: THUMB_W, height: THUMB_H }}
								>
									{isChecked ? (
										<span
											aria-hidden
											className="absolute top-1 left-1 z-10 grid size-4 place-items-center rounded-full bg-fc-accent text-white shadow-sm"
										>
											<CheckIcon className="size-3" />
										</span>
									) : null}
									{variant?.id !== undefined ? (
										<VariantSwatch
											swatch={variant.swatch}
											className="absolute top-1 right-1 z-10 size-3 rounded-[2px]"
										/>
									) : null}
									{asset ? (
										<AssetThumb
											asset={asset}
											width={160}
											className="size-full object-contain"
										/>
									) : (
										<div
											className="flex items-center justify-center overflow-hidden rounded-[2px] border border-fc-border bg-fc-panel p-1 text-center text-[9px] text-fc-muted leading-tight"
											style={{ width: tileW - 8, height: tileH - 8 }}
										>
											<span className="line-clamp-3 break-words">{label}</span>
										</div>
									)}
								</div>
								<div className="flex w-full items-center justify-center gap-1 text-[10px] text-fc-muted tabular-nums leading-none">
									<span
										aria-hidden
										className={cn(
											"size-1.5 shrink-0 rounded-full",
											STATUS_TONE[record.status],
										)}
									/>
									<span
										className={cn(
											"truncate",
											selected && "font-medium text-fc-text",
										)}
									>
										{entry.index + 1}
									</span>
									{variant ? (
										<span
											className="min-w-0 truncate"
											data-testid="filmstrip-variant"
										>
											{variant.label}
										</span>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
