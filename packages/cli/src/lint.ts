import {
	DEFAULT_IMAGE_DPI_UNITS,
	DEFAULT_MIN_IMAGE_DPI,
	type ImageDpiOptions,
	type Template,
	templateHints,
	validate,
} from "@freshcoat-js/coatfile";
import {
	bindingView,
	readsDataset,
	unfilledRequired,
	type Workspace,
} from "@freshcoat-js/workspace";
import { presetReadiness } from "@freshcoat-js/workspace/export";
import { formatIssue, newerFormatWarning } from "./template-file";

export type Findings = { errors: string[]; warnings: string[] };

/** The resolution check `validate` runs: `dpi` design units to the inch,
 *  flagging images under `min`. */
export type DpiCheck = { dpi?: number; min?: number };

export function templateWarnings(template: Template, images: ImageDpiOptions = {}): string[] {
	return templateHints(template, images).map((hint) => {
		switch (hint.kind) {
			case "variant":
				return `${hint.issue.message} (${hint.issue.code})`;
			case "safe_area": {
				const { sideName, id, edges } = hint;
				return `${sideName}: "${id}" has its ${andList(edges)} ${edges.length === 1 ? "edge" : "edges"} inside the safe area`;
			}
			case "image_dpi":
				return `${hint.sideName}: "${hint.id}" prints at ${hint.dpi} DPI, under ${hint.min}`;
			case "format_newer":
				return newerFormatWarning(hint.declared);
			case "format_low":
				return `uses fields from format ${hint.needed} but declares ${hint.declared}; older readers drop them`;
			case "slice_open_piece":
				return `${hint.sideName}: "${hint.id}" is an open path, so it exports as a cut line, not a piece`;
		}
	});
}

function andList(items: readonly string[]): string {
	return items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The check a workspace template gets: its presets' lowest DPI and highest
 *  minimum, unless the command line names them. */
function presetDpiCheck(workspace: Workspace, templateId: string, given: DpiCheck): DpiCheck {
	const presets = workspace.presets.filter((preset) => preset.templateId === templateId);
	return {
		dpi: given.dpi ?? (presets.length > 0 ? Math.min(...presets.map((p) => p.dpi)) : DEFAULT_IMAGE_DPI_UNITS),
		min:
			given.min ??
			(presets.length > 0
				? Math.max(...presets.map((p) => p.minImageDpi ?? DEFAULT_MIN_IMAGE_DPI))
				: DEFAULT_MIN_IMAGE_DPI),
	};
}

export function workspaceFindings(workspace: Workspace, dpi: DpiCheck = {}): Findings {
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const entry of workspace.templates) {
		const checked = validate(entry.template);
		if (!checked.ok)
			errors.push(...checked.errors.map((issue) => `${entry.fileName}: ${formatIssue(issue)}`));
		const images = presetDpiCheck(workspace, entry.id, dpi);
		warnings.push(...templateWarnings(entry.template, images).map((w) => `${entry.fileName}: ${w}`));
		const binding = entry.binding;
		if (!readsDataset(binding)) continue;
		if (!workspace.datasets.some((dataset) => dataset.id === binding.datasetId)) {
			errors.push(`${entry.fileName}: bound to a dataset the workspace does not have`);
			continue;
		}
		const view = bindingView(binding, workspace.datasets);
		errors.push(...(view?.problems ?? []).map((p) => `${entry.fileName}: records view: ${p}`));
		if (view && view.duplicateKeys.length > 0)
			warnings.push(
				`${entry.fileName}: records view: the joined dataset has more than one record for ${view.duplicateKeys.map((k) => `"${k}"`).join(", ")}; the first is used`,
			);
		const unfilled = unfilledRequired(entry.template, binding, workspace.datasets);
		if (unfilled.length > 0)
			warnings.push(
				`${entry.fileName}: no column fills the required ${unfilled.length === 1 ? "field" : "fields"} ${unfilled.join(", ")}`,
			);
	}
	for (const preset of workspace.presets) {
		const { blocked, sheets } = presetReadiness(workspace, preset);
		if (blocked?.reason === "missing_template") {
			errors.push(`preset "${preset.name}": its template is not in the workspace`);
			continue;
		}
		if (sheets?.error !== undefined)
			errors.push(`preset "${preset.name}": ${sheets.error}`);
	}
	return { errors, warnings };
}
