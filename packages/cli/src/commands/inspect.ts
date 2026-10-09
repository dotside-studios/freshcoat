import {
	childElements,
	type Element,
	type Template,
	variantSize,
} from "@freshcoat-js/coatfile";
import { type FontSummary, summarizeFonts } from "../fonts";
import type { Io } from "../io";
import { readTemplate } from "../template-file";

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

export async function inspect(
	file: string,
	options: { json?: true },
	io: Io,
): Promise<void> {
	const { template } = await readTemplate(io, file);
	const info = inspectTemplate(file, template);
	io.stdout(
		options.json ? `${JSON.stringify(info, null, 2)}\n` : `${describe(info)}\n`,
	);
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
