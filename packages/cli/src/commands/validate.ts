import { validate } from "@freshcoat-js/coatfile";
import { exactlyOne, parse } from "../args";
import { CliError, createLog, type Io } from "../io";
import { issueSummary, readDocument } from "../template-file";

export const validateHelp = `Usage: freshcoat validate <template> [options]

Check a template against the format. <template> is a .coat file or template
JSON. Exits 0 when it is valid and 1 when it is not, listing each issue.

Options:
  -q, --quiet  print nothing when the template is valid
  -h, --help   show this help`;

export async function validateCommand(args: string[], io: Io): Promise<void> {
	const { values: flags, positionals } = parse(args, {});
	const file = exactlyOne(positionals, "template file");
	const log = createLog(io, flags.quiet === true);
	const { document } = await readDocument(io, file);
	const result = validate(document);
	if (!result.ok) throw new CliError(issueSummary(file, result.errors));
	if (!log.quiet) log.out(`${file} is valid`);
}
