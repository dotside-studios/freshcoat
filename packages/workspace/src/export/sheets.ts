import {
	bleedMm,
	cardSizeMm,
	DEFAULT_VARIANT_ID,
	hasInsets,
	NO_BLEED,
	type Sides,
	type Template,
	templateBleed,
	variantSize,
} from "@freshcoat-js/coatfile";
import { type Imposition, imposeSheets, SheetLayoutError } from "../impose";
import { exportSize, pdfLayout } from "../plan";
import type { ExportItem, ExportPreset, SheetLayout } from "../types";

/** A planned item with its place among its card's sides, which pairs a
 *  front with its back under duplex. */
export type SheetItem = ExportItem & { sideIndex: number };

/** Each item's side index: its position among the consecutive items of its
 *  card, so a failed front still leaves its back a slot. A card is a record
 *  in one variant, since exporting every variant plans each record once per
 *  variant. */
export function withSideIndex(plan: readonly ExportItem[]): SheetItem[] {
	const out: SheetItem[] = [];
	plan.forEach((item, i) => {
		const previous = out[i - 1];
		const sameCard =
			previous?.recordIndex === item.recordIndex &&
			previous.variantId === item.variantId;
		out.push({
			...item,
			sideIndex: sameCard ? previous.sideIndex + 1 : 0,
		});
	});
	return out;
}

/** Why a preset sized from each photo can't include bleed: the photo's
 *  pixels are the trim. */
export const BLEED_NEEDS_TEMPLATE_SIZE = "Bleed needs Template size";

/** The bleed each item renders with, in design units: the template's, when
 *  the preset includes it at template size. */
export function presetBleed(
	template: Pick<Template, "bleed">,
	preset: Pick<ExportPreset, "bleed" | "size">,
): Sides {
	if (!preset.bleed || exportSize(preset).kind === "image") return NO_BLEED;
	return templateBleed(template);
}

/** The preset's bleed in millimetres at its DPI, when there is any. */
export function presetBleedMm(
	template: Pick<Template, "bleed">,
	preset: Pick<ExportPreset, "bleed" | "size" | "dpi">,
) {
	const bleed = presetBleed(template, preset);
	return hasInsets(bleed) ? bleedMm(bleed, preset.dpi) : undefined;
}

/** The preset's sheet layout, when it is a PDF laid out on sheets. */
export function sheetLayout(
	preset: Pick<ExportPreset, "format" | "layout">,
): SheetLayout | null {
	if (preset.format !== "pdf") return null;
	const layout = pdfLayout(preset);
	return layout.kind === "sheet" ? layout : null;
}

/** Why a preset sized from each photo can't be laid out on sheets: every
 *  slot is the template's size, so a photo's aspect would be stretched. */
export const SHEETS_NEED_TEMPLATE_SIZE = "Sheets need Template size";

/** Why a plan whose variants differ in size can't be laid out on sheets:
 *  every slot is one card's size. */
export const SHEETS_NEED_ONE_SIZE = "Sheets need one card size";

/** Why a plan of pieces that differ in size can't be laid out on sheets:
 *  every slot is one card's size, and a piece has no bleed to trim. */
export const SHEETS_NEED_ONE_PIECE_SIZE = "Sheets need one piece size";

/** What the job bar says for a card that doesn't fit, where the full
 *  message, with both sizes in it, would be cut off. */
export const SHEETS_DONT_FIT = "Doesn't fit the paper";

export type SheetPlan =
	| {
			layout: SheetLayout;
			imposition: Imposition<SheetItem>;
			error?: never;
			shortError?: never;
			field?: never;
	  }
	| {
			layout: SheetLayout;
			imposition?: never;
			/** the whole reason, shown inline in the settings */
			error: string;
			/** a few words for the job bar, with `error` on hover */
			shortError: string;
			/** the setting that is out of range, when that is the reason */
			field?: "backOffset";
	  };

/** What the job bar says for a back offset past its limit or off the paper. */
export const BACK_OFFSET_OUT_OF_RANGE = "Back offset out of range";

/** A few words for a layout error, for a bar with no room for the whole
 *  message. */
export function shortSheetError(e: SheetLayoutError): string {
	if (e.axis) return SHEETS_DONT_FIT;
	if (e.message.length <= 32) return e.message;
	return e.field === "backOffset"
		? BACK_OFFSET_OUT_OF_RANGE
		: "Can't lay out the sheets";
}

