import { type Template, validate } from "@freshcoat-js/coatfile";
import { unfilledRequired } from "../binding";
import { planExport, vectorPages } from "../plan";
import type {
	ExportItem,
	ExportPreset,
	TemplateEntry,
	Workspace,
} from "../types";
import { bindingView } from "../view";
import { PIECES_NEED_RASTER_PAGES } from "./item";
import { printRequest } from "./print";
import { planSheets, type SheetPlan } from "./sheets";

/** Why a preset can't run, as data: the caller words it. */
export type PresetBlock = {
	reason:
		| "missing_template"
		| "template_issues"
		| "view"
		| "sheets"
		| "pieces"
		| "nothing";
	/** A few words for a button or a bar. */
	message: string;
	/** The whole reason, when `message` is short of it. */
	detail?: string;
};

/** What the export will do that its settings don't show: it still runs. */
export type PresetNotice = {
	reason: "print_raster" | "spot_raster";
	message: string;
	detail?: string;
};

export type PresetReadiness = {
	/** The template the preset exports; absent when the workspace lacks it. */
	entry: TemplateEntry | undefined;
	plan: ExportItem[];
	/** How the plan lands on sheets; null when the preset is not on sheets. */
	sheets: SheetPlan | null;
	/** The template's validation issues. */
	issues: number;
	/** The required fields no column fills. */
	unfilled: string[];
	/** Why the binding's view cannot be applied. */
	viewProblems: string[];
	/** Why the export can't run, or null when it can. */
	blocked: PresetBlock | null;
	notices: PresetNotice[];
};

/**
 * Whether a preset can run, and what stands in the way, in the order Studio's
 * Export button checks: the template is missing, the template has issues, the
 * binding's view cannot be applied, the sheets don't lay out, pieces are
 * asked of vector pages, there is nothing to export. `plan` is the preset's own
 * unless the caller already holds one, such as the plan of chosen records.
 */
export function presetReadiness(
	workspace: Workspace,
	preset: ExportPreset,
	plan: ExportItem[] = planExport(workspace, preset),
): PresetReadiness {
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	const sheets = planSheets(plan, entry?.template, preset);
	const checked = entry ? validate(entry.template) : null;
	const issues = checked && !checked.ok ? checked.errors.length : 0;
	const unfilled = entry
		? unfilledRequired(entry.template, entry.binding, workspace.datasets)
		: [];
	const viewProblems =
		bindingView(entry?.binding, workspace.datasets)?.problems ?? [];
	return {
		entry,
		plan,
		sheets,
		issues,
		unfilled,
		viewProblems,
		blocked: blockOf(entry, issues, viewProblems, sheets, plan, preset),
		notices: noticesOf(entry?.template, preset),
	};
}

/** The spot inks a template's layers print in, each once, in layer order. */
export function templateSpotInks(template: Template): string[] {
	const inks = new Set<string>();
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (node === null || typeof node !== "object") return;
		const o = node as Record<string, unknown>;
		const spot = (o.properties as Record<string, unknown> | undefined)?.spot as
			| { fill?: { spot?: unknown }; stroke?: { spot?: unknown } }
			| undefined;
		for (const ink of [spot?.fill?.spot, spot?.stroke?.spot])
			if (typeof ink === "string" && ink !== "") inks.add(ink);
		for (const value of Object.values(o)) visit(value);
	};
	visit(template.template_data);
	visit(template.variants);
	return [...inks];
}

function noticesOf(
	template: Template | undefined,
	preset: ExportPreset,
): PresetNotice[] {
	const notices: PresetNotice[] = [];
	const print = printRequest(preset.print) !== undefined;
	if (vectorPages(preset) && print)
		notices.push({
			reason: "print_raster",
			message: "Print target draws PDF pages as PNG, not vector",
			detail:
				"The printer's color correction works on pixels, so each page is rendered as an image. Set the print target to None for vector pages.",
		});
	const inks = template ? templateSpotInks(template) : [];
	if (inks.length > 0 && !(vectorPages(preset) && !print))
		notices.push({
			reason: "spot_raster",
			message: `Spot ${inks.length === 1 ? "ink" : "inks"} ${inks.join(", ")} ${inks.length === 1 ? "prints" : "print"} as plain color`,
			detail:
				"Spot inks are written only on vector PDF pages; PNG, JPEG and WebP output draws each in its alternate color.",
		});
	return notices;
}

function blockOf(
	entry: TemplateEntry | undefined,
	issues: number,
	viewProblems: readonly string[],
	sheets: SheetPlan | null,
	plan: readonly ExportItem[],
	preset: ExportPreset,
): PresetBlock | null {
	if (!entry)
		return { reason: "missing_template", message: "Template not in workspace" };
	if (issues > 0)
		return {
			reason: "template_issues",
			message: `Template has ${issues} ${issues === 1 ? "issue" : "issues"}`,
		};
	if (viewProblems.length > 0)
		return {
			reason: "view",
			message: "Records view has problems",
			detail: viewProblems.join("; "),
		};
	if (sheets?.error)
		return {
			reason: "sheets",
			message: sheets.shortError,
			detail: sheets.error,
		};
	if (vectorPages(preset) && plan.some((item) => item.piece !== undefined))
		return { reason: "pieces", message: PIECES_NEED_RASTER_PAGES };
	if (plan.length === 0)
		return { reason: "nothing", message: "Nothing to export" };
	return null;
}
