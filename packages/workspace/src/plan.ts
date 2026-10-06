import type { Template } from "@freshcoat-js/coatfile";
import { columnsByKey, resolveValues, variantsFor } from "./binding";
import { toTemplateValue } from "./columns";
import type {
	DataRecord,
	Dataset,
	ExportFormat,
	ExportItem,
	ExportPreset,
	ExportSize,
	PdfLayout,
	Workspace,
} from "./types";

export const DEFAULT_FILE_NAME_PATTERN = "{{template}}-{{index}}-{{side}}";
export const DEFAULT_DPI = 300;

export const DEFAULT_QUALITY = 90;

/** A preset's size; a preset from before sizes follows the template. */
export function exportSize(preset: Pick<ExportPreset, "size">): ExportSize {
	return preset.size ?? { kind: "template" };
}

/** How a PDF preset places its images; a preset from before layouts puts
 *  one on each page. */
export function pdfLayout(preset: Pick<ExportPreset, "layout">): PdfLayout {
	return preset.layout ?? { kind: "single" };
}

/** What one output file is encoded as. A PDF's pages are PNGs unless the
 *  preset asks for JPEG pages. */
export function imageFormat(
	preset: Pick<ExportPreset, "format" | "pdfPageImage">,
): "png" | "jpeg" | "webp" {
	switch (preset.format) {
		case "jpeg-zip":
			return "jpeg";
		case "webp-zip":
			return "webp";
		case "pdf":
			return preset.pdfPageImage === "jpeg" ? "jpeg" : "png";
		default:
			return "png";
	}
}

/** The extension of each file in a zip of this format. */
export function fileExtension(format: ExportFormat): string {
	switch (format) {
		case "jpeg-zip":
			return "jpg";
		case "webp-zip":
			return "webp";
		default:
			return "png";
	}
}

/** The density a PDF's PNGs render at so each page holds real pixels for its
 *  DPI: CSS pixels are 96 to the inch. */
export function pdfRenderScale(dpi: number): number {
	return Math.min(4, Math.max(1, dpi / 96));
}

export type FileNameContext = {
	template: string;
	side: string;
	/** 1-based */
	index: number;
	/** how many records the plan holds; `{{index}}` is padded to its width */
	count: number;
	record: string;
	/** the variant's id; absent or undefined is Default, named `default` */
	variant?: string;
	/** column key -> cell text */
	cells?: Record<string, string>;
	/** template field key -> value, for tokens that name no column */
	values?: Record<string, string>;
};

const VARIANT_TOKEN = /\{\{\s*variant\s*\}\}/;

/** The pattern an export names its files with. The empty pattern is the
 *  default one, and when every variant is exported a pattern that does not
 *  name the variant gets `-{{variant}}` appended, so no two files share a
 *  name. */
export function fileNamePattern(pattern: string, everyVariant = false): string {
	const source = pattern.trim() === "" ? DEFAULT_FILE_NAME_PATTERN : pattern;
	return everyVariant && !VARIANT_TOKEN.test(source)
		? `${source}-{{variant}}`
		: source;
}

/** The extensions a photo arrives with. A value ending in one is a photo's
 *  own file name, and the output's format supplies the extension instead. */
