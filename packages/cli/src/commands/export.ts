import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { WorkspaceReadError } from "@freshcoat-js/workspace/archive";
import {
	codepointLabel,
	exportWorkspace,
	findPreset,
	type JobProgress,
	summarizeGlyphs,
} from "@freshcoat-js/workspace/export";
import { fileOutput, readWorkspaceFile } from "@freshcoat-js/workspace/node";
import { exactlyOne, parse } from "../args";
import { warnAboutFonts } from "../fonts";
import { CliError, createLog, type Io, type Log, UsageError } from "../io";
import { openRenderer } from "../renderer";

export const exportHelp = `Usage: freshcoat export <workspace> --preset <name|id> --out <path> [options]

Run an export preset from a .coatworkspace file. A zip format writes a zip of
images and a report; the pdf format writes a PDF. Dataset photos come from
the workspace; other relative image paths resolve against its directory.

Options:
  --preset <name|id>  the preset to run, by id or by a name only it has
  --out <path>        file to write, such as cards.zip or cards.pdf
  --vector            draw a pdf preset's cards as vectors
  -q, --quiet         hide warnings and progress
  -h, --help          show this help

Progress and warnings go to stderr and a summary to stdout. Exits 1 when the
export is cancelled or any item fails.`;

export async function exportCommand(args: string[], io: Io): Promise<void> {
	const { values: flags, positionals } = parse(args, {
		preset: { type: "string" },
		out: { type: "string" },
		vector: { type: "boolean" },
	});
	const file = exactlyOne(positionals, "workspace file");
	if (!flags.preset) throw new UsageError("missing --preset");
	if (!flags.out) throw new UsageError("missing --out");
	const log = createLog(io, flags.quiet === true);

	const path = resolve(io.cwd, file);
	const { workspace, warnings } = await readWorkspace(path, file);
	for (const warning of warnings) log.warn(`${file}: ${warning}`);

	const found = findPreset(workspace, flags.preset);
	if (!found) throw new CliError(presetMessage(workspace.presets, flags.preset));
	if (flags.vector && found.format !== "pdf")
		throw new UsageError("--vector needs a pdf preset");
	const preset = flags.vector
		? { ...found, pdfPageImage: "vector" as const }
		: found;

	const out = resolve(io.cwd, flags.out);
	await mkdir(dirname(out), { recursive: true });
	const renderer = await openRenderer(io, {
		root: dirname(path),
		build: "full",
	});
	const progress = progressReporter(log);
	try {
		const result = await exportWorkspace(workspace, preset, {
			renderer,
			...(io.fetch ? { fontOptions: { fetch: io.fetch } } : {}),
			output: fileOutput(out),
			checkGlyphs: true,
			onProgress: progress,
		});
		log.endProgress();
		if (result.fonts) warnAboutFonts(log, result.fonts);
		if (result.glyphs && result.glyphs.length > 0) {
			const { records, codepoints } = summarizeGlyphs(result.glyphs);
			log.warn(
				`the fonts have no glyphs for ${codepoints.map(codepointLabel).join(" ")} in ${records} ${records === 1 ? "record" : "records"}; they print as boxes`,
			);
		}
		const pixels = result.items.filter((item) => item.vector === "fallback");
		if (pixels.length > 0) {
			const reasons = new Set(
				pixels.flatMap((item) =>
					(item.warnings ?? []).filter((w) => w.startsWith("Drawn as pixels: ")),
				),
			);
			log.warn(
				`${pixels.length} of ${result.items.length} cards drawn as pixels, not vectors`,
			);
			for (const reason of reasons) log.info(`  ${reason}`);
		}
		if (result.cancelled) throw new CliError("the export was cancelled");
		const failed = result.items.filter((item) => !item.ok);
		for (const item of failed)
			log.info(`failed: ${item.fileName}: ${item.error ?? "unknown error"}`);
		const size = (await stat(out)).size;
		log.out(
			`${result.items.length - failed.length} of ${result.items.length} items exported to ${flags.out} (${formatBytes(size)}, ${(result.ms / 1000).toFixed(1)}s)`,
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
	return `${reason}\nPresets:\n${presets.map((p) => `  ${p.name}  (${p.id})`).join("\n")}`;
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
