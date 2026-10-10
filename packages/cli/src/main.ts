import { readFileSync } from "node:fs";
import {
	Command,
	CommanderError,
	InvalidArgumentError,
	Option,
} from "@commander-js/extra-typings";
import {
	ArgumentError,
	collect,
	collectScale,
	collectSetting,
	parseJobs,
	parseLength,
	parsePaper,
	parsePositive,
	parseQuality,
} from "./args";
import { inspect } from "./commands/inspect";
import { pack } from "./commands/pack";
import { runRender } from "./commands/render-plan";
import { validateCommand } from "./commands/validate";
import { CliError, type Io, processIo, UsageError } from "./io";

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
	let running: string | undefined;
	try {
		await program(io, (name) => {
			running = name;
		}).parseAsync(argv, { from: "user" });
		return 0;
	} catch (error) {
		if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2;
		const message = error instanceof Error ? error.message : String(error);
		io.stderr(`freshcoat: ${message}\n`);
		if (error instanceof UsageError && running)
			io.stderr(`Run freshcoat ${running} --help for usage.\n`);
		return error instanceof CliError ? error.exitCode : 1;
	}
}

function program(io: Io, onCommand: (name: string) => void) {
	const root = new Command("freshcoat")
		.usage("<command> [options]")
		.description("Render, check, inspect and package Freshcoat templates and workspaces.")
		.version(version(), "-v, --version", "print the version")
		.helpOption("-h, --help", "show help")
		.helpCommand("help [command]", "show help for a command")
		.option("-q, --quiet", "hide warnings and progress")
		.option("--no-cache", "download fonts again instead of using the font cache")
		.configureHelp({ showGlobalOptions: true })
		.configureOutput({
			writeOut: io.stdout,
			writeErr: io.stderr,
			outputError: (text, write) => write(text.replace(/^error: /, "freshcoat: ")),
		})
		.exitOverride()
		.hook("preAction", (_root, action) => onCommand(action.name()))
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
	const ioFor = (cmd: { optsWithGlobals(): { cache?: boolean } }): Io => {
		if (cmd.optsWithGlobals().cache !== false) return io;
		const { cacheDir: _, ...uncached } = io;
		return uncached;
	};

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
		.option("--dry-run", "list what would be written, without rendering")
		.option(
			"--jobs <n>",
			"render an export on this many threads; default from the cores and memory",
			arg(parseJobs),
		)
		.optionsGroup("Template options:")
		.option("--data <file>", "CSV, TSV, Excel, .ods or JSON; the first row names the fields")
		.option("--values <file>", "JSON file of field values")
		.option(
			"--set <key=value>",
			"one field value; repeatable, overrides --values and --data",
			arg(collectSetting),
		)
		.option("--variant <id>", "render a variant of the template")
		.option("--frame <name>", "render only this frame; repeatable", arg(collect))
		.option("--scale <n>", "pixel density, default 1; repeatable into a directory", arg(collectScale))
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
		.option("--quality <n>", "JPEG and WebP quality, 0 to 100, default 90", arg(parseQuality))
		.option("--bleed", "include the template's bleed around each card")
		.optionsGroup("PDF options:")
		.option("--dpi <n>", "pixels per inch, which sets the page size; default 300", arg(parsePositive))
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
			arg(parsePaper),
		)
		.addOption(
			new Option("--duplex <edge>", "print backs behind fronts, flipped on this edge").choices([
				"long",
				"short",
			] as const),
		)
		.option("--margin <mm>", "sheet margin, default 10", arg(parseLength))
		.option("--gap <mm>", "space between cards, default 0", arg(parseLength))
		.option("--no-crop-marks", "leave out the crop marks")
		.optionsGroup("Workspace options:")
		.option(
			"--preset <name|id>",
			"the preset to run, by id or by a name only it has",
		)
		.addOption(
			new Option("--records <which>", "the records to export, over the preset's choice").choices([
				"all",
				"pending",
				"failed",
			] as const),
		)
		.option("--save", "write each record's export status back into the workspace")
		.addHelpText(
			"after",
			"\nFonts a template declares are loaded from their sources; others are looked up\non Google Fonts by name. Relative image paths resolve against the file's\ndirectory; photos named in --data resolve against the data file's directory,\nand a workspace's dataset photos come from the workspace. Written paths, or an\nexport's summary, are printed on stdout. Exits 1 when an export is cancelled or\nany item fails.",
		)
		.action((file, options, cmd) =>
			runRender(file, { ...options, quiet: quiet(cmd) }, ioFor(cmd)),
		);

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
		.action((file, options, cmd) =>
			inspect(file, { ...options, quiet: quiet(cmd) }, io),
		);

	command("pack")
		.summary("package a template as .coat or .coat.json")
		.description(
			"Package a template as Studio saves it: the format version raised to cover the\nfields it uses, unused assets left out, and images it names by a relative path\nembedded. From a .coatworkspace, --template packs one of its templates, or\nevery template goes into a .zip.",
		)
		.argument("<file>", "a .coat file, template JSON or a .coatworkspace")
		.requiredOption("--out <file>", "a .coat or .coat.json file, or a .zip for a whole workspace")
		.option("--template <name|id>", "the workspace template to pack, by file name or id")
		.action((file, options, cmd) => pack(file, { ...options, quiet: quiet(cmd) }, io));

	return root;
}

/** A value parser for commander, which reports an ArgumentError as its own. */
function arg<T, P extends unknown[]>(
	parse: (value: string, ...rest: P) => T,
): (value: string, ...rest: P) => T {
	return (value, ...rest) => {
		try {
			return parse(value, ...rest);
		} catch (error) {
			if (error instanceof ArgumentError) throw new InvalidArgumentError(error.message);
			throw error;
		}
	};
}