const SOURCE_EXTENSION =
	/\.(jpe?g|jfif|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i;

/** A file name from a pattern, without an extension. A token whose value is
 *  a photo's file name loses that extension, so `{{file_name}}` names the
 *  output after its photo. Every character outside `[A-Za-z0-9_.-]` becomes
 *  `-`. */
export function fileNameFor(pattern: string, ctx: FileNameContext): string {
	return expandFileName(fileNamePattern(pattern), ctx);
}

function expandFileName(source: string, ctx: FileNameContext): string {
	const width = String(Math.max(ctx.count, 1)).length;
	const expanded = source.replace(
		/\{\{\s*([^{}]*?)\s*\}\}/g,
		(_, token: string) => {
			switch (token) {
				case "template":
					return ctx.template;
				case "side":
					return ctx.side;
				case "index":
					return String(ctx.index).padStart(width, "0");
				case "record":
					return ctx.record;
				case "variant":
					return ctx.variant ?? "default";
				default:
					return (ctx.cells?.[token] ?? ctx.values?.[token] ?? "").replace(
						SOURCE_EXTENSION,
						"",
					);
			}
		},
	);
	const clean = expanded.replace(/[^\w.-]/g, "-");
	return clean === "" || /^\.+$/.test(clean) ? "file" : clean;
}

function selectRecords(dataset: Dataset, preset: ExportPreset): DataRecord[] {
	switch (preset.records) {
		case "all":
			return dataset.records.filter((r) => r.status !== "skipped");
		case "pending":
			return dataset.records.filter((r) => r.status === "pending");
		case "failed":
			return dataset.records.filter((r) => r.status === "failed");
		case "selected": {
			const wanted = new Set(preset.selected ?? []);
			return dataset.records.filter((r) => wanted.has(r.id));
		}
	}
}

function sidesOf(template: Template, preset: ExportPreset): string[] {
	const names = template.template_data.map((frame) => frame.name);
	if (preset.sides === "all") return names;
	const wanted = new Set(preset.sides);
	return names.filter((name) => wanted.has(name));
}

/**
 * One item per selected record and side, in record order then side order,
 * with the values and variant each renders with and a unique file name. A
 * template with no binding, or bound to a dataset that is gone, plans one item
 * per side with its defaults, in the variant its binding fixes. An unknown
 * template plans nothing.
 *
 * When the binding's variant source is `all`, each record is planned once per
 * variant `variantsFor` lists (Default, then every variant that changes
 * something), each with all its sides before the next variant's. Those items'
 * keys end in the variant (`default` for Default), and their file names carry
 * it (`fileNamePattern`).
 */
export function planExport(
	workspace: Workspace,
	preset: ExportPreset,
): ExportItem[] {
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	if (entry === undefined) return [];
	const { template, binding } = entry;
	const dataset = binding
		? workspace.datasets.find((d) => d.id === binding.datasetId)
		: undefined;
	const sides = sidesOf(template, preset);
	const records: (DataRecord | undefined)[] = dataset
		? selectRecords(dataset, preset)
		: [undefined];
	// A size from an image is the photo's own pixels, so there is no density
	// to name.
	const suffix =
		preset.scale === 1 || exportSize(preset).kind === "image"
			? ""
			: `@${preset.scale}x`;
	const extension = fileExtension(preset.format);
	const everyVariant = binding?.variant?.kind === "all";
	const pattern = fileNamePattern(preset.fileName, everyVariant);
	const columns = dataset ? columnsByKey(dataset) : undefined;

	const used = new Set<string>();
	const unique = (base: string) => {
		let name = base;
		for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
		used.add(name.toLowerCase());
		return name;
	};

	const items: ExportItem[] = [];
	records.forEach((record, recordIndex) => {
		const values = dataset
			? resolveValues(template, binding, dataset, record, recordIndex, columns)
			: resolveValues(template, undefined, undefined, undefined, recordIndex);
		const variantIds = variantsFor(template, binding, dataset, record, columns);
		const cells: Record<string, string> = {};
		if (dataset && record) {
			for (const column of dataset.columns) {
				cells[column.key] = toTemplateValue(
					column,
					record.values[column.key] ?? null,
				);
			}
		}
		const recordId = record?.id ?? "";
		for (const variantId of variantIds) {
			for (const side of sides) {
				const base = expandFileName(pattern, {
					template: template.id,
					side,
					index: recordIndex + 1,
					count: records.length,
					record: recordId,
					variant: variantId,
					cells,
					values,
				});
				items.push({
					key: everyVariant
						? `${recordId}:${side}:${variantId ?? "default"}`
						: `${recordId}:${side}`,
					recordId,
					recordIndex,
					side,
					fileName: `${unique(base)}${suffix}.${extension}`,
					values,
					...(variantId !== undefined ? { variantId } : {}),
				});
			}
		}
	});
	return items;
}
