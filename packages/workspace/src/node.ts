import { openAsBlob } from "node:fs";
import type { RendererOptions } from "@freshcoat-js/engine";
import { createRenderer, fileLoader } from "@freshcoat-js/engine/node";
import { readWorkspace } from "./archive";
import { fileOutput } from "./export/file-output";
import { folderOutput } from "./export/folder-output";
import {
	type ExportWorkspaceOptions,
	type ExportWorkspaceResult,
	exportWorkspace,
} from "./export/run";
import type { ExportPreset } from "./types";

export { type FileOutput, fileOutput } from "./export/file-output";
export { folderOutput } from "./export/folder-output";

/** Reads a `.coatworkspace` at `path` without loading it into memory first.
 *  Throws a `WorkspaceReadError` when it cannot be read. */
export async function readWorkspaceFile(path: string) {
	return readWorkspace(await openAsBlob(path));
}

export type ExportWorkspaceFileOptions = Omit<
	ExportWorkspaceOptions,
	"renderer" | "output"
> & {
	preset: ExportPreset | string;
	/** Destination file. The preset determines its format. */
	out: string;
	/** Write separate files into `out` instead of a zip or PDF file. */
	destination?: "file" | "folder";
	/** Allow relative paths and file: URLs under this directory. */
	assetRoot?: string;
	rendererOptions?: Omit<RendererOptions, "ck">;
};

export type ExportWorkspaceFileResult = ExportWorkspaceResult & {
	warnings: Awaited<ReturnType<typeof readWorkspaceFile>>["warnings"];
};

/** Reads a workspace and exports a preset with an owned full-build renderer.
 *  Record status changes are returned in `workspace`; the source file is not saved. */
export async function exportWorkspaceFile(
	path: string,
	options: ExportWorkspaceFileOptions,
): Promise<ExportWorkspaceFileResult> {
	const {
		preset,
		out,
		destination = "file",
		assetRoot,
		rendererOptions,
		...exportOptions
	} = options;
	if (assetRoot !== undefined && rendererOptions?.load !== undefined)
		throw new Error("Pass assetRoot or rendererOptions.load, not both");
	const { workspace, warnings } = await readWorkspaceFile(path);
	const load =
		assetRoot === undefined
			? rendererOptions?.load
			: fileLoader({ root: assetRoot });
	const renderer = await createRenderer({
		...rendererOptions,
		build: "full",
		...(load ? { load } : {}),
	});
	try {
		const result = await exportWorkspace(workspace, preset, {
			...exportOptions,
			fontOptions: { ...(load ? { load } : {}), ...exportOptions.fontOptions },
			renderer,
			output: destination === "folder" ? folderOutput(out) : fileOutput(out),
		});
		return { ...result, warnings };
	} finally {
		renderer.dispose();
	}
}
