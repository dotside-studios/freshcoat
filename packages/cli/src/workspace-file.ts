import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { WorkspaceReadError } from "@freshcoat-js/workspace/archive";
import { readWorkspaceFile } from "@freshcoat-js/workspace/node";
import { CliError, type Io } from "./io";

export async function readWorkspace(io: Io, shown: string) {
	const path = resolve(io.cwd, shown);
	// readWorkspaceFile folds a missing file into "not a readable zip".
	try {
		await access(path, constants.R_OK);
	} catch (error) {
		const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
		throw new CliError(
			`cannot read ${shown}: ${missing ? "no such file" : "permission denied"}`,
		);
	}
	try {
		return await readWorkspaceFile(path);
	} catch (error) {
		if (error instanceof WorkspaceReadError)
			throw new CliError(`${shown}: ${error.message}`);
		throw error;
	}
}

