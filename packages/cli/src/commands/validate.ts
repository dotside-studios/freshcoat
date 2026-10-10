import { WORKSPACE_EXTENSION } from "@freshcoat-js/workspace/archive";
import { CliError, createLog, type Io, type Log } from "../io";
import { type Findings, templateWarnings, workspaceFindings } from "../lint";
import { readTemplate, warnLoad } from "../template-file";
import { readWorkspace } from "../workspace-file";

export async function validateCommand(
	file: string,
	options: { quiet: boolean; strict?: true },
	io: Io,
): Promise<void> {
	const log = createLog(io, options.quiet);
	const findings = file.toLowerCase().endsWith(WORKSPACE_EXTENSION)
		? await checkWorkspace(io, file)
		: await checkTemplate(io, log, file);
	const { errors, warnings } = findings;
	if (errors.length > 0)
		throw new CliError(
			[
				`${file} is not valid (${count(errors.length, "issue")})`,
				...errors.map((error) => `  ${error}`),
			].join("\n"),
		);
	for (const warning of warnings) log.warn(warning);
	if (options.strict && warnings.length > 0)
		throw new CliError(`${file} has ${count(warnings.length, "warning")}`);
	if (!log.quiet)
		log.out(
			warnings.length > 0
				? `${file} is valid, with ${count(warnings.length, "warning")}`
				: `${file} is valid`,
		);
}

async function checkTemplate(io: Io, log: Log, file: string): Promise<Findings> {
	const loaded = await readTemplate(io, file);
	warnLoad(log, file, loaded, { format: false });
	return { errors: [], warnings: templateWarnings(loaded.template) };
}

async function checkWorkspace(io: Io, file: string): Promise<Findings> {
	const { workspace, warnings } = await readWorkspace(io, file);
	const findings = workspaceFindings(workspace);
	return { ...findings, warnings: [...warnings, ...findings.warnings] };
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
