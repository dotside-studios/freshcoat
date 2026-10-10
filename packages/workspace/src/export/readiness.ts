import { validate } from "@freshcoat-js/coatfile";
import { unfilledRequired } from "../binding";
import { planExport } from "../plan";
import type {
	ExportItem,
	ExportPreset,
	TemplateEntry,
	Workspace,
} from "../types";
import { planSheets, type SheetPlan } from "./sheets";

/** Why a preset can't run, as data: the caller words it. */
export type PresetBlock = {
	reason: "missing_template" | "template_issues" | "sheets" | "nothing";
	/** A few words for a button or a bar. */
	message: string;
	/** The whole reason, when `message` is short of it. */
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
	/** Why the export can't run, or null when it can. */
	blocked: PresetBlock | null;
};

/**
 * Whether a preset can run, and what stands in the way, in the order Studio's
 * Export button checks: the template is missing, the template has issues, the
 * sheets don't lay out, there is nothing to export. `plan` is the preset's own
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
	return {
		entry,
		plan,
		sheets,
		issues,
		unfilled,
		blocked: blockOf(entry, issues, sheets, plan),
	};
}

function blockOf(
	entry: TemplateEntry | undefined,
	issues: number,
	sheets: SheetPlan | null,
	plan: readonly ExportItem[],
): PresetBlock | null {
	if (!entry)
		return { reason: "missing_template", message: "Template not in workspace" };
	if (issues > 0)
		return {
			reason: "template_issues",
			message: `Template has ${issues} ${issues === 1 ? "issue" : "issues"}`,
		};
	if (sheets?.error)
		return {
			reason: "sheets",
			message: sheets.shortError,
			detail: sheets.error,
		};
	if (plan.length === 0)
		return { reason: "nothing", message: "Nothing to export" };
	return null;
}
