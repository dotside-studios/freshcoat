import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	type ExportPreset,
	planExport,
	SheetLayoutError,
	sheetSummary,
	type Workspace,
} from "@freshcoat-js/workspace";
import { packWorkspace } from "@freshcoat-js/workspace/archive";
import {
	exportWorkspace,
	findPreset,
	type JobProgress,
	largestImagePixels,
	planSheets,
} from "@freshcoat-js/workspace/export";
import { fileOutput, folderOutput } from "@freshcoat-js/workspace/node";
import { warnAboutFonts, warnAboutGlyphs } from "../fonts";
import { fontFetch, withFetch } from "../font-cache";
import { CliError, createLog, type Io, type Log } from "../io";
import { createLoader, openRenderer } from "../renderer";
import { readWorkspace } from "../workspace-file";
import { createWorkerPool, poolSize } from "../worker-pool";
import { resolveTemplateFonts } from "@freshcoat-js/coatfile";

export type WorkspaceOptions = {
	preset?: string;
	out: string;
	records?: "all" | "pending" | "failed";
	save?: true;
	dryRun?: true;
	jobs?: number;
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
		throw new CliError(
			`a .coatworkspace needs --preset <name|id>${presetList(workspace.presets)}`,
			2,
		);
	const preset = findPreset(workspace, options.preset);
	if (!preset) throw new CliError(presetMessage(workspace.presets, options.preset));

	const chosen: ExportPreset = {
		...preset,
		...(options.records ? { records: options.records } : {}),
		markExported: options.save === true,
	};
	await runPreset(
		workspace,
		chosen,
		{
			root: dirname(path),
			out: options.out,
			...(options.dryRun ? { dryRun: true } : {}),
			...(options.jobs ? { jobs: options.jobs } : {}),
			...(options.save
				? {
						save: async (next: Workspace) => {
							await saveWorkspace(path, next);
							log.info(`saved the record statuses to ${file}`);
						},
					}
				: {}),
		},
		log,
		io,
	);
}

async function saveWorkspace(path: string, workspace: Workspace): Promise<void> {
	const blob = await packWorkspace(workspace);
	if (!blob) throw new CliError("could not write the workspace");
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, new Uint8Array(await blob.arrayBuffer()));
	await rename(temporary, path);
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
		save?: (workspace: Workspace) => Promise<void>;
	},
	log: Log,
	io: Io,
): Promise<void> {
	if (options.dryRun) return planPreset(workspace, preset, options.out, log);
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	if (!entry) throw new CliError(`preset "${preset.name}": its template is not in the workspace`);
	const { fonts, ...report } = await resolveTemplateFonts(entry.template, {
		...withFetch(fontFetch(io)),
		load: createLoader(io, options.root),
	});
	warnAboutFonts(log, report);
	const out = resolve(io.cwd, options.out);
	const file = writesFile(options.out);
	await mkdir(file ? dirname(out) : out, { recursive: true });
	const plan = planExport(workspace, preset);
	const threads = poolSize(plan.length, largestImagePixels(workspace, preset, plan), options.jobs);
	const pool =
		threads > 1
			? await createWorkerPool(threads, { root: options.root, fonts: [...fonts] })
			: undefined;
	const renderer = await openRenderer(io, { root: options.root, build: "full" });
	const progress = progressReporter(log);
	try {
		const result = await exportWorkspace(workspace, preset, {
			renderer,
			fonts,
			...(pool ? { pool } : {}),
			output: file ? fileOutput(out) : folderOutput(out),
			checkGlyphs: true,
			onProgress: progress,
		}).catch((error: unknown) => {
			if (error instanceof SheetLayoutError)
				throw new CliError(`cannot lay out the sheets: ${error.message}`);
			throw error;
		});
		log.endProgress();
		if (result.glyphs) warnAboutGlyphs(log, result.glyphs, "records");
		if (result.cancelled) throw new CliError("the export was cancelled");
		await options.save?.(result.workspace);
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
		await pool?.dispose();
		renderer.dispose();
	}
}

function planPreset(
	workspace: Workspace,
	preset: ExportPreset,
	out: string,
	log: Log,
): void {
	const plan = planExport(workspace, preset);
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	const sheets = entry ? planSheets(plan, entry.template, preset) : null;
	if (sheets?.error !== undefined)
		throw new CliError(`cannot lay out the sheets: ${sheets.error}`);
	if (preset.format !== "pdf") for (const item of plan) log.out(item.fileName);
	const layout = sheets?.imposition ? `, ${sheetSummary(sheets.imposition)}` : "";
	log.out(
		`${plan.length} ${plan.length === 1 ? "item" : "items"} would be exported to ${out}${layout}`,
	);
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

function progressReporter(log: Log): (progress: JobProgress) => void {
	let lastTenth = -1;
	return ({ done, failed, total, assembling }) => {
		const text = assembling
			? `assembling PDF: ${assembling.done}/${assembling.total} pages`
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
