import {
	type BleedMm,
	type CardSizeMm,
	NO_BLEED,
	resolveBleedMm,
} from "@freshcoat-js/coatfile";
import type { PaperName, SheetLayout } from "./types";

/** Paper sizes in millimetres, portrait: the short edge is the width. */
export const PAPER_SIZES_MM: Record<
	PaperName,
	{ widthMm: number; heightMm: number }
> = {
	a4: { widthMm: 210, heightMm: 297 },
	a5: { widthMm: 148, heightMm: 210 },
	a6: { widthMm: 105, heightMm: 148 },
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

/** Crop marks start this far outside the card's edge... */
export const CROP_MARK_OFFSET_MM = 1;
/** ...and run this far. */
export const CROP_MARK_LENGTH_MM = 4;
/** A gap this wide holds a mark from each card on either side of it. */
export const CROP_MARK_GAP_MM = 2 * (CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM);

/** The narrowest gap that keeps neighbouring cards' bleed apart. */
export function minGapMm(bleed: BleedMm): number {
	return Math.max(bleed.left + bleed.right, bleed.top + bleed.bottom);
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
	/** how many slots each card takes, "fill" resolved to `perSheet` */
	copies: number;
	/** the layout's gap, or `minGapMm` of the bleed when that is wider */
	gapMm: number;
	/** set when the cards carry bleed; each slot is still its trim's corner */
	bleedMm?: BleedMm;
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

/** The paper's size in millimetres, portrait. */
export function paperSize(layout: SheetLayout): CardSizeMm {
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

function checkNumbers(card: CardSizeMm, layout: SheetLayout, bleed: BleedMm) {
	if (!(card.widthMm > 0 && card.heightMm > 0))
		throw new SheetLayoutError("The card needs a width and height above 0");
	if (!(layout.marginMm >= 0))
		throw new SheetLayoutError("The margin can't be negative");
	if (!(layout.gapMm >= 0))
		throw new SheetLayoutError("The gap can't be negative");
	if (!Object.values(bleed).every((n) => Number.isFinite(n) && n >= 0))
		throw new SheetLayoutError("The bleed can't be negative");
	const offset = layout.backOffsetMm;
	if (offset && !(Number.isFinite(offset.x) && Number.isFinite(offset.y)))
		throw new SheetLayoutError("The back offset needs two numbers");
	const copies = layout.copies;
	if (
		copies !== undefined &&
		copies !== "fill" &&
		!(Number.isInteger(copies) && copies >= 1)
	)
		throw new SheetLayoutError("Copies needs a whole number from 1, or fill");
}

/** How many times each card repeats: `copies`, or a sheet's worth for "fill". */
export function copiesPerCard(layout: SheetLayout, perSheet: number): number {
	const copies = layout.copies ?? 1;
	return copies === "fill" ? perSheet : copies;
}

function repeat<T>(list: readonly T[], times: number): T[] {
	if (times === 1) return [...list];
	return list.flatMap((entry) => Array.from({ length: times }, () => entry));
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
 * With `copies`, each card takes that many consecutive slots before the
 * next card's; under duplex each copy's back sits behind its own front.
 *
 * With `bleedMm`, each card is placed by its trim and its bleed hangs
 * outside the slot: into the margin at the grid's edge, and into the gap
 * between cards, which is widened to `minGapMm` when the layout's is
 * narrower so no card's bleed covers its neighbour's.
 *
 * Throws a `SheetLayoutError` for a layout that can't be imposed: a card
 * that doesn't fit, or more than two sides under duplex.
 */
export function imposeSheets<T extends ImposeItem>(
	items: readonly T[],
	card: CardSizeMm,
	sheetLayout: SheetLayout,
	options: { bleedMm?: number | BleedMm } = {},
): Imposition<T> {
	const bleed = resolveBleedMm(options.bleedMm);
	checkNumbers(card, sheetLayout, bleed);
	const layout = {
		...sheetLayout,
		gapMm: Math.max(sheetLayout.gapMm, minGapMm(bleed)),
	};
	const paper = paperSize(layout);
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

	const copies = copiesPerCard(layout, perSheet);
	const pages: SheetPage<T>[] = [];
	let sheets = 0;
	if (layout.duplex === "none") {
		const placed = repeat(items, copies);
		for (let i = 0; i < placed.length; i += perSheet) {
			pages.push({
				side: "any",
				slots: placed.slice(i, i + perSheet).map((item, n) => slot(item, n)),
			});
		}
		sheets = pages.length;
	} else {
		const groups = repeat(records(items), copies);
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
		copies,
		gapMm: layout.gapMm,
		...(minGapMm(bleed) > 0 ? { bleedMm: { ...bleed } } : {}),
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

/** Marks running outward from `edge` in `direction` (-1 or +1), starting
 *  past the card's `bleed` on that side and cut short at `limit`; none if
 *  there is no room past the offset. */
function run(
	edge: number,
	direction: -1 | 1,
	limit: number,
	bleed: number,
): [number, number] | null {
	const start = edge + direction * (bleed + CROP_MARK_OFFSET_MM);
	const end =
		edge + direction * (bleed + CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM);
	const clipped = direction < 0 ? Math.max(end, limit) : Math.min(end, limit);
	if ((clipped - start) * direction <= 0) return null;
	return [start, clipped];
}

/**
 * The crop marks of a front page's grid: one at each end of every cut line,
 * in the margin, and in the gaps between cards when a gap is wide enough to
 * hold a mark from each side (`CROP_MARK_GAP_MM`) past both cards' bleed.
 * Marks sit on the trim and start outside the bleed. A mark is cut short at
 * the paper's edge, and never crosses a card or its bleed.
 */
export function cropMarks(imposition: Imposition<unknown>): CropMark[] {
	const { paper, card, columns, rows, originMm } = imposition;
	const gap = imposition.gapMm;
	const bleed = imposition.bleedMm ?? NO_BLEED;
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
	const roomFor = (space: number) => space >= CROP_MARK_GAP_MM - 1e-9;
	const betweenRows = roomFor(gap - bleed.top - bleed.bottom);
	const betweenColumns = roomFor(gap - bleed.left - bleed.right);
	for (const x of xs) {
		vertical(x, run(top, -1, 0, bleed.top));
		vertical(x, run(bottom, 1, paper.heightMm, bleed.bottom));
		if (betweenRows)
			for (let r = 0; r + 1 < rows; r++) {
				const below = originMm.y + r * (card.heightMm + gap) + card.heightMm;
				const next = below + gap;
				vertical(x, run(below, 1, next - bleed.top, bleed.bottom));
				vertical(x, run(next, -1, below + bleed.bottom, bleed.top));
			}
	}
	for (const y of ys) {
		horizontal(y, run(left, -1, 0, bleed.left));
		horizontal(y, run(right, 1, paper.widthMm, bleed.right));
		if (betweenColumns)
			for (let c = 0; c + 1 < columns; c++) {
				const after = originMm.x + c * (card.widthMm + gap) + card.widthMm;
				const next = after + gap;
				horizontal(y, run(after, 1, next - bleed.left, bleed.right));
				horizontal(y, run(next, -1, after + bleed.right, bleed.left));
			}
	}
	return marks;
}

/** A registration target's crosshair runs this far across... */
export const REGISTRATION_MARK_SIZE_MM = 6;
/** ...around a circle of this radius. */
export const REGISTRATION_MARK_RADIUS_MM = 2;
/** Each colour bar patch is a square this wide. */
export const COLOR_BAR_PATCH_MM = 4;
/** The slug's type size. */
export const SLUG_FONT_PT = 6;
/** Room kept between a mark and the paper's edge, a card's bleed, a crop
 *  mark or another mark. */
export const MARK_CLEARANCE_MM = 1;

/** Black at 100, 75, 50, 25, 10 and 0 percent, then cyan, magenta, yellow,
 *  red, green and blue, as RGB from 0 to 1. */
export const COLOR_BAR_STEPS: readonly (readonly [number, number, number])[] = [
	[0, 0, 0],
	[0.25, 0.25, 0.25],
	[0.5, 0.5, 0.5],
	[0.75, 0.75, 0.75],
	[0.9, 0.9, 0.9],
	[1, 1, 1],
	[0, 1, 1],
	[1, 0, 1],
	[1, 1, 0],
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1],
];

const PT_PER_MM = 72 / 25.4;

/** A registration target's centre, in millimetres from the page's top-left
 *  corner. */
export type RegistrationMark = { x: number; y: number };

export type ColorPatch = {
	x: number;
	y: number;
	sizeMm: number;
	rgb: readonly [number, number, number];
};

/** Where the slug line goes: `y` is the top of its type, and the text is cut
 *  to `widthMm`. */
export type SlugBox = {
	x: number;
	y: number;
	widthMm: number;
	heightMm: number;
};

export type SheetMarks = {
	crop: CropMark[];
	registration: RegistrationMark[];
	colorBar: ColorPatch[];
	slug: SlugBox | null;
};

export type SheetMarkOptions = Pick<
	SheetLayout,
	| "cropMarks"
	| "registrationMarks"
	| "colorBar"
	| "slug"
	| "duplex"
	| "backOffsetMm"
>;

type Margins = {
	/** from the paper's edge to the cards' bleed */
	top: number;
	bottom: number;
	left: number;
	right: number;
	/** the cards' bleed edges */
	x0: number;
	x1: number;
	y0: number;
	y1: number;
};

function margins(imposition: Imposition<unknown>): Margins {
	const { paper, card, columns, rows, originMm } = imposition;
	const gap = imposition.gapMm;
	const bleed = imposition.bleedMm ?? NO_BLEED;
	const x0 = originMm.x - bleed.left;
	const y0 = originMm.y - bleed.top;
	const x1 =
		originMm.x + columns * card.widthMm + (columns - 1) * gap + bleed.right;
	const y1 =
		originMm.y + rows * card.heightMm + (rows - 1) * gap + bleed.bottom;
	return {
		top: y0,
		bottom: paper.heightMm - y1,
		left: x0,
		right: paper.widthMm - x1,
		x0,
		x1,
		y0,
		y1,
	};
}

/** The spot along an edge nearest its middle, larger on a tie, where a
 *  target clears every cut line in `cuts` and the paper's ends; null if
 *  there is none. */
function along(length: number, cutsAt: number[]): number | null {
	const half = REGISTRATION_MARK_SIZE_MM / 2 + MARK_CLEARANCE_MM;
	const clear = (at: number) =>
		at >= half - 1e-9 &&
		at <= length - half + 1e-9 &&
		cutsAt.every((c) => Math.abs(c - at) >= half - 1e-9);
	const middle = length / 2;
	const candidates = [middle, ...cutsAt.flatMap((c) => [c - half, c + half])]
		.filter(clear)
		.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || b - a);
	return candidates[0] ?? null;
}

/** The registration targets of a front: one centred in each margin deep
 *  enough to hold it, moved along the edge off any crop mark. */
function frontTargets(
	imposition: Imposition<unknown>,
	m: Margins,
	withCrop: boolean,
): RegistrationMark[] {
	const { paper, card, columns, rows, originMm, gapMm } = imposition;
	const depth = REGISTRATION_MARK_SIZE_MM + 2 * MARK_CLEARANCE_MM;
	const xs = withCrop ? cuts(originMm.x, card.widthMm, gapMm, columns) : [];
	const ys = withCrop ? cuts(originMm.y, card.heightMm, gapMm, rows) : [];
	const out: RegistrationMark[] = [];
	const x = along(paper.widthMm, xs);
	const y = along(paper.heightMm, ys);
	if (x !== null) {
		if (m.top >= depth) out.push({ x, y: m.top / 2 });
		if (m.bottom >= depth) out.push({ x, y: paper.heightMm - m.bottom / 2 });
	}
	if (y !== null) {
		if (m.left >= depth) out.push({ x: m.left / 2, y });
		if (m.right >= depth) out.push({ x: paper.widthMm - m.right / 2, y });
	}
	return out;
}

/** How far crop marks reach into a margin past the cards' bleed. */
const CROP_REACH_MM = CROP_MARK_OFFSET_MM + CROP_MARK_LENGTH_MM;

/** The span along a top or bottom margin from the cards' left bleed edge up
 *  to the first target in the band `[top, bottom]`, or the right bleed edge. */
function runFromLeft(
	m: Margins,
	targets: RegistrationMark[],
	top: number,
	bottom: number,
): [number, number] {
	const r = REGISTRATION_MARK_SIZE_MM / 2;
	let end = m.x1;
	for (const t of targets)
		if (t.y + r > top && t.y - r < bottom && t.x + r > m.x0)
			end = Math.min(end, t.x - r - MARK_CLEARANCE_MM);
	return [m.x0, end];
}

/**
 * Every printer's mark of one page, in millimetres from its top-left corner:
 * crop marks on fronts, registration targets centred in each margin, a
 * colour bar along the bottom margin and a slug line along the top. A mark
 * is left out where its margin has no room for it; the colour bar and slug
 * sit outside the crop marks and stop short of a target.
 *
 * A back's targets are its front's, mirrored as the flip mirrors the sheet
 * and moved by the back offset, so they land behind the front's.
 */
export function sheetMarks(
	imposition: Imposition<unknown>,
	options: SheetMarkOptions,
	side: SheetPage<unknown>["side"],
): SheetMarks {
	const { paper } = imposition;
	const m = margins(imposition);
	const crop =
		options.cropMarks && side !== "back" ? cropMarks(imposition) : [];
	let registration: RegistrationMark[] = [];
	if (options.registrationMarks) {
		registration = frontTargets(imposition, m, options.cropMarks);
		if (side === "back") {
			const mirrorColumns =
				(options.duplex === "long-edge") ===
				(imposition.paper.orientation === "portrait");
			const dx = options.backOffsetMm?.x ?? 0;
			const dy = options.backOffsetMm?.y ?? 0;
			registration = registration.map((t) => ({
				x: (mirrorColumns ? paper.widthMm - t.x : t.x) + dx,
				y: (mirrorColumns ? t.y : paper.heightMm - t.y) + dy,
			}));
		}
	}
	const reach = options.cropMarks ? CROP_REACH_MM : 0;
	const pad = MARK_CLEARANCE_MM / 2;

	const colorBar: ColorPatch[] = [];
	if (options.colorBar) {
		const size = COLOR_BAR_PATCH_MM;
		const room = m.bottom - reach;
		if (room >= size + 2 * pad) {
			const y = paper.heightMm - (room + size) / 2;
			const [start, end] = runFromLeft(m, registration, y, y + size);
			if (end - start >= COLOR_BAR_STEPS.length * size - 1e-9)
				for (const [i, rgb] of COLOR_BAR_STEPS.entries())
					colorBar.push({ x: start + i * size, y, sizeMm: size, rgb });
		}
	}

	let slug: SlugBox | null = null;
	if (options.slug) {
		const height = SLUG_FONT_PT / PT_PER_MM;
		const room = m.top - reach;
		if (room >= height + 2 * pad) {
			const y = (room - height) / 2;
			const [start, end] = runFromLeft(m, registration, y, y + height);
			if (end - start >= 20)
				slug = { x: start, y, widthMm: end - start, heightMm: height };
		}
	}
	return { crop, registration, colorBar, slug };
}

/** The slug line's words for one page: "Members · Sheet 2 of 5 · Back ·
 *  2026-10-13". Single-sided sheets name no side. */
export function slugText(
	imposition: Imposition<unknown>,
	pageIndex: number,
	info: { job?: string; date: Date },
): string {
	const pages = imposition.pages;
	const side = pages[pageIndex]?.side ?? "any";
	const sheet = pages
		.slice(0, pageIndex + 1)
		.filter((p) => p.side !== "back").length;
	const parts = [
		info.job?.trim(),
		`Sheet ${sheet} of ${imposition.sheets}`,
		side === "any" ? undefined : side === "front" ? "Front" : "Back",
		info.date.toISOString().slice(0, 10),
	];
	return parts.filter(Boolean).join(" · ");
}

/** "10 per sheet · 21 sheets" and friends, for a summary line, with
 *  "· 3 copies each" when cards repeat. */
export function sheetSummary(imposition: Imposition<unknown>): string {
	const { perSheet, sheets, copies } = imposition;
	const each = copies > 1 ? ` · ${copies} copies each` : "";
	return `${perSheet} per sheet · ${sheets} ${sheets === 1 ? "sheet" : "sheets"}${each}`;
}
