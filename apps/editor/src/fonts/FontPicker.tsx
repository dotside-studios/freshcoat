import { cn } from "@freshcoat/ui/lib/cn";
import { Popover } from "@freshcoat/ui/popover";
import { SegmentedControl, SegmentedItem } from "@freshcoat/ui/segmented";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Dialog,
	DialogTrigger,
	type PopoverProps,
} from "react-aria-components";
import { plural } from "~/app/copy";
import CheckIcon from "~icons/mingcute/check-line";
import SearchIcon from "~icons/mingcute/search-line";
import {
	CATEGORIES,
	CLOSE_MATCH,
	type FontCategory,
	type FontSort,
	filterFamilies,
	fuzzyScore,
	type GoogleFontRow,
	loadCatalogue,
} from "./catalogue";
import { useFontPreview } from "./previews";

/** What a pick names: a catalogue family, or a name typed by hand. */
export type FontPick = { family: string; row?: GoogleFontRow };

type Item =
	| { kind: "header"; key: string; label: string }
	| {
			kind: "family";
			key: string;
			family: string;
			row?: GoogleFontRow;
	  }
	| { kind: "lookup"; key: string; family: string };

const ROW_H = 32;
const HEADER_H = 26;
const LIST_H = 320;

/**
 * The listing: the template's families first, then the catalogue, then, for a
 * name nothing matches exactly, a row that looks it up on Google Fonts by name.
 */
export function pickerItems(
	catalogue: readonly GoogleFontRow[],
	templateFamilies: readonly string[],
	opts: { query: string; category: FontCategory | "all"; sort: FontSort },
): Item[] {
	const byName = new Map(catalogue.map((r) => [r.f, r]));
	const ownNames = [...new Set(templateFamilies.filter(Boolean))];
	const own = filterFamilies(
		ownNames.map((f) => byName.get(f) ?? { f }),
		{ ...opts, sort: "name" },
	);
	const ownSet = new Set(ownNames);
	const rest = filterFamilies(
		catalogue.filter((r) => !ownSet.has(r.f)),
		opts,
	);
	const items: Item[] = [];
	if (own.length > 0) {
		items.push({ kind: "header", key: "h:own", label: "In this template" });
		for (const r of own)
			items.push({
				kind: "family",
				key: `own:${r.f}`,
				family: r.f,
				row: byName.get(r.f),
			});
	}
	if (rest.length > 0) {
		items.push({ kind: "header", key: "h:all", label: "Google Fonts" });
		for (const r of rest)
			items.push({ kind: "family", key: `g:${r.f}`, family: r.f, row: r });
	}
	const typed = opts.query.trim().replace(/\s+/g, " ");
	const lower = typed.toLowerCase();
	if (
		typed &&
		!ownNames.some((f) => f.toLowerCase() === lower) &&
		!catalogue.some((r) => r.f.toLowerCase() === lower)
	) {
		const lookup: Item = {
			kind: "lookup",
			key: `lookup:${typed}`,
			family: typed,
		};
		// Scattered letter matches are guesses; with nothing better the typed
		// name comes first, so Enter looks it up as the old text box did.
		const close = [...own, ...rest].some(
			(r) => fuzzyScore(r.f, typed) >= CLOSE_MATCH,
		);
		if (close) items.push(lookup);
		else items.unshift(lookup);
	}
	return items;
}

/** The option to step to from `from` by `by`, skipping headers, clamped. */
export function stepOption(items: readonly Item[], from: number, by: number) {
	const options = items
		.map((it, i) => (it.kind === "header" ? -1 : i))
		.filter((i) => i >= 0);
	if (options.length === 0) return -1;
	const at = options.indexOf(from);
	if (at < 0) return by < 0 ? (options.at(-1) ?? -1) : (options[0] ?? -1);
	return options[Math.max(0, Math.min(options.length - 1, at + by))] ?? from;
}

