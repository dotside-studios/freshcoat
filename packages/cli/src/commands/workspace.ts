import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	type ExportPreset,
	SheetLayoutError,
	type Workspace,
} from "@freshcoat-js/workspace";
import {
	exportWorkspace,
	findPreset,
	type JobProgress,
} from "@freshcoat-js/workspace/export";
import { fileOutput, folderOutput } from "@freshcoat-js/workspace/node";
import { warnAboutFonts, warnAboutGlyphs } from "../fonts";
import { CliError, createLog, type Io, type Log } from "../io";
import { createLoader, openRenderer } from "../renderer";
import { readWorkspace } from "../workspace-file";

export type WorkspaceOptions = { preset?: string; out: string; quiet: boolean };

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

	await runPreset(workspace, preset, { root: dirname(path), out: options.out }, log, io);
}

export function writesFile(out: string): boolean {
	return /\.(zip|pdf)$/i.test(out);
}

export async function runPreset(
	workspace: Workspace,
	preset: ExportPreset,
	options: { root: string; out: string },
	log: Log,
	io: Io,
): Promise<void> {
	const out = resolve(io.cwd, options.out);
	const file = writesFile(options.out);
	await mkdir(file ? dirname(out) : out, { recursive: true });
	const renderer = await openRenderer(io, { root: options.root, build: "full" });
	const progress = progressReporter(log);
	try {
		const result = await exportWorkspace(workspace, preset, {
			renderer,
			fontOptions: {
				...(io.fetch ? { fetch: io.fetch } : {}),
				load: createLoader(io, options.root),
			},
			output: file ? fileOutput(out) : folderOutput(out),
			checkGlyphs: true,
			onProgress: progress,
		}).catch((error: unknown) => {
			if (error instanceof SheetLayoutError)
				throw new CliError(`cannot lay out the sheets: ${error.message}`);
			throw error;
		});
		log.endProgress();
		if (result.fonts) warnAboutFonts(log, result.fonts);
		if (result.glyphs) warnAboutGlyphs(log, result.glyphs, "records");
		if (result.cancelled) throw new CliError("the export was cancelled");
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
		renderer.dispose();
	}
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
