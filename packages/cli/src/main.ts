import { readFileSync } from "node:fs";
import {
	Command,
	CommanderError,
	InvalidArgumentError,
	Option,
} from "@commander-js/extra-typings";
import { exportCommand } from "./commands/export";
import { inspect } from "./commands/inspect";
import { render } from "./commands/render";
import { validateCommand } from "./commands/validate";
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
		.description("Render, check and export Freshcoat templates.")
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
		.summary("render a template's frames to images")
		.description(
			"Render each frame of a template to an image. <template> is a .coat file or\ntemplate JSON. Files are named after the frame, with the scale as a suffix\nfor anything but 1x: front.png, front@2x.png.",
		)
		.argument("<template>", "a .coat file or template JSON")
		.option("--values <file>", "JSON file of field values")
		.option(
			"--set <key=value>",
			"one field value; repeatable, overrides --values",
			collectSetting,
		)
		.option("--variant <id>", "render a variant of the template")
		.option("--frame <name>", "render only this frame; repeatable", collect)
		.option("--scale <n>", "pixel density, default 1; repeatable", collectScale)
		.addOption(
			new Option("--format <format>", "image format")
				.choices(["png", "jpeg", "jpg", "webp"] as const)
				.default("png" as const),
		)
		.option("--out <dir>", "directory to write to, default the current directory")
		.addHelpText(
			"after",
			"\nFonts the template declares are loaded from their sources; others are looked\nup on Google Fonts by name. Relative image paths resolve against the\ntemplate's directory. Written paths are printed on stdout.",
		)
		.action((file, options, cmd) =>
			render(file, { ...options, quiet: quiet(cmd) }, io),
		);

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

	command("export")
		.summary("run an export preset from a .coatworkspace")
		.description(
			"Run an export preset from a .coatworkspace file. A zip format writes a zip of\nimages and a report; the pdf format writes a PDF. Dataset photos come from\nthe workspace; other relative image paths resolve against its directory.",
		)
		.argument("<workspace>", "a .coatworkspace file")
		.requiredOption("--preset <name|id>", "the preset to run, by id or by a name only it has")
		.requiredOption("--out <path>", "file to write, such as cards.zip or cards.pdf")
		.addHelpText(
			"after",
			"\nProgress and warnings go to stderr and a summary to stdout. Exits 1 when the\nexport is cancelled or any item fails.",
		)
		.action((file, options, cmd) =>
			exportCommand(file, { ...options, quiet: quiet(cmd) }, io),
		);

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
