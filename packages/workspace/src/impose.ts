import type { PaperName, SheetLayout } from "./types";

/** Paper sizes in millimetres, portrait: the short edge is the width. */
export const PAPER_SIZES_MM: Record<
	PaperName,
	{ widthMm: number; heightMm: number }
> = {
	a4: { widthMm: 210, heightMm: 297 },
	letter: { widthMm: 215.9, heightMm: 279.4 },
	legal: { widthMm: 215.9, heightMm: 355.6 },
	a3: { widthMm: 297, heightMm: 420 },
	tabloid: { widthMm: 279.4, heightMm: 431.8 },
};

export const DEFAULT_SHEET_LAYOUT: SheetLayout = {
	kind: "sheet",
	paper: "a4",
	orientation: "auto",
	marginMm: 10,
	gapMm: 0,
	cropMarks: true,
	duplex: "none",
};

export const MM_PER_INCH = 25.4;
/** Crop marks start this far outside the card's edge... */
export const CROP_MARK_OFFSET_MM = 1;
/** ...and run this far. */
export const CROP_MARK_LENGTH_MM = 4;
/** A gap this wide holds a mark from each card on either side of it. */
export const CROP_MARK_GAP_MM = 2 * (CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM);

export type CardSizeMm = { widthMm: number; heightMm: number };

/** The card size a template of this many pixels prints at at this DPI. */
export function cardSizeMm(
	widthPx: number,
	heightPx: number,
	dpi: number,
): CardSizeMm {
	return {
		widthMm: (widthPx / dpi) * MM_PER_INCH,
		heightMm: (heightPx / dpi) * MM_PER_INCH,
	};
}

/** What `imposeSheets` needs of an item: which record it shows, in which
 *  variant, and which of that card's sides. All matter only under duplex.
 *  An item without a `recordId` is a card of its own; one without a
 *  `sideIndex` counts from its card's first item. Exporting every variant
 *  makes one card per record and variant, so `variantId` tells them apart. */
export type ImposeItem = {
	recordId?: string;
	variantId?: string;
	sideIndex?: number;
};

export type SheetSlot<T> = {
	item: T;
	/** the card's top-left corner, from the page's top-left corner */
	xMm: number;
	yMm: number;
	rotated: false;
};

export type SheetPage<T> = {
	/** "any" on a single-sided layout */
	side: "front" | "back" | "any";
	slots: SheetSlot<T>[];
};

export type Imposition<T> = {
	/** as laid out, so landscape has the long edge across */
	paper: {
		widthMm: number;
		heightMm: number;
		orientation: "portrait" | "landscape";
	};
	card: CardSizeMm;
	columns: number;
	rows: number;
	perSheet: number;
	gapMm: number;
	/** the grid's top-left corner on a front page */
	originMm: { x: number; y: number };
	/** pieces of paper: two pages each when backs print, else one */
	sheets: number;
	pages: SheetPage<T>[];
};

export type SheetLayoutAxis = "width" | "height" | "both";

/** A layout that can't be imposed. `axis` names the side that doesn't fit,
 *  when that is the reason. */
export class SheetLayoutError extends Error {
	readonly axis?: SheetLayoutAxis;
	constructor(message: string, axis?: SheetLayoutAxis) {
		super(message);
		this.name = "SheetLayoutError";
		if (axis !== undefined) this.axis = axis;
	}
}

type Grid = {
	widthMm: number;
	heightMm: number;
	orientation: "portrait" | "landscape";
	columns: number;
	rows: number;
};

function portraitPaper(layout: SheetLayout): CardSizeMm {
	const size =
		typeof layout.paper === "string"
			? PAPER_SIZES_MM[layout.paper]
			: layout.paper;
	if (size === undefined)
		throw new SheetLayoutError(`Unknown paper size: ${String(layout.paper)}`);
	const { widthMm, heightMm } = size;
	if (!(widthMm > 0 && heightMm > 0))
		throw new SheetLayoutError("The paper needs a width and height above 0");
	return {
		widthMm: Math.min(widthMm, heightMm),
		heightMm: Math.max(widthMm, heightMm),
	};
}

function countFitting(usable: number, card: number, gap: number): number {
	return Math.max(0, Math.floor((usable + gap) / (card + gap) + 1e-9));
}

function grid(
	paper: CardSizeMm,
	orientation: "portrait" | "landscape",
	card: CardSizeMm,
	layout: SheetLayout,
): Grid {
	const widthMm = orientation === "portrait" ? paper.widthMm : paper.heightMm;
	const heightMm = orientation === "portrait" ? paper.heightMm : paper.widthMm;
	return {
		widthMm,
		heightMm,
		orientation,
		columns: countFitting(
			widthMm - 2 * layout.marginMm,
			card.widthMm,
			layout.gapMm,
		),
		rows: countFitting(
			heightMm - 2 * layout.marginMm,
			card.heightMm,
			layout.gapMm,
		),
	};
}

