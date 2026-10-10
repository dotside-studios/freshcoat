import {
	checkVariants,
	formatVersionStatus,
	minimumFormatVersion,
	safeAreaIssues,
	type Template,
	validate,
} from "@freshcoat-js/coatfile";
import {
	planExport,
	readsDataset,
	unfilledRequired,
	type Workspace,
} from "@freshcoat-js/workspace";
import { planSheets } from "@freshcoat-js/workspace/export";
import { formatIssue } from "./template-file";

export type Findings = { errors: string[]; warnings: string[] };

export function templateWarnings(template: Template): string[] {
	const warnings = checkVariants(template).map(
		(issue) => `${issue.message} (${issue.code})`,
	);
	for (const { side, id, edges } of safeAreaIssues(template)) {
		const frame = template.template_data[side]?.name ?? String(side);
		warnings.push(
			`${frame}: "${id}" has its ${andList(edges)} ${edges.length === 1 ? "edge" : "edges"} inside the safe area`,
		);
	}
	const declared = template.format_version;
	if (formatVersionStatus(declared) === "newer")
		warnings.push(
			`format_version ${declared} is newer than this freshcoat reads; fields it adds are ignored`,
		);
	const needed = minimumFormatVersion(template);
	if (minor(needed) > minor(declared))
		warnings.push(
			`uses fields from format ${needed} but declares ${declared}; older readers drop them`,
		);
	return warnings;
}

function andList(items: readonly string[]): string {
	return items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function minor(version: string): number {
	return Number(/^\d+\.(\d+)/.exec(version)?.[1] ?? 0);
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
