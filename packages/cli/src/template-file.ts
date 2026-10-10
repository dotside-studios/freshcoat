import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	formatVersionStatus,
	loadTemplate,
	type Template,
	type ValidationError,
	verifyAssets,
} from "@freshcoat-js/coatfile";
import { CliError, type Io, type Log } from "./io";
import { evaluateTemplateModule, isTemplateModule } from "./template-module";

export async function readBytes(
	io: Io,
	path: string,
): Promise<Uint8Array<ArrayBuffer>> {
	try {
		return new Uint8Array(await readFile(resolve(io.cwd, path)));
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${reason(error)}`);
	}
}

function reason(error: unknown): string {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (code === "ENOENT") return "no such file";
	if (code === "EISDIR") return "is a directory";
	if (code === "EACCES") return "permission denied";
	return error instanceof Error ? error.message : String(error);
}

export function formatIssue(issue: ValidationError): string {
	const where = issue.path === "" ? "" : `${issue.path}: `;
	return `${where}${issue.message} (${issue.code})`;
}

export function issueSummary(path: string, errors: ValidationError[]): string {
	return [
		`${path} is not a valid template (${errors.length} ${errors.length === 1 ? "issue" : "issues"})`,
		...errors.map((issue) => `  ${formatIssue(issue)}`),
	].join("\n");
}

export type TemplateFile = {
	directory: string;
	template: Template;
	/** What reading healed or found off, as sentences about the file. */
	notes: string[];
	/** Written by a newer 1.x kit, so fields it added were dropped. */
	newerFormat: boolean;
};

export function newerFormatWarning(version: string): string {
	return `format_version ${version} is newer than this freshcoat reads; fields it adds are ignored`;
}

/** Reads a template as Studio opens it: duplicate element ids are healed
 *  rather than refused. */
export async function readTemplate(io: Io, path: string): Promise<TemplateFile> {
	const input = isTemplateModule(path)
		? await evaluateTemplateModule(io, path)
		: await readBytes(io, path);
	const loaded = await loadTemplate(input);
	if (!loaded.ok) {
		if (loaded.reason === "unreadable") throw new CliError(`${path}: ${loaded.message}`);
		throw new CliError(issueSummary(path, loaded.errors));
	}
	const { template } = loaded;
	const notes: string[] = [];
	if (loaded.renamedIds.length > 0)
		notes.push(
			`renamed duplicate element ${loaded.renamedIds.length === 1 ? "id" : "ids"} ${loaded.renamedIds.join(", ")}`,
		);
	const misKeyed = await verifyAssets(template);
	if (misKeyed.length > 0)
		notes.push(
			`${misKeyed.length === 1 ? "asset" : "assets"} ${misKeyed.map((m) => m.declared).join(", ")} ${misKeyed.length === 1 ? "is" : "are"} not keyed by the hash of ${misKeyed.length === 1 ? "its" : "their"} bytes`,
		);
	return {
		directory: dirname(resolve(io.cwd, path)),
		template,
		notes,
		newerFormat: formatVersionStatus(template.format_version) === "newer",
	};
}

/** The warnings reading the file raised, named by file. `format` leaves out the
 *  newer-format one, for a caller that lints the format itself. */
export function warnLoad(
	log: Log,
	path: string,
	file: TemplateFile,
	options: { format?: boolean } = {},
): void {
	for (const note of file.notes) log.warn(`${path}: ${note}`);
	if (file.newerFormat && options.format !== false)
		log.warn(`${path}: ${newerFormatWarning(file.template.format_version)}`);
}