const mm = (n: number) => `${Math.round(n * 10) / 10} mm`;

function noFit(g: Grid, card: CardSizeMm, layout: SheetLayout, auto: boolean) {
	const across = g.widthMm - 2 * layout.marginMm;
	const down = g.heightMm - 2 * layout.marginMm;
	const axis: SheetLayoutAxis =
		g.columns === 0 && g.rows === 0
			? "both"
			: g.columns === 0
				? "width"
				: "height";
	const size = `The card is ${mm(card.widthMm)} × ${mm(card.heightMm)}`;
	const way = auto ? " either way round" : ` in ${g.orientation}`;
	const room = `the paper leaves ${mm(across)} × ${mm(down)} inside its margins${way}`;
	const what =
		axis === "both"
			? "too wide and too tall"
			: axis === "width"
				? "too wide"
				: "too tall";
	return new SheetLayoutError(`${size}, ${what}: ${room}`, axis);
}

function checkNumbers(card: CardSizeMm, layout: SheetLayout) {
	if (!(card.widthMm > 0 && card.heightMm > 0))
		throw new SheetLayoutError("The card needs a width and height above 0");
	if (!(layout.marginMm >= 0))
		throw new SheetLayoutError("The margin can't be negative");
	if (!(layout.gapMm >= 0))
		throw new SheetLayoutError("The gap can't be negative");
	const offset = layout.backOffsetMm;
	if (offset && !(Number.isFinite(offset.x) && Number.isFinite(offset.y)))
		throw new SheetLayoutError("The back offset needs two numbers");
}

type Group<T> = { front?: T; back?: T };

/** Consecutive items with one `recordId` and one `variantId` are one card,
 *  their sides in order unless they say otherwise. */
function records<T extends ImposeItem>(items: readonly T[]): Group<T>[] {
	const groups: Group<T>[] = [];
	let current: Group<T> | undefined;
	let currentId: string | undefined;
	let currentVariant: string | undefined;
	let position = 0;
	for (const item of items) {
		if (
			current === undefined ||
			item.recordId === undefined ||
			item.recordId !== currentId ||
			item.variantId !== currentVariant
		) {
			current = {};
			groups.push(current);
			currentId = item.recordId;
			currentVariant = item.variantId;
			position = 0;
		}
		const side = item.sideIndex ?? position;
		position++;
		if (side > 1)
			throw new SheetLayoutError(
				`Double-sided sheets hold two sides of a card, and this one has ${side + 1}`,
			);
		if (side === 0) current.front ??= item;
		else current.back ??= item;
	}
	return groups;
}

/**
 * Lays items out on sheets of paper. Single-sided, every item takes the next
 * slot, left to right and top to bottom. Duplex, each record's first side
 * takes a slot on a front page and its second side the mirrored slot on the
 * page after it; a record missing a side leaves that slot empty.
 *
 * Flipping a sheet over its long edge mirrors it across that edge, so a
 * portrait sheet mirrors its columns and a landscape one its rows; a short
 * edge flip is the other way about.
 *
 * Throws a `SheetLayoutError` for a layout that can't be imposed: a card
 * that doesn't fit, or more than two sides under duplex.
 */
export function imposeSheets<T extends ImposeItem>(
	items: readonly T[],
	card: CardSizeMm,
	layout: SheetLayout,
): Imposition<T> {
	checkNumbers(card, layout);
	const paper = portraitPaper(layout);
	const portrait = grid(paper, "portrait", card, layout);
	let g: Grid;
	if (layout.orientation === "auto") {
		const landscape = grid(paper, "landscape", card, layout);
		g =
			landscape.columns * landscape.rows > portrait.columns * portrait.rows
				? landscape
				: portrait;
	} else if (layout.orientation === "landscape") {
		g = grid(paper, "landscape", card, layout);
	} else {
		g = portrait;
	}
	if (g.columns === 0 || g.rows === 0)
		throw noFit(g, card, layout, layout.orientation === "auto");

	const { columns, rows } = g;
	const perSheet = columns * rows;
	const pitchX = card.widthMm + layout.gapMm;
	const pitchY = card.heightMm + layout.gapMm;
	const originX =
		layout.marginMm +
		(g.widthMm - 2 * layout.marginMm - (columns * pitchX - layout.gapMm)) / 2;
	const originY =
		layout.marginMm +
		(g.heightMm - 2 * layout.marginMm - (rows * pitchY - layout.gapMm)) / 2;

	const slot = (item: T, index: number, dx = 0, dy = 0): SheetSlot<T> => ({
		item,
		xMm: originX + (index % columns) * pitchX + dx,
		yMm: originY + Math.floor(index / columns) * pitchY + dy,
		rotated: false,
	});

	const pages: SheetPage<T>[] = [];
	let sheets = 0;
	if (layout.duplex === "none") {
		for (let i = 0; i < items.length; i += perSheet) {
			pages.push({
				side: "any",
				slots: items.slice(i, i + perSheet).map((item, n) => slot(item, n)),
			});
		}
		sheets = pages.length;
	} else {
		const groups = records(items);
		const backs =
			layout.blankBacks === true || groups.some((r) => r.back !== undefined);
		const mirrorColumns =
			(layout.duplex === "long-edge") === (g.orientation === "portrait");
		const mirror = (index: number) => {
			const column = index % columns;
			const row = Math.floor(index / columns);
			return mirrorColumns
				? row * columns + (columns - 1 - column)
				: (rows - 1 - row) * columns + column;
		};
		const dx = layout.backOffsetMm?.x ?? 0;
		const dy = layout.backOffsetMm?.y ?? 0;
		for (let i = 0; i < groups.length; i += perSheet) {
			const chunk = groups.slice(i, i + perSheet);
			const front: SheetSlot<T>[] = [];
			const back: SheetSlot<T>[] = [];
			chunk.forEach((record, n) => {
				if (record.front !== undefined) front.push(slot(record.front, n));
				if (record.back !== undefined)
					back.push(slot(record.back, mirror(n), dx, dy));
			});
			pages.push({ side: "front", slots: front });
			if (backs) pages.push({ side: "back", slots: back });
			sheets++;
		}
	}

	return {
		paper: {
			widthMm: g.widthMm,
			heightMm: g.heightMm,
			orientation: g.orientation,
		},
		card: { ...card },
		columns,
		rows,
		perSheet,
		gapMm: layout.gapMm,
		originMm: { x: originX, y: originY },
		sheets,
		pages,
	};
}

