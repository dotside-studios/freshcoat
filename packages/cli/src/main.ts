import { readFileSync } from "node:fs";
import {
	Command,
	CommanderError,
	InvalidArgumentError,
	Option,
} from "@commander-js/extra-typings";
import { PAPER_SIZES_MM, type PaperName } from "@freshcoat-js/workspace";
import { WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { renderBatch } from "./commands/batch";
import { inspect } from "./commands/inspect";
import { render } from "./commands/render";
import { validateCommand } from "./commands/validate";
import { renderWorkspace, writesFile } from "./commands/workspace";
import { CliError, type Io, processIo } from "./io";

export function version(): string {
	const manifest = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string };
	return manifest.version;
}

export async function main(
	argv: string[],
	io: Io = processIo(),
): Promise<number> {
	try {
		await program(io).parseAsync(argv, { from: "user" });
		return 0;
	} catch (error) {
		if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(`freshcoat: ${message}\n`);
		return error instanceof CliError ? error.exitCode : 1;
	}
}

function program(io: Io) {
	const root = new Command("freshcoat")
		.usage("<command> [options]")
		.description("Render, check and inspect Freshcoat templates and workspaces.")
		.version(version(), "-v, --version", "print the version")
		.helpOption("-h, --help", "show help")
		.helpCommand("help [command]", "show help for a command")
		.option("-q, --quiet", "hide warnings and progress")
		.configureHelp({ showGlobalOptions: true })
		.configureOutput({
			writeOut: io.stdout,
			writeErr: io.stderr,
			outputError: (text, write) => write(text.replace(/^error: /, "freshcoat: ")),
		})
		.exitOverride()
		.addHelpText(
			"after",
			"\nResults go to stdout; progress, warnings and errors go to stderr. Exit codes:\n0 done, 1 the work failed, 2 the command line was wrong.",
		);

	const command = (name: string) =>
		root
			.command(name)
			.helpOption("-h, --help", "show help")
			.showHelpAfterError(`Run freshcoat ${name} --help for usage.`);
	const quiet = (cmd: { optsWithGlobals(): { quiet?: true } }) =>
		cmd.optsWithGlobals().quiet === true;

	command("render")
		.summary("render a template, a template per spreadsheet row, or a workspace preset")
		.description(
			"Render each frame of a template to an image, or run an export preset from a\n.coatworkspace. <file> is a .coat file, template JSON or a .coatworkspace.\nTemplate frames are named after the frame, with the scale as a suffix for\nanything but 1x: front.png, front@2x.png. An --out ending in .zip or .pdf\nwrites a zip of images and a report, or a PDF, instead. With --data, a\ntemplate renders once per row of a spreadsheet into a zip, a PDF or a\ndirectory of images and a report; a workspace preset writes the same.",
		)
		.argument("<file>", "a .coat file, template JSON or a .coatworkspace")
		.option(
			"--out <path>",
			"a directory, default the current one, or a .zip or .pdf file; --data and a workspace need one",
		)
		.optionsGroup("Template options:")
		.option("--data <file>", "CSV, TSV, Excel, .ods or JSON; the first row names the fields")
		.option("--values <file>", "JSON file of field values")
		.option(
			"--set <key=value>",
			"one field value; repeatable, overrides --values and --data",
			collectSetting,
		)
		.option("--variant <id>", "render a variant of the template")
		.option("--frame <name>", "render only this frame; repeatable", collect)
		.option("--scale <n>", "pixel density, default 1; repeatable into a directory", collectScale)
		.addOption(
			new Option("--format <format>", "image format, default png").choices([
				"png",
				"jpeg",
				"jpg",
				"webp",
			] as const),
		)
		.optionsGroup("Export options, with --data or a .zip or .pdf:")
		.option(
			"--name <pattern>",
			"file names, such as {{member_id}}-{{side}}; default {{template}}-{{index}}-{{side}}",
		)
		.option("--quality <n>", "JPEG and WebP quality, 0 to 100, default 90", parseQuality)
		.option("--bleed", "include the template's bleed around each card")
		.optionsGroup("PDF options:")
		.option("--dpi <n>", "pixels per inch, which sets the page size; default 300", parsePositive)
		.addOption(
			new Option("--pdf-pages <kind>", "what each page holds, default png").choices([
				"png",
				"jpeg",
				"vector",
			] as const),
		)
		.option(
			"--sheets <paper>",
			"lay the cards out on a4, letter, legal, a3, tabloid or <w>x<h> mm paper",
			parsePaper,
		)
		.addOption(
			new Option("--duplex <edge>", "print backs behind fronts, flipped on this edge").choices([
				"long",
				"short",
			] as const),
		)
		.option("--margin <mm>", "sheet margin, default 10", parseLength)
		.option("--gap <mm>", "space between cards, default 0", parseLength)
		.option("--no-crop-marks", "leave out the crop marks")
		.optionsGroup("Workspace options:")
		.option(
			"--preset <name|id>",
			"the preset to run, by id or by a name only it has",
		)
		.addHelpText(
			"after",
			"\nFonts a template declares are loaded from their sources; others are looked up\non Google Fonts by name. Relative image paths resolve against the file's\ndirectory; photos named in --data resolve against the data file's directory,\nand a workspace's dataset photos come from the workspace. Written paths, or an\nexport's summary, are printed on stdout. Exits 1 when an export is cancelled or\nany item fails.",
		)
		.action((file, options, cmd) => {
			const given = Object.keys(options).filter(
				(key) => cmd.getOptionValueSource(key) === "cli",
			);
			const { preset, out, cropMarks, ...rest } = options;
			if (file.toLowerCase().endsWith(WORKSPACE_EXTENSION)) {
				const misplaced = given.filter((key) => key !== "preset" && key !== "out").map(flag);
				if (misplaced.length > 0)
					return cmd.error(
						`error: ${misplaced.join(", ")} ${misplaced.length === 1 ? "applies" : "apply"} only to templates`,
					);
				if (out === undefined)
					return cmd.error("error: a .coatworkspace needs --out <path>");
				return renderWorkspace(
					file,
					{ ...(preset ? { preset } : {}), out, quiet: quiet(cmd) },
					io,
				);
			}
			if (preset !== undefined)
				return cmd.error("error: --preset needs a .coatworkspace file");
			const exportOnly = given.filter((key) => EXPORT_OPTIONS.includes(key));
			if (rest.data === undefined && (out === undefined || !writesFile(out))) {
				if (exportOnly.length > 0)
					return cmd.error(
						`error: ${listed(exportOnly, "needs", "need")} --data or a .zip or .pdf --out`,
					);
				return render(file, { ...rest, ...(out ? { out } : {}), quiet: quiet(cmd) }, io);
			}
			if (out === undefined)
				return cmd.error("error: --data needs --out <dir|file.zip|file.pdf>");
			const problem = exportProblem(given, rest, out);
			if (problem) return cmd.error(`error: ${problem}`);
			return renderBatch(file, { ...rest, out, cropMarks, quiet: quiet(cmd) }, io);
		});

	command("validate")
		.summary("check a template or workspace")
		.description(
			"Check a template against the format, or a workspace's templates, bindings and\npresets. Exits 0 when it is valid and 1 when it is not, listing each issue.\nWarnings name what Studio's Issues list does: variant changes that change\nnothing or name a missing layer, layers inside the safe area, and a format\nversion that does not match the fields in use; for a workspace also required\nfields no column fills. --quiet prints nothing when it is valid.",
		)
		.argument("<file>", "a .coat file, template JSON or a .coatworkspace")
		.option("--strict", "exit 1 on warnings too")
		.action((file, options, cmd) =>
			validateCommand(file, { ...options, quiet: quiet(cmd) }, io),
		);

	command("inspect")
		.summary("list what a template or workspace holds")
		.description(
			"List a template's frames, fields, variants and fonts, or a workspace's\ntemplates and their bindings, datasets with their record statuses, and presets\nwith how many items each exports.",
		)
		.argument("<file>", "a .coat file, template JSON or a .coatworkspace")
		.option("--json", "print the inspection as JSON")
		.action((file, options) => inspect(file, options, io));

	return root;
}

