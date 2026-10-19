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
	collectCutSpot,
	collectFilter,
	collectScale,
	collectSetting,
	parseCopies,
	parseJobs,
	parseLength,
	parseMarks,
	parseMinDpi,
	parseOffset,
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
	const all = argv.includes("--help-all");
	try {
		await program(
			io,
			(name) => {
				running = name;
			},
			all,
		).parseAsync(all ? argv.map((a) => (a === "--help-all" ? "--help" : a)) : argv, {
			from: "user",
		});
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

function program(io: Io, onCommand: (name: string) => void, all: boolean) {
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
	const advanced = <O extends { hideHelp(hide?: boolean): O }>(option: O): O =>
		option.hideHelp(!all);
	const quiet = (cmd: { optsWithGlobals(): { quiet?: true } }) =>
		cmd.optsWithGlobals().quiet === true;
	const ioFor = (cmd: { optsWithGlobals(): { cache?: boolean } }): Io => {
		if (cmd.optsWithGlobals().cache !== false) return io;
		const { cacheDir: _, ...uncached } = io;
		return uncached;
	};

	const render = command("render")
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
		.option(
			"--min-dpi <n>",
			"warn for an image that prints below this many pixels per inch; default 300, 0 for none",
			arg(parseMinDpi),
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
		.addOption(
			advanced(
				new Option(
					"--png-alpha <mode>",
					"keep writes RGBA even for an opaque frame; default auto",
				).choices(["auto", "keep"] as const),
			),
		)
		.optionsGroup("Export options, with --data or a .zip or .pdf:")
		.option(
			"--name <pattern>",
			"file names, such as {{member_id}}-{{side}}; default {{template}}-{{index}}-{{side}}",
		)
		.option("--quality <n>", "JPEG and WebP quality, 0 to 100, default 90", arg(parseQuality))
		.option("--bleed", "include the template's bleed around each card")
		.option("--pieces", "write each slice of a frame as its own file; a frame with none is written whole")
		.addOption(
			new Option(
				"--cut <format>",
				"write each image's cut lines beside it, from the slices that have an edge",
			).choices(["svg", "dxf"] as const),
		)
		.optionsGroup("PDF options:")
		.option("--dpi <n>", "pixels per inch, which sets the page size; default 300", arg(parsePositive))
		.addOption(
			new Option("--pdf-pages <kind>", "what each page holds, default png").choices([
				"png",
				"jpeg",
				"vector",
			] as const),
		)
		.addOption(
			new Option(
				"--pdf-text <mode>",
				"how vector pages draw text: embed its fonts, or outline its glyphs; default embed",
			).choices(["embed", "outline"] as const),
		)
		.option("--cut-lines", "draw the cut lines over each page")
		.option(
			"--cut-spot <[kind=]name>",
			"the spot colour of a kind of cut line, through when none is named; repeatable, implies --cut-lines; default CutContour, kiss=KissCut, score=Crease, perforate=Perfcut",
			arg(collectCutSpot),
		)
		.option(
			"--sheets <paper>",
			"lay the cards out on a4, a5, a6, letter, legal, a3, tabloid or <w>x<h> mm paper",
			arg(parsePaper),
		)
		.option(
			"--output-intent <file>",
			"declare this ICC profile, such as the print shop's CMYK condition, as the output intent; default sRGB",
		)
		.option("--no-output-intent", "declare no output intent")
		.option(
			"--output-intent-id <name>",
			"the condition --output-intent describes, such as FOGRA39; default the profile's description",
		)
		.optionsGroup("Sheet options, with --sheets:")
		.addOption(
			new Option("--duplex <edge>", "print backs behind fronts, flipped on this edge").choices([
				"long",
				"short",
			] as const),
		)
		.option("--margin <mm>", "sheet margin, default 10", arg(parseLength))
		.option("--gap <mm>", "space between cards, default 0", arg(parseLength))
		.option(
			"--copies <n|fill>",
			"repeat each card this many times, or fill a sheet with it; default 1",
			arg(parseCopies),
		)
		.option(
			"--marks <list>",
			"printer's marks on sheets: none, or any of crop, registration, colorbar, slug; default crop",
			arg(parseMarks),
		)
		.addOption(
			advanced(new Option("--no-crop-marks", "the same as leaving crop out of --marks")),
		)
		.option(
			"--back-offset <x,y>",
			"with --duplex, move every back page this many mm, up to 50 each way, for a printer that drifts; y is down",
			arg(parseOffset),
		)
		.option("--blank-backs", "with --duplex, give a one-sided template empty back pages")
		.optionsGroup("Print options:")
		.addOption(
			new Option(
				"--print-target <target>",
				"correct the cards for this printer, as a preset's print target does; default the profile's, or none",
			).choices(["none", "ymcko"] as const),
		)
		.option(
			"--print-profile <file>",
			"a measured printer profile, as Studio saves it; implies the target it was measured on",
		)
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
		.option(
			"--where <filter>",
			"export only records that match, such as tier=gold or points>=100; repeatable, with --data too",
			arg(collectFilter),
		)
		.addHelpText(
			"after",
			"\nFonts a template declares are loaded from their sources; others are looked up\non Google Fonts by name. Relative image paths resolve against the file's\ndirectory; photos named in --data resolve against the data file's directory,\nand a workspace's dataset photos come from the workspace. Written paths, or an\nexport's summary, are printed on stdout. Exits 1 when an export is cancelled or\nany item fails.",
		)
		.addHelpText("after", all ? "" : "\nRun freshcoat render --help-all to list the less common options too.");
	const given = track(render, REPEATABLE);
	render.action((file, options, cmd) => {
		checkGiven(given);
		return runRender(file, { ...options, quiet: quiet(cmd) }, ioFor(cmd));
	});

	command("validate")
		.summary("check a template or workspace")
		.description(
			"Check a template against the format, or a workspace's templates, bindings and\npresets. Exits 0 when it is valid and 1 when it is not, listing each issue.\nWarnings name what Studio's Issues list does: variant changes that change\nnothing or name a missing layer, layers inside the safe area, images that\nprint below --min-dpi, and a format version that does not match the fields\nin use; for a workspace also required fields no column fills. An image bound\nto a field is checked when it renders. --quiet prints nothing when it is\nvalid.",
		)
		.argument("<file>", "a .coat file, template JSON or a .coatworkspace")
		.option("--strict", "exit 1 on warnings too")
		.option(
			"--dpi <n>",
			"design units per inch the images are checked at; default 300, or a workspace preset's",
			arg(parsePositive),
		)
		.option(
			"--min-dpi <n>",
			"warn for an image that prints below this many pixels per inch; default 300, or a workspace preset's; 0 for none",
			arg(parseMinDpi),
		)
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

/** The render options that take more than one value. */
const REPEATABLE = ["--set", "--frame", "--scale", "--cut-spot", "--where"];

/** Each option of `command` as the command line gives it, in order, with the
 *  value as typed, for the options that may be given once. */
function track(
	command: {
		options: readonly { long?: string; name(): string }[];
		on(event: string, listener: (value: unknown) => void): unknown;
	},
	repeatable: readonly string[],
) {
	const given: { flag: string; value: unknown }[] = [];
	for (const option of command.options) {
		const flag = option.long;
		if (!flag || repeatable.includes(flag)) continue;
		command.on(`option:${option.name()}`, (value: unknown) => given.push({ flag, value }));
	}
	return given;
}

/** Refuses an option given twice with different values, and options that undo
 *  each other, rather than let the last one win. */
function checkGiven(given: readonly { flag: string; value: unknown }[]): void {
	const flags = new Set(given.map((entry) => entry.flag));
	for (const [a, b] of [["--output-intent", "--no-output-intent"]] as const)
		if (flags.has(a) && flags.has(b)) throw new UsageError(`${a} and ${b} do not go together`);
	const marks = given.find((entry) => entry.flag === "--marks");
	if (flags.has("--no-crop-marks") && marks && parseMarks(String(marks.value)).includes("crop"))
		throw new UsageError("--no-crop-marks does not go with --marks crop");
	const seen = new Map<string, unknown>();
	for (const { flag, value } of given) {
		if (seen.has(flag) && JSON.stringify(seen.get(flag)) !== JSON.stringify(value))
			throw new UsageError(`${flag} is given twice; give it once`);
		seen.set(flag, value);
	}
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
