import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ExportPreset, Workspace } from "@freshcoat-js/workspace";
import { WorkspaceReadError } from "@freshcoat-js/workspace/archive";
import {
	exportWorkspace,
	findPreset,
	type JobProgress,
} from "@freshcoat-js/workspace/export";
import { fileOutput, readWorkspaceFile } from "@freshcoat-js/workspace/node";
import { warnAboutFonts, warnAboutGlyphs } from "../fonts";
import { CliError, createLog, type Io, type Log } from "../io";
import { createLoader, openRenderer } from "../renderer";

export type WorkspaceOptions = { preset?: string; out: string; quiet: boolean };

export async function renderWorkspace(
	file: string,
	options: WorkspaceOptions,
	io: Io,
): Promise<void> {
	const log = createLog(io, options.quiet);

	const path = resolve(io.cwd, file);
	const { workspace, warnings } = await readWorkspace(path, file);
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

export async function runPreset(
	workspace: Workspace,
	preset: ExportPreset,
	options: { root: string; out: string },
	log: Log,
	io: Io,
): Promise<void> {
	const out = resolve(io.cwd, options.out);
	await mkdir(dirname(out), { recursive: true });
	const renderer = await openRenderer(io, { root: options.root, build: "full" });
	const progress = progressReporter(log);
	try {
		const result = await exportWorkspace(workspace, preset, {
			renderer,
			fontOptions: {
				...(io.fetch ? { fetch: io.fetch } : {}),
				load: createLoader(io, options.root),
			},
			output: fileOutput(out),
			checkGlyphs: true,
			onProgress: progress,
		});
		log.endProgress();
		if (result.fonts) warnAboutFonts(log, result.fonts);
		if (result.glyphs) warnAboutGlyphs(log, result.glyphs, "records");
		if (result.cancelled) throw new CliError("the export was cancelled");
		const failed = result.items.filter((item) => !item.ok);
		for (const item of failed)
			log.info(`failed: ${item.fileName}: ${item.error ?? "unknown error"}`);
		const size = (await stat(out)).size;
		log.out(
			`${result.items.length - failed.length} of ${result.items.length} items exported to ${options.out} (${formatBytes(size)}, ${(result.ms / 1000).toFixed(1)}s)`,
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

async function readWorkspace(path: string, shown: string) {
	// readWorkspaceFile folds a missing file into "not a readable zip".
	try {
		await access(path, constants.R_OK);
	} catch (error) {
		const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
		throw new CliError(
			`cannot read ${shown}: ${missing ? "no such file" : "permission denied"}`,
		);
	}
	try {
		return await readWorkspaceFile(path);
	} catch (error) {
		if (error instanceof WorkspaceReadError)
			throw new CliError(`${shown}: ${error.message}`);
		throw error;
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
