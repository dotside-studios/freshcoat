import {
	hasInsets,
	type Sides,
	type Template,
	templateBleed,
	variantSize,
} from "@freshcoat-js/coatfile";
import {
	bleedMm,
	cardSizeMm,
	type Imposition,
	imposeSheets,
	NO_BLEED,
	SheetLayoutError,
} from "../impose";
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

/** What the job bar says for a card that doesn't fit, where the full
 *  message, with both sizes in it, would be cut off. */
export const SHEETS_DONT_FIT = "Doesn't fit the paper";

export type SheetPlan =
	| {
			layout: SheetLayout;
			imposition: Imposition<SheetItem>;
			error?: never;
			shortError?: never;
	  }
	| {
			layout: SheetLayout;
			imposition?: never;
			/** the whole reason, shown inline in the settings */
			error: string;
			/** a few words for the job bar, with `error` on hover */
			shortError: string;
	  };

/** A few words for a layout error, for a bar with no room for the whole
 *  message. */
export function shortSheetError(e: SheetLayoutError): string {
	if (e.axis) return SHEETS_DONT_FIT;
	return e.message.length <= 32 ? e.message : "Can't lay out the sheets";
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
		if (e instanceof SheetLayoutError)
			return { layout, error: e.message, shortError: shortSheetError(e) };
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
		(variant === undefined || (item.variantId ?? "default") === variant)
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
