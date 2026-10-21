import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import type { Template } from "@freshcoat-js/coatfile";
import { resolveTemplateFonts } from "@freshcoat-js/coatfile";
import {
	type CutSpots,
	type ExportPreset,
	exportCutFile,
	exportCutLines,
	readsDataset,
	SheetLayoutError,
	sheetSummary,
	type ViewFilter,
	type Workspace,
	withView,
} from "@freshcoat-js/workspace";
import { packWorkspace } from "@freshcoat-js/workspace/archive";
import {
	describeRasterized,
	exportWorkspace,
	findPreset,
	type JobProgress,
	largestImagePixels,
	type PresetReadiness,
	presetReadiness,
	type SheetPlan,
	sheetLayout,
} from "@freshcoat-js/workspace/export";
import { fileOutput, folderOutput } from "@freshcoat-js/workspace/node";
import { fontFetch, withFetch } from "../font-cache";
import { warnAboutFonts, warnAboutGlyphs } from "../fonts";
import { CliError, createLog, type Io, type Log, UsageError } from "../io";
import { createLoader, openRenderer } from "../renderer";
import { version } from "../version";
import { poolSize, startWorkerPool } from "../worker-pool";
import { readWorkspace } from "../workspace-file";

/** A PDF holds every rendered page in memory until it is assembled. */
export const DEFAULT_MAX_PDF_PAGES = 2000;

export type WorkspaceOptions = {
	preset?: string;
	out: string;
	records?: "all" | "pending" | "failed";
	save?: true;
	where?: ViewFilter[];
	dryRun?: true;
	jobs?: number;
	pieces?: true;
	cut?: "svg" | "dxf";
	cutLines?: true;
	cutSpot?: CutSpots;
	minDpi?: number;
	maxPdfPages?: number;
	quiet: boolean;
};

export async function renderWorkspace(
	file: string,
	options: WorkspaceOptions,
	io: Io,
): Promise<void> {
	const log = createLog(io, options.quiet);

	const path = resolve(io.cwd, file);
	const { workspace, warnings } = await readWorkspace(io, file);
	for (const warning of warnings) log.warn(`${file}: ${warning}`);

	if (options.preset === undefined)
		throw new UsageError(
			`a .coatworkspace needs --preset <name|id>${presetList(workspace.presets)}`,
		);
	const preset = findPreset(workspace, options.preset);
	if (!preset)
		throw new CliError(presetMessage(workspace.presets, options.preset));

	const chosen: ExportPreset = {
		...preset,
		...(options.records ? { records: options.records } : {}),
		markExported: options.save === true,
		...(options.pieces ? { split: "pieces" as const } : {}),
		...(options.cut ? { cutFile: options.cut } : {}),
		...(options.cutLines || options.cutSpot ? { cutLines: true } : {}),
		...(options.cutSpot
			? { cutSpots: { ...preset.cutSpots, ...options.cutSpot } }
			: {}),
		...(options.minDpi !== undefined ? { minImageDpi: options.minDpi } : {}),
	};
	const sheets = sheetLayout(preset);
	if (options.pieces && sheets && sheets.duplex !== "none")
		throw new UsageError(
			`--pieces does not go with double-sided sheets; "${preset.name}" prints duplex`,
		);
	if (options.cut && preset.format === "pdf")
		throw new CliError(
			`--cut applies only to an image preset; "${preset.name}" is a PDF, which takes --cut-lines`,
		);
	if (options.cutLines && preset.format !== "pdf")
		throw new CliError(
			`--cut-lines applies only to a PDF preset; "${preset.name}" writes images, which take --cut`,
		);
	if (options.cutSpot && preset.format !== "pdf")
		throw new CliError(
			`--cut-spot applies only to a PDF preset; "${preset.name}" writes images, which take --cut`,
		);
	if (options.maxPdfPages !== undefined && preset.format !== "pdf")
		throw new CliError(
			`--max-pdf-pages applies only to a PDF preset; "${preset.name}" writes images`,
		);
	await runPreset(
		options.where ? withFilters(workspace, preset, options.where) : workspace,
		chosen,
		{
			root: dirname(path),
			out: options.out,
			...(options.dryRun ? { dryRun: true } : {}),
			...(options.jobs ? { jobs: options.jobs } : {}),
			...(options.maxPdfPages !== undefined
				? { maxPdfPages: options.maxPdfPages }
				: {}),
			...(options.save
				? {
						save: async (next: Workspace) => {
							await saveWorkspace(path, {
								...workspace,
								datasets: next.datasets,
							});
							log.info(`saved the record statuses to ${file}`);
						},
					}
				: {}),
		},
		log,
		io,
	);
}

