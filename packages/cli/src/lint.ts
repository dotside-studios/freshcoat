import { type Template, templateHints, validate } from "@freshcoat-js/coatfile";
import {
	planExport,
	readsDataset,
	unfilledRequired,
	type Workspace,
} from "@freshcoat-js/workspace";
import { planSheets } from "@freshcoat-js/workspace/export";
import { formatIssue, newerFormatWarning } from "./template-file";

export type Findings = { errors: string[]; warnings: string[] };

export function templateWarnings(template: Template): string[] {
	return templateHints(template).map((hint) => {
		switch (hint.kind) {
			case "variant":
				return `${hint.issue.message} (${hint.issue.code})`;
			case "safe_area": {
				const { sideName, id, edges } = hint;
				return `${sideName}: "${id}" has its ${andList(edges)} ${edges.length === 1 ? "edge" : "edges"} inside the safe area`;
			}
			case "format_newer":
				return newerFormatWarning(hint.declared);
			case "format_low":
				return `uses fields from format ${hint.needed} but declares ${hint.declared}; older readers drop them`;
		}
	});
}

function andList(items: readonly string[]): string {
	return items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function workspaceFindings(workspace: Workspace): Findings {
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const entry of workspace.templates) {
		const checked = validate(entry.template);
		if (!checked.ok)
			errors.push(...checked.errors.map((issue) => `${entry.fileName}: ${formatIssue(issue)}`));
		warnings.push(...templateWarnings(entry.template).map((w) => `${entry.fileName}: ${w}`));
		const binding = entry.binding;
		if (!readsDataset(binding)) continue;
		if (!workspace.datasets.some((dataset) => dataset.id === binding.datasetId)) {
			errors.push(`${entry.fileName}: bound to a dataset the workspace does not have`);
			continue;
		}
		const unfilled = unfilledRequired(entry.template, binding, workspace.datasets);
		if (unfilled.length > 0)
			warnings.push(
				`${entry.fileName}: no column fills the required ${unfilled.length === 1 ? "field" : "fields"} ${unfilled.join(", ")}`,
			);
	}
	for (const preset of workspace.presets) {
		const entry = workspace.templates.find((t) => t.id === preset.templateId);
		if (!entry) {
			errors.push(`preset "${preset.name}": its template is not in the workspace`);
			continue;
		}
		const sheets = planSheets(planExport(workspace, preset), entry.template, preset);
		if (sheets?.error !== undefined)
			errors.push(`preset "${preset.name}": ${sheets.error}`);
	}
	return { errors, warnings };
}