const PDF_OPTIONS = ["dpi", "pdfPages", "sheets", "duplex", "margin", "gap", "cropMarks"];
const SHEET_OPTIONS = ["duplex", "margin", "gap", "cropMarks"];
const EXPORT_OPTIONS = ["name", "quality", "bleed", ...PDF_OPTIONS];

function flag(key: string): string {
	return key === "cropMarks"
		? "--no-crop-marks"
		: `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function listed(keys: string[], one: string, many: string): string {
	return `${keys.map(flag).join(", ")} ${keys.length === 1 ? one : many}`;
}

function exportProblem(
	given: string[],
	options: { scale?: number[]; format?: string; quality?: number; pdfPages?: string },
	out: string,
): string | undefined {
	const pdf = /\.pdf$/i.test(out);
	if ((options.scale?.length ?? 0) > 1) return "an export takes one --scale";
	if (pdf && options.format !== undefined)
		return "--format applies only to images; a PDF takes --pdf-pages";
	const pdfOnly = given.filter((key) => PDF_OPTIONS.includes(key));
	if (!pdf && pdfOnly.length > 0)
		return listed(pdfOnly, "applies only to a .pdf", "apply only to a .pdf");
	const sheetOnly = given.filter((key) => SHEET_OPTIONS.includes(key));
	if (sheetOnly.length > 0 && !given.includes("sheets"))
		return listed(sheetOnly, "needs --sheets", "need --sheets");
	if (options.quality !== undefined) {
		if (pdf && options.pdfPages !== "jpeg") return "--quality needs --pdf-pages jpeg";
		if (!pdf && (options.format === undefined || options.format === "png"))
			return "--quality needs --format jpeg or webp";
	}
	return undefined;
}

function collect(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

function collectSetting(
	entry: string,
	previous: Record<string, string> = {},
): Record<string, string> {
	const at = entry.indexOf("=");
	if (at <= 0) throw new InvalidArgumentError("Expected key=value.");
	return { ...previous, [entry.slice(0, at)]: entry.slice(at + 1) };
}

function collectScale(entry: string, previous: number[] = []): number[] {
	return [...previous, parsePositive(entry)];
}

function parseQuality(entry: string): number {
	const value = Number(entry);
	if (!Number.isInteger(value) || value < 0 || value > 100)
		throw new InvalidArgumentError("Expected a whole number from 0 to 100.");
	return value;
}

function parsePositive(entry: string): number {
	const value = Number(entry);
	if (!Number.isFinite(value) || value <= 0)
		throw new InvalidArgumentError("Expected a positive number.");
	return value;
}

function parseLength(entry: string): number {
	const value = Number(entry);
	if (!Number.isFinite(value) || value < 0)
		throw new InvalidArgumentError("Expected millimetres, 0 or more.");
	return value;
}

function parsePaper(entry: string): PaperName | { widthMm: number; heightMm: number } {
	const name = entry.toLowerCase();
	if ((Object.keys(PAPER_SIZES_MM) as string[]).includes(name)) return name as PaperName;
	const size = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(name);
	const [width, height] = [Number(size?.[1]), Number(size?.[2])];
	if (!size || width <= 0 || height <= 0)
		throw new InvalidArgumentError(
			`Expected ${Object.keys(PAPER_SIZES_MM).join(", ")} or <width>x<height> in millimetres.`,
		);
	return { widthMm: Math.min(width, height), heightMm: Math.max(width, height) };
}
