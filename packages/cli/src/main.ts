import { readFileSync } from "node:fs";
import {
	Command,
	CommanderError,
	InvalidArgumentError,
	Option,
} from "@commander-js/extra-typings";
import { WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { renderData } from "./commands/data";
import { inspect } from "./commands/inspect";
import { render } from "./commands/render";
import { validateCommand } from "./commands/validate";
import { renderWorkspace } from "./commands/workspace";
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
			"Render each frame of a template to an image, or run an export preset from a\n.coatworkspace. <file> is a .coat file, template JSON or a .coatworkspace.\nTemplate frames are named after the frame, with the scale as a suffix for\nanything but 1x: front.png, front@2x.png. With --data, a template renders once\nper row of a spreadsheet into a zip of images and a report, or a PDF; a\nworkspace preset writes the same.",
		)
		.argument("<file>", "a .coat file, template JSON or a .coatworkspace")
		.option(
			"--data <file>",
			"template: CSV, TSV, Excel, .ods or JSON; the first row names the fields",
		)
		.option("--values <file>", "template: JSON file of field values")
		.option(
			"--set <key=value>",
			"template: one field value; repeatable, overrides --values and --data",
			collectSetting,
		)
		.option("--variant <id>", "template: render a variant of the template")
		.option("--frame <name>", "template: render only this frame; repeatable", collect)
		.option("--scale <n>", "template: pixel density, default 1; repeatable without --data", collectScale)
		.addOption(
			new Option("--format <format>", "template: image format, default png").choices([
				"png",
				"jpeg",
				"jpg",
				"webp",
			] as const),
		)
		.option(
			"--preset <name|id>",
			"workspace: the preset to run, by id or by a name only it has",
		)
		.option(
			"--out <path>",
			"template: directory, default the current one; with --data or a workspace: a .zip or .pdf file",
		)
		.addHelpText(
			"after",
			"\nFonts a template declares are loaded from their sources; others are looked up\non Google Fonts by name. Relative image paths resolve against the file's\ndirectory; photos named in --data resolve against the data file's directory,\nand a workspace's dataset photos come from the workspace. Written paths, or an\nexport's summary, are printed on stdout. Exits 1 when an export is cancelled or\nany item fails.",
		)
		.action((file, options, cmd) => {
			const { preset, out, data, ...templateOptions } = options;
			if (file.toLowerCase().endsWith(WORKSPACE_EXTENSION)) {
				const misplaced = Object.keys(options)
					.filter((key) => key !== "preset" && key !== "out")
					.map((key) => `--${key}`);
				if (misplaced.length > 0)
					return cmd.error(
						`error: ${misplaced.join(", ")} ${misplaced.length === 1 ? "applies" : "apply"} only to templates`,
					);
				if (preset === undefined)
					return cmd.error("error: a .coatworkspace needs --preset <name|id>");
				if (out === undefined)
					return cmd.error("error: a .coatworkspace needs --out <path>");
				return renderWorkspace(file, { preset, out, quiet: quiet(cmd) }, io);
			}
			if (preset !== undefined)
				return cmd.error("error: --preset needs a .coatworkspace file");
			if (data === undefined)
				return render(file, { ...templateOptions, ...(out ? { out } : {}), quiet: quiet(cmd) }, io);
			if (out === undefined || !/\.(zip|pdf)$/i.test(out))
				return cmd.error("error: --data needs --out <file.zip|file.pdf>");
			if ((templateOptions.scale?.length ?? 0) > 1)
				return cmd.error("error: --data takes one --scale");
			if (templateOptions.format !== undefined && /\.pdf$/i.test(out))
				return cmd.error("error: --format applies only to a zip");
			return renderData(file, { ...templateOptions, data, out, quiet: quiet(cmd) }, io);
		});

	command("validate")
		.summary("check a template against the format")
		.description(
			"Check a template against the format. Exits 0 when it is valid and 1 when it\nis not, listing each issue. --quiet prints nothing when it is valid.",
		)
		.argument("<template>", "a .coat file or template JSON")
		.action((file, _options, cmd) =>
			validateCommand(file, { quiet: quiet(cmd) }, io),
		);

	command("inspect")
		.summary("list a template's frames, fields, variants and fonts")
		.description("List a template's frames, fields, variants and fonts.")
		.argument("<template>", "a .coat file or template JSON")
		.option("--json", "print the inspection as JSON")
		.action((file, options) => inspect(file, options, io));

	return root;
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
	const value = Number(entry);
	if (!Number.isFinite(value) || value <= 0)
		throw new InvalidArgumentError("Expected a positive number.");
	return [...previous, value];
}
