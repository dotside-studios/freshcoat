import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { type Template, templateBleed } from "@freshcoat-js/coatfile";
import {
	type AssetFile,
	applyMapping,
	autoBinding,
	type Column,
	type ColumnMapping,
	DEFAULT_FILE_NAME_PATTERN,
	DEFAULT_SHEET_LAYOUT,
	type Dataset,
	type DatasetAsset,
	type ExportPreset,
	fileNameTokens,
	headersOf,
	importDefaults,
	newPreset,
	type PaperName,
	prepareAssets,
	unfilledRequired,
	unknownFileNameTokens,
	withFieldSource,
	withVariantSource,
	type Workspace,
} from "@freshcoat-js/workspace";
import { columnsFromTemplate, emptyDataset } from "@freshcoat-js/workspace/dataset";
import { readTable, TabularError } from "@freshcoat-js/workspace/tabular";
import { CliError, createLog, type Io, type Log } from "../io";
import { readBytes, readTemplate, warnLoad } from "../template-file";
import {
	checkValues,
	isLocalImage,
	pickFrames,
	pickVariant,
	readValues,
} from "./render";
import { runPreset, writesFile } from "./workspace";

const ZIP_FORMATS = {
	png: "png-zip",
	jpeg: "jpeg-zip",
	jpg: "jpeg-zip",
	webp: "webp-zip",
} as const;

const MAX_ISSUES = 10;

export type BatchOptions = {
	data?: string;
	out: string;
	values?: string;
	set?: Record<string, string>;
	variant?: string;
	frame?: string[];
	scale?: number[];
	format?: keyof typeof ZIP_FORMATS;
	name?: string;
	quality?: number;
	bleed?: true;
	dpi?: number;
	pdfPages?: "png" | "jpeg" | "vector";
	sheets?: PaperName | { widthMm: number; heightMm: number };
	duplex?: "long" | "short";
	margin?: number;
	gap?: number;
	cropMarks?: boolean;
	dryRun?: true;
	jobs?: number;
	quiet: boolean;
};

export async function renderBatch(
	file: string,
	options: BatchOptions,
	io: Io,
): Promise<void> {
	const log = createLog(io, options.quiet);
	const loaded = await readTemplate(io, file);
	warnLoad(log, file, loaded);
	const { template, directory } = loaded;
	const variantId = pickVariant(template, options.variant);
	const frameNames = pickFrames(template, options.frame);
	if (options.name !== undefined) checkName(template, options.name);
	if (options.bleed && !Object.values(templateBleed(template)).some((side) => side > 0))
		throw new CliError("--bleed needs a template with a bleed");
	const constants = await readValues(io, template, options.values, options.set ?? {});
	const read =
		options.data === undefined
			? {
					...emptyDataset("values", []),
					records: [{ id: "r_00000001", values: {}, status: "pending" as const }],
				}
			: await readDataset(io, log, template, options.data);
	if (options.data === undefined) checkValues(template, constants.values);
	const dataset = { ...read, assets: [...read.assets, ...constants.assets] };

	let binding = autoBinding(template, dataset);
	for (const [key, value] of Object.entries(constants.values))
		binding = withFieldSource(binding, key, {
			kind: "constant",
			value: typeof value === "string" ? value : JSON.stringify(value),
		});
	if (variantId) binding = withVariantSource(binding, { kind: "fixed", id: variantId });

	const templateId = "t_template";
	const workspace: Workspace = {
		formatVersion: "1.0",
		name: template.name,
		templates: [{ id: templateId, fileName: basename(file), template, binding }],
		datasets: [dataset],
		presets: [],
	};
	const missing =
		options.data === undefined
			? []
			: unfilledRequired(template, binding, workspace.datasets);
	if (missing.length > 0)
		log.warn(
			`no column or --set fills the required ${missing.length === 1 ? "field" : "fields"} ${missing.join(", ")}; ${missing.length === 1 ? "it uses its" : "they use their"} default`,
		);

	const pdf = writesFile(options.out) && options.out.toLowerCase().endsWith(".pdf");
	const preset: ExportPreset = {
		...newPreset(templateId, []),
		format: pdf ? "pdf" : ZIP_FORMATS[options.format ?? "png"],
		scale: options.scale?.[0] ?? 1,
		markExported: false,
		fileName:
			options.name ?? (options.data === undefined ? "{{side}}" : DEFAULT_FILE_NAME_PATTERN),
		...(frameNames ? { sides: frameNames } : {}),
		...(options.quality !== undefined ? { quality: options.quality } : {}),
		...(options.bleed ? { bleed: true } : {}),
		...(options.dpi !== undefined ? { dpi: options.dpi } : {}),
		...(options.pdfPages ? { pdfPageImage: options.pdfPages } : {}),
		...(options.sheets
			? {
					layout: {
						...DEFAULT_SHEET_LAYOUT,
						paper: options.sheets,
						cropMarks: options.cropMarks ?? true,
						duplex: options.duplex ? `${options.duplex}-edge` : "none",
						...(options.margin !== undefined ? { marginMm: options.margin } : {}),
						...(options.gap !== undefined ? { gapMm: options.gap } : {}),
					},
				}
			: {}),
	};
	await runPreset(
		workspace,
		preset,
		{
			root: directory,
			out: options.out,
			...(options.dryRun ? { dryRun: true } : {}),
			...(options.jobs ? { jobs: options.jobs } : {}),
		},
		log,
		io,
	);
}