/** A line segment in millimetres from the page's top-left corner. */
export type CropMark = { x1: number; y1: number; x2: number; y2: number };

/** Every cut line's position on one axis, once each: with no gap, one card's
 *  far edge is the next one's near edge. */
function cuts(origin: number, size: number, gap: number, count: number) {
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const near = origin + i * (size + gap);
		for (const at of [near, near + size]) {
			const last = out[out.length - 1];
			if (last === undefined || Math.abs(last - at) > 1e-6) out.push(at);
		}
	}
	return out;
}

/** Marks running outward from `edge` in `direction` (-1 or +1), cut short
 *  at `limit`; none if there is no room past the offset. */
function run(
	edge: number,
	direction: -1 | 1,
	limit: number,
): [number, number] | null {
	const start = edge + direction * CROP_MARK_OFFSET_MM;
	const end = edge + direction * (CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM);
	const clipped = direction < 0 ? Math.max(end, limit) : Math.min(end, limit);
	if ((clipped - start) * direction <= 0) return null;
	return [start, clipped];
}

/**
 * The crop marks of a front page's grid: one at each end of every cut line,
 * in the margin, and in the gaps between cards when a gap is wide enough to
 * hold a mark from each side (`CROP_MARK_GAP_MM`). A mark is cut short at the
 * paper's edge, and never crosses a card.
 */
export function cropMarks(imposition: Imposition<unknown>): CropMark[] {
	const { paper, card, columns, rows, originMm } = imposition;
	const gap = imposition.gapMm;
	const xs = cuts(originMm.x, card.widthMm, gap, columns);
	const ys = cuts(originMm.y, card.heightMm, gap, rows);
	const top = originMm.y;
	const bottom = originMm.y + rows * card.heightMm + (rows - 1) * gap;
	const left = originMm.x;
	const right = originMm.x + columns * card.widthMm + (columns - 1) * gap;
	const marks: CropMark[] = [];
	const vertical = (x: number, span: [number, number] | null) => {
		if (span) marks.push({ x1: x, y1: span[0], x2: x, y2: span[1] });
	};
	const horizontal = (y: number, span: [number, number] | null) => {
		if (span) marks.push({ x1: span[0], y1: y, x2: span[1], y2: y });
	};
	const inGaps = gap >= CROP_MARK_GAP_MM - 1e-9;
	for (const x of xs) {
		vertical(x, run(top, -1, 0));
		vertical(x, run(bottom, 1, paper.heightMm));
		if (inGaps)
			for (let r = 0; r + 1 < rows; r++) {
				const below = originMm.y + r * (card.heightMm + gap) + card.heightMm;
				vertical(x, run(below, 1, below + gap));
				vertical(x, run(below + gap, -1, below));
			}
	}
	for (const y of ys) {
		horizontal(y, run(left, -1, 0));
		horizontal(y, run(right, 1, paper.widthMm));
		if (inGaps)
			for (let c = 0; c + 1 < columns; c++) {
				const after = originMm.x + c * (card.widthMm + gap) + card.widthMm;
				horizontal(y, run(after, 1, after + gap));
				horizontal(y, run(after + gap, -1, after));
			}
	}
	return marks;
}

/** "10 per sheet · 21 sheets" and friends, for a summary line. */
export function sheetSummary(imposition: Imposition<unknown>): string {
	const { perSheet, sheets } = imposition;
	return `${perSheet} per sheet · ${sheets} ${sheets === 1 ? "sheet" : "sheets"}`;
}
