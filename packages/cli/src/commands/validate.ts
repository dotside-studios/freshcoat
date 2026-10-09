import { validate } from "@freshcoat-js/coatfile";
import { CliError, createLog, type Io } from "../io";
import { issueSummary, readDocument } from "../template-file";

export async function validateCommand(
	file: string,
	options: { quiet: boolean },
	io: Io,
): Promise<void> {
	const log = createLog(io, options.quiet);
	const { document } = await readDocument(io, file);
	const result = validate(document);
	if (!result.ok) throw new CliError(issueSummary(file, result.errors));
	if (!log.quiet) log.out(`${file} is valid`);
}
