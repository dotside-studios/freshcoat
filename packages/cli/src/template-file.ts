import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	type Template,
	type ValidationError,
	validate,
} from "@freshcoat-js/coatfile";
import { decodeTemplate } from "@freshcoat-js/coatfile/coat";
import { CliError, type Io } from "./io";

export async function readBytes(io: Io, path: string): Promise<Uint8Array> {
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

export type TemplateDocument = {
	directory: string;
	document: unknown;
};

export async function readDocument(
	io: Io,
	path: string,
): Promise<TemplateDocument> {
	const bytes = await readBytes(io, path);
	const decoded = await decodeTemplate(bytes);
	if (!decoded.ok) throw new CliError(`${path}: ${decoded.message}`);
	return {
		directory: dirname(resolve(io.cwd, path)),
		document: decoded.document,
	};
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

export async function readTemplate(
	io: Io,
	path: string,
): Promise<TemplateDocument & { template: Template }> {
	const read = await readDocument(io, path);
	const result = validate(read.document);
	if (!result.ok) throw new CliError(issueSummary(path, result.errors));
	return { ...read, template: result.value };
}