export function FontPickerPanel({
	value,
	templateFamilies,
	onPick,
	onClose,
}: {
	/** the family the layer has now, marked in the list */
	value: string | null;
	templateFamilies: readonly string[];
	onPick: (pick: FontPick) => void;
	onClose?: () => void;
}) {
	const [catalogue, setCatalogue] = useState<GoogleFontRow[] | null>(null);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<FontCategory | "all">("all");
	const [sort, setSort] = useState<FontSort>("popular");
	const listRef = useRef<HTMLDivElement>(null);
	const id = useId();

	useEffect(() => {
		let live = true;
		void loadCatalogue().then((c) => {
			if (live) setCatalogue(c.families);
		});
		return () => {
			live = false;
		};
	}, []);

	const items = useMemo(
		() =>
			pickerItems(catalogue ?? [], templateFamilies, {
				query,
				category,
				sort,
			}),
		[catalogue, templateFamilies, query, category, sort],
	);
	const familyCount = items.filter((it) => it.kind === "family").length;

	const [active, setActive] = useState(-1);
	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => listRef.current,
		estimateSize: (i) => (items[i]?.kind === "header" ? HEADER_H : ROW_H),
		getItemKey: (i) => items[i]?.key ?? i,
		overscan: 6,
		initialRect: { width: 320, height: LIST_H },
		// The active option stays mounted, so aria-activedescendant resolves.
		rangeExtractor: (range) => {
			const out: number[] = [];
			const start = Math.max(0, range.startIndex - range.overscan);
			const end = Math.min(range.count - 1, range.endIndex + range.overscan);
			for (let i = start; i <= end; i++) out.push(i);
			if (active >= 0 && active < range.count && !out.includes(active))
				out.push(active);
			return out.sort((a, b) => a - b);
		},
	});

	// A new listing starts on the current family, or at the top on its first
	// option.
	useEffect(() => {
		const current = query
			? -1
			: items.findIndex((it) => it.kind === "family" && it.family === value);
		setActive(current >= 0 ? current : stepOption(items, -1, 1));
		if (items.length > 0)
			virtualizer.scrollToIndex(Math.max(0, current), {
				align: current >= 0 ? "center" : "start",
			});
	}, [items, value, query, virtualizer]);

	const move = (to: number) => {
		if (to < 0) return;
		setActive(to);
		virtualizer.scrollToIndex(to, { align: "auto" });
	};

	const pick = (index: number) => {
		const it = items[index];
		if (!it || it.kind === "header") return;
		onPick(
			it.kind === "family"
				? { family: it.family, row: it.row }
				: { family: it.family },
		);
	};

	const onKeyDown = (e: KeyboardEvent) => {
		const page = Math.max(1, Math.floor(LIST_H / ROW_H) - 1);
		const by: Record<string, number> = {
			ArrowDown: 1,
			ArrowUp: -1,
			PageDown: page,
			PageUp: -page,
		};
		if (e.key in by) {
			e.preventDefault();
			move(stepOption(items, active, by[e.key] ?? 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			pick(active);
		} else if (e.key === "Escape" && onClose) {
			e.preventDefault();
			e.stopPropagation();
			onClose();
		}
	};

	const optionId = (i: number) => `${id}-option-${i}`;
	const activeId =
		active >= 0 && items[active]?.kind !== "header"
			? optionId(active)
			: undefined;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: keys from the search box and the list both land here
		<div
			className="flex min-h-0 flex-col"
			onKeyDown={onKeyDown}
			data-testid="font-picker"
		>
			<div className="flex flex-col gap-1.5 border-fc-border border-b p-2">
				<div className="relative">
					<SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-1.5 size-3.5 text-fc-faint" />
					<input
						// biome-ignore lint/a11y/noAutofocus: the picker opens to type into
						autoFocus
						type="text"
						role="combobox"
						aria-label="Search fonts"
						aria-expanded
						aria-controls={`${id}-list`}
						aria-autocomplete="list"
						aria-activedescendant={activeId}
						spellCheck={false}
						autoComplete="off"
						placeholder="Search fonts"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="h-fc-control w-full min-w-0 rounded-[3px] border border-transparent bg-fc-raised pr-1.5 pl-6 text-fc-base text-fc-text outline-none placeholder:text-fc-faint hover:border-fc-border-strong focus:border-fc-accent"
					/>
				</div>
				<div
					role="toolbar"
					aria-label="Category"
					className="flex flex-wrap gap-1"
				>
					{CATEGORIES.map(([key, label]) => (
						<button
							key={key}
							type="button"
							aria-pressed={category === key}
							onClick={() => setCategory(key)}
							className={cn(
								"h-5 cursor-default rounded-full border px-1.5 text-fc-sm outline-none focus-visible:border-fc-accent pointer-coarse:h-7",
								category === key
									? "border-transparent bg-fc-accent-soft text-fc-text"
									: "border-fc-border text-fc-muted hover:border-fc-border-strong hover:text-fc-text",
							)}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			<div
				ref={listRef}
				id={`${id}-list`}
				role="listbox"
				aria-label="Fonts"
				aria-activedescendant={activeId}
				tabIndex={-1}
				className="relative min-h-0 overflow-y-auto overscroll-contain outline-none"
				style={{
					height: LIST_H,
					maxHeight: "calc(var(--visual-viewport-height, 100vh) - 180px)",
				}}
			>
				{catalogue === null ? (
					<div className="grid h-full place-items-center text-fc-faint text-fc-sm">
						Loading fonts
					</div>
				) : items.length === 0 ? (
					<div className="grid h-full place-items-center text-fc-faint text-fc-sm">
						No fonts found
					</div>
				) : (
					<div
						className="relative w-full"
						style={{ height: virtualizer.getTotalSize() }}
					>
						{virtualizer.getVirtualItems().map((v) => {
							const it = items[v.index];
							if (!it) return null;
							const style = {
								transform: `translateY(${v.start}px)`,
								height: v.size,
							};
							if (it.kind === "header")
								return (
									<div
										key={v.key}
										role="presentation"
										className="absolute inset-x-0 top-0 flex items-end px-3 pb-1 font-medium text-fc-faint text-fc-xs uppercase tracking-wide"
										style={style}
									>
										{it.label}
									</div>
								);
							return (
								<FontOption
									key={v.key}
									id={optionId(v.index)}
									style={style}
									active={v.index === active}
									selected={it.kind === "family" && it.family === value}
									onHover={() => setActive(v.index)}
									onPick={() => pick(v.index)}
									preview={it.kind === "family" && it.row ? it.family : null}
									label={
										it.kind === "lookup"
											? `Look up “${it.family}” on Google Fonts`
											: it.family
									}
								/>
							);
						})}
					</div>
				)}
			</div>
			<div className="flex items-center justify-between gap-2 border-fc-border border-t px-2 py-1.5">
				<span className="text-fc-faint text-fc-sm tabular-nums">
					{catalogue === null ? "" : plural(familyCount, "font")}
				</span>
				<SegmentedControl
					aria-label="Sort"
					selectedKey={sort}
					onSelectionChange={(k) => setSort(k as FontSort)}
				>
					<SegmentedItem id="popular">Popular</SegmentedItem>
					<SegmentedItem id="name">Name</SegmentedItem>
				</SegmentedControl>
			</div>
		</div>
	);
}

function FontOption({
	id,
	style,
	active,
	selected,
	onHover,
	onPick,
	preview,
	label,
}: {
	id: string;
	style: CSSProperties;
	active: boolean;
	selected: boolean;
	onHover: () => void;
	onPick: () => void;
	/** the family to preview the name in, if it has a preview */
	preview: string | null;
	label: string;
}) {
	const face = useFontPreview(preview);
	return (
		// biome-ignore lint/a11y/useFocusableInteractive: the search box holds focus and names this option with aria-activedescendant
		// biome-ignore lint/a11y/useKeyWithClickEvents: Enter in the search box picks, as a click does
		<div
			id={id}
			role="option"
			aria-selected={selected}
			aria-label={label}
			data-active={active || undefined}
			className={cn(
				"absolute inset-x-1 top-0 flex cursor-default select-none items-center gap-1.5 rounded-[3px] pr-2 pl-1.5",
				active ? "bg-fc-accent text-white" : "text-fc-text",
			)}
			style={style}
			onPointerMove={active ? undefined : onHover}
			onPointerDown={(e) => e.preventDefault()}
			onClick={onPick}
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				{selected ? <CheckIcon className="size-3.5" /> : null}
			</span>
			<span
				className="min-w-0 flex-1 truncate text-[14px] leading-none"
				style={face ? { fontFamily: `"${face}", var(--font-sans)` } : undefined}
				data-preview={face ? "loaded" : undefined}
			>
				{label}
			</span>
		</div>
	);
}

/** Whether a 320px popover fits beside a side panel; on a phone it does not,
 *  and one placed beside would open off screen. */
function besideFits(): boolean {
	return typeof window === "undefined" || window.innerWidth >= 720;
}

/**
 * The font picker as a popover off `children`, its trigger. It closes on a
 * pick; the caller turns the pick into an edit.
 */
export function FontPicker({
	value,
	templateFamilies,
	onPick,
	placement = "left top",
	children,
}: {
	value: string | null;
	templateFamilies: readonly string[];
	onPick: (pick: FontPick) => void;
	placement?: PopoverProps["placement"];
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<DialogTrigger isOpen={open} onOpenChange={setOpen}>
			{children}
			<Popover
				placement={besideFits() ? placement : "bottom"}
				className="flex w-[320px] max-w-[calc(100vw-16px)] flex-col overflow-hidden"
			>
				<Dialog
					aria-label="Fonts"
					className="flex min-h-0 flex-col outline-none"
				>
					<FontPickerPanel
						value={value}
						templateFamilies={templateFamilies}
						onPick={(p) => {
							setOpen(false);
							onPick(p);
						}}
						onClose={() => setOpen(false)}
					/>
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}