/** The workspace with `filters` added to the view of the preset's template's
 *  binding, for this run only. */
function withFilters(
	workspace: Workspace,
	preset: ExportPreset,
	filters: ViewFilter[],
): Workspace {
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	const binding = entry?.binding;
	if (!entry || !readsDataset(binding))
		throw new CliError(
			`--where needs the template of preset "${preset.name}" to be bound to a dataset`,
		);
	const view = binding.view ?? { filters: [] };
	const next = {
		...entry,
		binding: withView(binding, {
			...view,
			filters: [...view.filters, ...filters],
		}),
	};
	return {
		...workspace,
		templates: workspace.templates.map((t) => (t === entry ? next : t)),
	};
}

export async function saveWorkspace(
	path: string,
	workspace: Workspace,
): Promise<void> {
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		await packWorkspace(
			workspace,
			Writable.toWeb(
				createWriteStream(temporary),
			) as WritableStream<Uint8Array>,
		);
		await rename(temporary, path);
	} catch (err) {
		await rm(temporary, { force: true });
		throw err;
	}
}

export function writesFile(out: string): boolean {
	return /\.(zip|pdf)$/i.test(out);
}

export async function runPreset(
	workspace: Workspace,
	preset: ExportPreset,
	options: {
		root: string;
		out: string;
		dryRun?: true;
		jobs?: number;
		/** the most pages a PDF may hold, default DEFAULT_MAX_PDF_PAGES; 0 for no limit */
		maxPdfPages?: number;
		save?: (workspace: Workspace) => Promise<void>;
		/** the sheet layout came from the command line */
		layoutFlags?: true;
	},
	log: Log,
	io: Io,
): Promise<void> {
	if (options.dryRun)
		return planPreset(workspace, preset, options.out, log, options.layoutFlags);
	const readiness = presetReadiness(workspace, preset);
	checkView(readiness.viewProblems);
	checkSheets(readiness.sheets, options.layoutFlags);
	checkPieces(preset, readiness, log);
	warnNotices(readiness, log);
	const { entry, plan } = readiness;
	if (!entry)
		throw new CliError(
			`preset "${preset.name}": its template is not in the workspace`,
		);
	checkPdfPages(
		preset,
		plan.length,
		options.maxPdfPages ?? DEFAULT_MAX_PDF_PAGES,
	);
	checkCuts(preset, entry.template, log);
	const { fonts, ...report } = await resolveTemplateFonts(entry.template, {
		...withFetch(fontFetch(io)),
		load: createLoader(io, options.root),
	});
	warnAboutFonts(log, report);
	const { signal } = io;
	signal?.throwIfAborted();
	const out = resolve(io.cwd, options.out);
	const file = writesFile(options.out);
	await mkdir(file ? dirname(out) : out, { recursive: true });
	const threads = poolSize(
		plan.length,
		largestImagePixels(workspace, preset, plan),
		options.jobs,
	);
	const pool =
		threads > 1
			? await startWorkerPool(threads, options.root, fonts, signal)
			: undefined;
	let renderer: Awaited<ReturnType<typeof openRenderer>>;
	try {
		signal?.throwIfAborted();
		renderer = await openRenderer(io, { root: options.root, build: "full" });
	} catch (error) {
		pool?.dispose();
		throw error;
	}
	const progress = progressReporter(log, sheetLayout(preset) !== null);
	try {
		const result = await exportWorkspace(workspace, preset, {
			renderer,
			fonts,
			...(pool ? { pool } : {}),
			...(signal ? { signal } : {}),
			output: file ? fileOutput(out) : folderOutput(out),
			checkGlyphs: true,
			onProgress: progress,
			pdfCreator: `Freshcoat CLI ${version()}`,
		}).catch((error: unknown) => {
			if (error instanceof SheetLayoutError)
				throw new CliError(`cannot lay out the sheets: ${error.message}`);
			throw error;
		});
		log.endProgress();
		if (result.glyphs) warnAboutGlyphs(log, result.glyphs, "records");
		if (result.cancelled || signal?.aborted) {
			if (file) await rm(out, { force: true });
			throw new CliError("the export was cancelled");
		}
		await options.save?.(result.workspace);
		for (const item of result.items)
			for (const warning of item.warnings ?? [])
				log.warn(`${item.fileName}: ${warning.message}`);
		for (const side of result.rasterized ?? []) {
			const line = describeRasterized(side);
			if (line) log.info(`${side.side}: ${line}`);
		}
		const failed = result.items.filter((item) => !item.ok);
		for (const item of failed)
			log.info(`failed: ${item.fileName}: ${item.error ?? "unknown error"}`);
		const size = file ? `${formatBytes((await stat(out)).size)}, ` : "";
		log.out(
			`${result.items.length - failed.length} of ${result.items.length} items exported to ${options.out} (${size}${(result.ms / 1000).toFixed(1)}s)`,
		);
		if (failed.length > 0)
			throw new CliError(
				`${failed.length} ${failed.length === 1 ? "item" : "items"} failed`,
			);
	} finally {
		log.endProgress();
		pool?.dispose();
		renderer.dispose();
	}
}

