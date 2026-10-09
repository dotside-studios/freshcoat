import {
	type Renderer,
	type ResolvedTemplateFonts,
	type ResolveTemplateFontsOptions,
	resolveTemplateFonts,
} from "@freshcoat-js/coatfile";
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
	/** How `resolveTemplateFonts` loads them when `fonts` is not given. */
	fontOptions?: ResolveTemplateFontsOptions;
	output?: ExportOutput;
	signal?: AbortSignal;
	onProgress?: (progress: JobProgress) => void;
};

export type ExportWorkspaceResult = JobResult & {
	/** set when `exportWorkspace` resolved the fonts itself */
	fonts?: Omit<ResolvedTemplateFonts, "fonts">;
};

/** A preset by its id, else by a name no other preset has. */
export function findPreset(
	workspace: Workspace,
	idOrName: string,
): ExportPreset | undefined {
	const byId = workspace.presets.find((p) => p.id === idOrName);
	if (byId) return byId;
	const named = workspace.presets.filter((p) => p.name === idOrName);
	return named.length === 1 ? named[0] : undefined;
}

/** Runs a preset, given as itself, its id or its name, on this thread with
 *  the host's renderer. */
export async function exportWorkspace(
	workspace: Workspace,
	preset: ExportPreset | string,
	options: ExportWorkspaceOptions,
): Promise<ExportWorkspaceResult> {
	const found =
		typeof preset === "string" ? findPreset(workspace, preset) : preset;
	if (!found) throw new Error(`no preset "${preset}"`);
	const entry = workspace.templates.find((t) => t.id === found.templateId);
	if (!entry) throw new Error(`no template "${found.templateId}"`);
	let report: ExportWorkspaceResult["fonts"];
	let fonts = options.fonts;
	if (!fonts) {
		const { fonts: resolved, ...rest } = await resolveTemplateFonts(
			entry.template,
			options.fontOptions,
		);
		fonts = resolved;
		report = rest;
	}
	const { output, signal, onProgress } = options;
	const items = createItemRenderer({ renderer: options.renderer, fonts });
	try {
		const sink = found.format === "pdf" ? undefined : output?.sink?.();
		const result: ExportWorkspaceResult = await runExportJob(workspace, found, {
			pool: inlinePool(items),
			...(sink ? { sink } : {}),
			...(signal ? { signal } : {}),
			...(onProgress ? { onProgress } : {}),
		});
		if (report) result.fonts = report;
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
