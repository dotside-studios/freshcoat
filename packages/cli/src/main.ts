import { readFileSync } from "node:fs";
import { exportCommand, exportHelp } from "./commands/export";
import { inspect, inspectHelp } from "./commands/inspect";
import { render, renderHelp } from "./commands/render";
import { validateCommand, validateHelp } from "./commands/validate";
import { CliError, type Io, processIo, UsageError } from "./io";

const COMMANDS: Record<
	string,
	{ summary: string; help: string; run(args: string[], io: Io): Promise<void> }
> = {
	render: {
		summary: "render a template's frames to images",
		help: renderHelp,
		run: render,
	},
	validate: {
		summary: "check a template against the format",
		help: validateHelp,
		run: validateCommand,
	},
	inspect: {
		summary: "list a template's frames, fields, variants and fonts",
		help: inspectHelp,
		run: inspect,
	},
	export: {
		summary: "run an export preset from a .coatworkspace",
		help: exportHelp,
		run: exportCommand,
	},
};

export function version(): string {
	const manifest = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { version: string };
	return manifest.version;
}

function overview(): string {
	const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
	return `Usage: freshcoat <command> [options]

Render, check and export Freshcoat templates.

Commands:
${Object.entries(COMMANDS)
	.map(([name, { summary }]) => `  ${name.padEnd(width)}  ${summary}`)
	.join("\n")}

Options:
  -q, --quiet    hide warnings and progress
  -v, --version  print the version
  -h, --help     show help; after a command, that command's help

Results go to stdout; progress, warnings and errors go to stderr. Exit codes:
0 done, 1 the work failed, 2 the command line was wrong.`;
}

export async function main(
	argv: string[],
	io: Io = processIo(),
): Promise<number> {
	try {
		return await dispatch(argv, io);
	} catch (error) {
		if (error instanceof CliError) {
			io.stderr(`freshcoat: ${error.message}\n`);
			if (error instanceof UsageError)
				io.stderr(
					`Run freshcoat ${error.command ? `${error.command} ` : ""}--help for usage.\n`,
				);
			return error.exitCode;
		}
		io.stderr(
			`freshcoat: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		return 1;
	}
}

async function dispatch(argv: string[], io: Io): Promise<number> {
	const [first, ...rest] = argv;
	if (first === undefined) {
		io.stderr(`${overview()}\n`);
		return 2;
	}
	if (first === "--help" || first === "-h") {
		io.stdout(`${overview()}\n`);
		return 0;
	}
	if (first === "--version" || first === "-v") {
		io.stdout(`${version()}\n`);
		return 0;
	}
	if (first === "help") {
		const topic = rest[0];
		if (topic === undefined) io.stdout(`${overview()}\n`);
		else io.stdout(`${commandOf(topic).help}\n`);
		return 0;
	}
	const command = commandOf(first);
	if (rest.includes("--help") || rest.includes("-h")) {
		io.stdout(`${command.help}\n`);
		return 0;
	}
	try {
		await command.run(rest, io);
	} catch (error) {
		if (error instanceof UsageError) error.command = first;
		throw error;
	}
	return 0;
}

function commandOf(name: string) {
	const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
	if (!command) throw new UsageError(`unknown command "${name}"`);
	return command;
}
