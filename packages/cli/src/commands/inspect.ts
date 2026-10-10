import {
	childElements,
	type Element,
	type Template,
	variantSize,
} from "@freshcoat-js/coatfile";
import {
	readsDataset,
	type RecordStatus,
	sheetSummary,
	unfilledRequired,
	type Workspace,
} from "@freshcoat-js/workspace";
import { WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { presetReadiness } from "@freshcoat-js/workspace/export";
import { type FontSummary, summarizeFonts } from "../fonts";
import { createLog, type Io } from "../io";
import { readTemplate, warnLoad } from "../template-file";
import { readWorkspace } from "../workspace-file";

export type Inspection = {
	file: string;
	id: string;
	name: string;
	formatVersion: string;
	product?: string;
	width: number;
	height: number;
	frames: { name: string; width: number; height: number; elements: number }[];
	fields: {
		key: string;
		type: string;
		format?: string;
		title?: string;
		required: boolean;
		default?: string;
	}[];
	variants: { id: string; label: string; width: number; height: number }[];
	fonts: FontSummary[];
};

export function inspectTemplate(file: string, template: Template): Inspection {
	const required = new Set(template.fields.required ?? []);
	return {
		file,
		id: template.id,
		name: template.name,
		formatVersion: template.format_version,
		...(template.product ? { product: template.product } : {}),
		width: template.width,
		height: template.height,
		frames: template.template_data.map((frame) => ({
			name: frame.name,
			width: template.width,
			height: template.height,
			elements: frame.elements.reduce((sum, el) => sum + countElements(el), 0),
		})),
		fields: Object.entries(template.fields.properties).map(([key, field]) => ({
			key,
			type: field.type,
			...(field.format ? { format: field.format } : {}),
			...(field.title ? { title: field.title } : {}),
			required: required.has(key),
			...(field.default !== undefined ? { default: field.default } : {}),
		})),
		variants: (template.variants ?? []).map((variant) => ({
			id: variant.id,
			label: variant.label,
			...variantSize(template, variant.id),
		})),
		fonts: summarizeFonts(template),
	};
}

function countElements(element: Element): number {
	return 1 + childElements(element).reduce((n, c) => n + countElements(c), 0);
}

export type WorkspaceInspection = {
	file: string;
	name: string;
	formatVersion: string;
	templates: {
		id: string;
		fileName: string;
		dataset?: string;
		unfilled: string[];
		template: Inspection;
	}[];
	datasets: {
		id: string;
		name: string;
		records: number;
		statuses: Partial<Record<RecordStatus, number>>;
		columns: { key: string; type: string }[];
	}[];
	presets: {
		id: string;
		name: string;
		template: string;
		format: string;
		records: string;
		items: number;
		sheets?: string;
		error?: string;
	}[];
};

export function inspectWorkspace(file: string, workspace: Workspace): WorkspaceInspection {
	return {
		file,
		name: workspace.name,
		formatVersion: workspace.formatVersion,
		templates: workspace.templates.map((entry) => ({
			id: entry.id,
			fileName: entry.fileName,
			...(readsDataset(entry.binding) ? { dataset: entry.binding.datasetId } : {}),
			unfilled: unfilledRequired(entry.template, entry.binding, workspace.datasets),
			template: inspectTemplate(entry.fileName, entry.template),
		})),
		datasets: workspace.datasets.map((dataset) => {
			const statuses: Partial<Record<RecordStatus, number>> = {};
			for (const record of dataset.records)
				statuses[record.status] = (statuses[record.status] ?? 0) + 1;
			return {
				id: dataset.id,
				name: dataset.name,
				records: dataset.records.length,
				statuses,
				columns: dataset.columns.map((column) => ({ key: column.key, type: column.type })),
			};
		}),
		presets: workspace.presets.map((preset) => {
			const { entry, plan, sheets } = presetReadiness(workspace, preset);
			return {
				id: preset.id,
				name: preset.name,
				template: entry?.fileName ?? preset.templateId,
				format: preset.format,
				records: preset.records,
				items: plan.length,
				...(sheets?.imposition ? { sheets: sheetSummary(sheets.imposition) } : {}),
				...(sheets?.error !== undefined ? { error: sheets.error } : {}),
				...(!entry ? { error: "its template is not in the workspace" } : {}),
			};
		}),
	};
}

export async function inspect(
	file: string,
	options: { json?: true; quiet?: boolean },
	io: Io,
): Promise<void> {
	let info: Inspection | WorkspaceInspection;
	let text: string;
	if (file.toLowerCase().endsWith(WORKSPACE_EXTENSION)) {
		const { workspace } = await readWorkspace(io, file);
		const read = inspectWorkspace(file, workspace);
		[info, text] = [read, describeWorkspace(read)];
	} else {
		const loaded = await readTemplate(io, file);
		warnLoad(createLog(io, options.quiet === true), file, loaded);
		const { template } = loaded;
		const read = inspectTemplate(file, template);
		[info, text] = [read, describe(read)];
	}
	io.stdout(options.json ? `${JSON.stringify(info, null, 2)}\n` : `${text}\n`);
}

function describeWorkspace(info: WorkspaceInspection): string {
	const datasetName = (id: string) =>
		info.datasets.find((dataset) => dataset.id === id)?.name ?? id;
	const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
	const lines = [
		`${info.name} (${info.file})`,
		`  format ${info.formatVersion}`,
		"",
		"Templates",
		...info.templates.flatMap((t) => [
			`  ${t.fileName}  ${t.template.name} (${t.template.id})  ${t.template.width} x ${t.template.height}  ${plural(t.template.frames.length, "frame")}, ${plural(t.template.variants.length, "variant")}  ${t.dataset ? `bound to ${datasetName(t.dataset)}` : "not bound"}`,
			...(t.unfilled.length > 0
				? [`    no column fills ${t.unfilled.join(", ")}`]
				: []),
		]),
		"",
		"Datasets",
		...(info.datasets.length === 0
			? ["  none"]
			: info.datasets.map((d) => {
					const statuses = Object.entries(d.statuses)
						.map(([status, n]) => `${n} ${status}`)
						.join(", ");
					return `  ${d.name} (${d.id})  ${plural(d.records, "record")}${statuses ? `: ${statuses}` : ""}  ${plural(d.columns.length, "column")}`;
				})),
		"",
		"Presets",
		...(info.presets.length === 0
			? ["  none"]
			: info.presets.map(
					(p) =>
						`  ${p.name} (${p.id})  ${p.template}  ${p.format}, ${p.records} records  ${plural(p.items, "item")}${p.sheets ? `  ${p.sheets}` : ""}${p.error ? `  ${p.error}` : ""}`,
				)),
	];
	return lines.join("\n");
}

function describe(info: Inspection): string {
	const lines = [
		`${info.name} (${info.id})`,
		`  format ${info.formatVersion}, ${info.width} x ${info.height}${info.product ? `, product ${info.product}` : ""}`,
		"",
		"Frames",
		...info.frames.map(
			(f) =>
				`  ${f.name}  ${f.width} x ${f.height}  ${f.elements} ${f.elements === 1 ? "element" : "elements"}`,
		),
		"",
		"Fields",
		...(info.fields.length === 0
			? ["  none"]
			: info.fields.map((f) => {
					const notes = [
						f.format ?? f.type,
						f.required ? "required" : undefined,
						f.default !== undefined ? `default ${JSON.stringify(f.default)}` : undefined,
					].filter(Boolean);
					return `  ${f.key}  ${notes.join(", ")}`;
				})),
		"",
		"Variants",
		...(info.variants.length === 0
			? ["  none"]
			: info.variants.map(
					(v) => `  ${v.id}  ${v.label}  ${v.width} x ${v.height}`,
				)),
		"",
		"Fonts",
		...(info.fonts.length === 0
			? ["  none"]
			: info.fonts.map(
					(f) =>
						`  ${f.family}  ${f.weights.join(", ")}${f.italic ? " italic" : ""}  ${f.declared ? "declared" : "not declared"}`,
				)),
	];
	return lines.join("\n");
}