function sheetError(layout: SheetLayout, e: SheetLayoutError): SheetPlan {
	return {
		layout,
		error: e.message,
		shortError: shortSheetError(e),
		...(e.field ? { field: e.field } : {}),
	};
}

/** How the planned items land on sheets, or why they can't. Null when the
 *  preset is not on sheets. */
export function planSheets(
	plan: readonly ExportItem[],
	template:
		| Pick<Template, "width" | "height" | "bleed" | "variants">
		| undefined,
	preset: ExportPreset,
): SheetPlan | null {
	const layout = sheetLayout(preset);
	if (!layout || !template) return null;
	if (exportSize(preset).kind === "image")
		return {
			layout,
			error: SHEETS_NEED_TEMPLATE_SIZE,
			shortError: SHEETS_NEED_TEMPLATE_SIZE,
		};
	if (plan.some((item) => item.piece !== undefined))
		return planPieceSheets(plan, template, preset, layout);
	const sized = (id?: string) => {
		const size = variantSize(template, id);
		return size.width === template.width && size.height === template.height;
	};
	if (!plan.every((item) => sized(item.variantId)))
		return {
			layout,
			error: SHEETS_NEED_ONE_SIZE,
			shortError: SHEETS_NEED_ONE_SIZE,
		};
	try {
		const imposition = imposeSheets(
			withSideIndex(plan),
			cardSizeMm(template.width, template.height, preset.dpi),
			layout,
			{ bleedMm: presetBleedMm(template, preset) },
		);
		return { layout, imposition };
	} catch (e) {
		if (e instanceof SheetLayoutError) return sheetError(layout, e);
		throw e;
	}
}

/** A plan with pieces on sheets: each is a card of its own size with its bleed
 *  baked in, so all the plan's items must share one size, a side exported
 *  whole being its variant's size with the preset's bleed. */
function planPieceSheets(
	plan: readonly ExportItem[],
	template: Pick<Template, "width" | "height" | "bleed" | "variants">,
	preset: ExportPreset,
	layout: SheetLayout,
): SheetPlan {
	const bleed = presetBleed(template, preset);
	const whole = (item: ExportItem) => {
		const size = variantSize(template, item.variantId);
		return {
			width: size.width + bleed.left + bleed.right,
			height: size.height + bleed.top + bleed.bottom,
		};
	};
	const sizeOf = (item: ExportItem) =>
		item.piece !== undefined && item.pieceSize ? item.pieceSize : whole(item);
	const one = sizeOf(plan[0] as ExportItem);
	const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
	if (
		!plan.every((item) => {
			const size = sizeOf(item);
			return same(size.width, one.width) && same(size.height, one.height);
		})
	)
		return {
			layout,
			error: SHEETS_NEED_ONE_PIECE_SIZE,
			shortError: SHEETS_NEED_ONE_PIECE_SIZE,
		};
	try {
		const imposition = imposeSheets(
			withSideIndex(plan),
			cardSizeMm(one.width, one.height, preset.dpi),
			layout,
		);
		return { layout, imposition };
	} catch (e) {
		if (e instanceof SheetLayoutError) return sheetError(layout, e);
		throw e;
	}
}

/** Pages to a piece of paper: two when backs print. */
export function pagesPerSheet(imposition: Imposition<unknown>): 1 | 2 {
	return imposition.sheets > 0 && imposition.pages.length > imposition.sheets
		? 2
		: 1;
}

/** Whether a slot's item shows this record, and this variant when a token
 *  (the variant's id, or `default`) is given. */
export function showsRecord(
	item: Pick<ExportItem, "recordId" | "variantId">,
	recordId: string | undefined,
	variant?: string,
): boolean {
	return (
		item.recordId === recordId &&
		(variant === undefined ||
			(item.variantId ?? DEFAULT_VARIANT_ID) === variant)
	);
}

/** The sheet (0-based) that holds a record's front, or -1. Under All
 *  variants, `variant` names which of its cards. */
export function sheetOf(
	imposition: Imposition<SheetItem>,
	recordId: string,
	variant?: string,
): number {
	const per = pagesPerSheet(imposition);
	const page = imposition.pages.findIndex((p) =>
		p.slots.some((s) => showsRecord(s.item, recordId, variant)),
	);
	return page < 0 ? -1 : Math.floor(page / per);
}
