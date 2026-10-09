import { type Renderer, resolveTemplateFonts } from "@freshcoat-js/coatfile";
import type { ExportPreset, Workspace } from "../types";
import { createItemRenderer } from "./item";
import {
	inlinePool,
	type JobProgress,
	type JobResult,
	runExportJob,
} from "./job";
import type { JobFile, OutputSink } from "./sink";

/** Where `exportWorkspace` writes. Without one, a zip or PDF comes back as
 *  the result's `file`. */
export type ExportOutput = {
	/** where a zip format's files go */
	sink?(): OutputSink;
	/** takes the file the job hands back, such as a PDF */
	save?(file: JobFile): Promise<void>;
	/** removes what was written when the job is cancelled or fails */
	discard?(): Promise<void>;
};

export type ExportWorkspaceOptions = {
	renderer: Renderer;
	/** Default: the template's fonts, through `resolveTemplateFonts`. */
	fonts?: Map<string, Uint8Array[]>;
	output?: ExportOutput;
	signal?: AbortSignal;
	onProgress?: (progress: JobProgress) => void;
};

/** Runs a preset on this thread with the host's renderer. */
export async function exportWorkspace(
	workspace: Workspace,
	presetOrId: ExportPreset | string,
	options: ExportWorkspaceOptions,
): Promise<JobResult> {
	const preset =
		typeof presetOrId === "string"
			? workspace.presets.find((p) => p.id === presetOrId)
			: presetOrId;
	if (!preset) throw new Error(`no preset "${presetOrId}"`);
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	if (!entry) throw new Error(`no template "${preset.templateId}"`);
	const fonts =
		options.fonts ?? (await resolveTemplateFonts(entry.template)).fonts;
	const { output, signal, onProgress } = options;
	const items = createItemRenderer({ renderer: options.renderer, fonts });
	try {
		const sink = preset.format === "pdf" ? undefined : output?.sink?.();
		const result = await runExportJob(workspace, preset, {
			pool: inlinePool(items),
			...(sink ? { sink } : {}),
			...(signal ? { signal } : {}),
			...(onProgress ? { onProgress } : {}),
		});
		if (result.cancelled) {
			await output?.discard?.();
			return result;
		}
		if (result.file) await output?.save?.(result.file);
		return result;
	} catch (e) {
		await output?.discard?.();
		throw e;
	} finally {
		items.endJob();
		items.dispose();
	}
}