function checkName(template: Template, pattern: string): void {
	const unknown = unknownFileNameTokens(pattern, template);
	if (unknown.length > 0)
		throw new CliError(
			`--name has no ${unknown.map((token) => `{{${token}}}`).join(", ")}; it takes ${fileNameTokens(template).map((token) => `{{${token}}}`).join(", ")}`,
		);
}

async function readDataset(
	io: Io,
	log: Log,
	template: Template,
	file: string,
): Promise<Dataset> {
	const bytes = await readBytes(io, file);
	let sheets: Awaited<ReturnType<typeof readTable>>["sheets"];
	try {
		({ sheets } = await readTable(bytes, file));
	} catch (error) {
		if (error instanceof TabularError) throw new CliError(`${file}: ${error.message}`);
		throw error;
	}
	const wanted = columnsFromTemplate(template);
	const start = importDefaults(sheets, wanted);
	const sheet = sheets[start.sheetIndex];
	if (!sheet) throw new CliError(`${file} has no rows`);
	if (sheets.length > 1)
		log.warn(
			`${file}: reading only the ${start.sheetIndex === 0 ? "first sheet" : "first sheet with rows"}, ${sheet.name}`,
		);

	const { headerRow } = start;
	const headers = headersOf(sheet.rows, headerRow);
	const mapping = start.mapping.map(
		(entry): ColumnMapping => (entry.kind === "new" ? { kind: "skip" } : entry),
	);
	const unused = headers.filter(
		(header, i) => header !== "" && mapping[i]?.kind === "skip",
	);
	if (unused.length > 0)
		log.warn(
			`${file}: no field matches the ${unused.length === 1 ? "column" : "columns"} ${unused.join(", ")}`,
		);
	const used = new Set(
		mapping.flatMap((entry) => (entry.kind === "column" ? [entry.column] : [])),
	);
	const columns = wanted.filter((column) => used.has(column.key));

	const directory = dirname(resolve(io.cwd, file));
	const empty = {
		...emptyDataset(basename(file), columns),
		assets: await readPhotos(directory, sheet.rows.slice(headerRow + 1), mapping, columns),
	};
	const { dataset, issues } = applyMapping(empty, sheet.rows, {
		headerRow,
		mapping,
		mode: "replace",
		dateOrder: start.dateOrder,
	});
	for (const issue of issues.slice(0, MAX_ISSUES))
		log.warn(`${file}: row ${issue.row + 1}, ${issue.column}: ${issue.message}`);
	if (issues.length > MAX_ISSUES)
		log.warn(`${file}: ${issues.length - MAX_ISSUES} more issues`);
	if (dataset.records.length === 0) throw new CliError(`${file} has no records`);
	return dataset;
}

async function readPhotos(
	directory: string,
	rows: readonly (readonly string[])[],
	mapping: readonly ColumnMapping[],
	columns: readonly Column[],
): Promise<DatasetAsset[]> {
	const images = new Set(
		columns.filter((column) => column.type === "image").map((column) => column.key),
	);
	const names = new Set<string>();
	mapping.forEach((entry, i) => {
		if (entry.kind !== "column" || !images.has(entry.column)) return;
		for (const row of rows) {
			const name = (row[i] ?? "").trim();
			if (isLocalImage(name)) names.add(name);
		}
	});
	const files: AssetFile[] = [];
	for (const name of names) {
		const path = resolve(directory, name);
		const inside = relative(directory, path);
		if (inside.startsWith("..") || isAbsolute(inside)) continue;
		try {
			files.push({ name, blob: new Blob([await readFile(path)]) });
		} catch {}
	}
	return (await prepareAssets(files)).map((prepared) => prepared.asset);
}