/** Refuses a PDF with more pages than the limit, before anything is rendered
 *  or written, since every page is held in memory until the PDF is built. */
function checkPdfPages(preset: ExportPreset, pages: number, max: number): void {
	if (preset.format !== "pdf" || max === 0 || pages <= max) return;
	throw new CliError(
		`the PDF would have ${pages} pages, over the limit of ${max}; every page is held in memory until the PDF is built. Export fewer records with --where, or raise the limit with --max-pdf-pages <n> (0 for none)`,
	);
}

function planPreset(
	workspace: Workspace,
	preset: ExportPreset,
	out: string,
	log: Log,
	layoutFlags?: true,
): void {
	const readiness = presetReadiness(workspace, preset);
	const { plan, sheets, viewProblems } = readiness;
	checkView(viewProblems);
	checkSheets(sheets, layoutFlags);
	checkPieces(preset, readiness, log);
	warnNotices(readiness, log);
	if (preset.format !== "pdf") for (const item of plan) log.out(item.fileName);
	const layout = sheets?.imposition
		? `, ${sheetSummary(sheets.imposition)}`
		: "";
	log.out(
		`${plan.length} ${plan.length === 1 ? "item" : "items"} would be exported to ${out}${layout}`,
	);
}

/** Refuses sheets that can't be laid out; a back offset given on the command
 *  line is a usage error. */
function checkSheets(sheets: SheetPlan | null, layoutFlags?: true): void {
	if (sheets?.error === undefined) return;
	const message = `cannot lay out the sheets: ${sheets.error}`;
	throw layoutFlags && sheets.field === "backOffset"
		? new UsageError(message)
		: new CliError(message);
}

/** Refuses pieces on vector pages, and warns when a split finds no slice. */
function checkPieces(
	preset: ExportPreset,
	readiness: Pick<PresetReadiness, "blocked" | "plan">,
	log: Log,
): void {
	if (readiness.blocked?.reason === "pieces")
		throw new CliError(readiness.blocked.message);
	if (
		preset.split === "pieces" &&
		!readiness.plan.some((item) => item.piece !== undefined)
	)
		log.warn("no slices to split; exporting whole sides");
}

function warnNotices(
	readiness: Pick<PresetReadiness, "notices">,
	log: Log,
): void {
	for (const { message } of readiness.notices)
		log.warn(`${message.charAt(0).toLowerCase()}${message.slice(1)}`);
}

/** Warns when cut files are asked of a template whose slices have no edge. */
function checkCuts(preset: ExportPreset, template: Template, log: Log): void {
	const asked = exportCutFile(preset) !== "none" || exportCutLines(preset);
	if (
		asked &&
		!/"edge":"(through|kiss|score|perforate)"/.test(JSON.stringify(template))
	)
		log.warn("no slice has an edge to cut; writing no cut lines");
}

function checkView(problems: readonly string[]): void {
	if (problems.length > 0)
		throw new CliError(`cannot read the records: ${problems.join("; ")}`);
}

function presetMessage(
	presets: readonly { id: string; name: string }[],
	wanted: string,
): string {
	if (presets.length === 0) return "the workspace has no export presets";
	const matches = presets.filter((preset) => preset.name === wanted).length;
	const reason =
		matches > 1
			? `${matches} presets are named "${wanted}"; use an id`
			: `no preset "${wanted}"`;
	return `${reason}${presetList(presets)}`;
}

function presetList(presets: readonly { id: string; name: string }[]): string {
	if (presets.length === 0) return "; the workspace has none";
	return `\nPresets:\n${presets.map((p) => `  ${p.name}  (${p.id})`).join("\n")}`;
}

function progressReporter(
	log: Log,
	sheets: boolean,
): (progress: JobProgress) => void {
	let lastTenth = -1;
	return ({ done, failed, total, assembling }) => {
		const text = assembling
			? `assembling PDF: ${assembling.done}/${assembling.total} ${sheets ? "cards" : "pages"}`
			: `rendered ${done}/${total}${failed > 0 ? `, ${failed} failed` : ""}`;
		const tenth = total === 0 ? 10 : Math.floor((done * 10) / total);
		if (log.tty || tenth !== lastTenth || done === total) {
			lastTenth = tenth;
			log.progress(text);
		}
	};
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
