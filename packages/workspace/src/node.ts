import { openAsBlob } from "node:fs";
import { readWorkspace } from "./archive";

export { fileOutput } from "./export/file-output";

/** Reads a `.coatworkspace` at `path` without loading it into memory first.
 *  Throws a `WorkspaceReadError` when it cannot be read. */
export async function readWorkspaceFile(path: string) {
	return readWorkspace(await openAsBlob(path));
}
