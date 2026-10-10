import {
	type Renderer,
	type ResolvedTemplateFonts,
	type ResolveTemplateFontsOptions,
	resolveTemplateFonts,
} from "@freshcoat-js/coatfile";
import { planExport } from "../plan";
import type { ExportPreset, Workspace } from "../types";
import { checkAllGlyphs, type GlyphIssue } from "./glyph-preflight";
import { createItemRenderer } from "./item";
import {
	boundDatasetOf,
	inlinePool,
	type JobPool,
	type JobProgress,
	type JobResult,
	runExportJob,
} from "./job";
import type { JobFile, OutputSink } from "./sink";
import { applyJobResult } from "./status";

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
	/** Where the items render; default `inlinePool` over `renderer`. The pool
	 *  holds its own fonts, and `renderer` still checks glyphs. */
	pool?: JobPool;
	signal?: AbortSignal;
	onProgress?: (progress: JobProgress) => void;
	/** Also lists the text each item's fonts have no glyphs for, as `glyphs`. */
	checkGlyphs?: boolean;
	/** the time written to exported records; default now */
	now?: Date;
};

export type ExportWorkspaceResult = JobResult & {
	/** set when `exportWorkspace` resolved the fonts itself */
	fonts?: Omit<ResolvedTemplateFonts, "fonts">;
	/** set when `checkGlyphs` was asked for and the job was not cancelled */
	glyphs?: GlyphIssue[];
	/** The workspace with the job's record statuses written when the preset
	 *  has `markExported`; the one given otherwise. Save it to keep them. */
	workspace: Workspace;
};

/** The workspace with a finished job's record statuses written, when the
 *  preset marks exports and its template is bound. */
export function markExported(
	workspace: Workspace,
	preset: ExportPreset,
	result: JobResult,
	now: Date = new Date(),
): Workspace {
	if (!preset.markExported) return workspace;
	const dataset = boundDatasetOf(workspace, preset);
	if (!dataset) return workspace;
	const datasets = applyJobResult(workspace.datasets, dataset.id, result, now);
	return datasets === workspace.datasets
		? workspace
		: { ...workspace, datasets };
}

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
		const job = await runExportJob(workspace, found, {
			pool: options.pool ?? inlinePool(items),
			...(sink ? { sink } : {}),
			...(signal ? { signal } : {}),
			...(onProgress ? { onProgress } : {}),
		});
		const result: ExportWorkspaceResult = {
			...job,
			workspace: markExported(workspace, found, job, options.now),
		};
		if (report) result.fonts = report;
		if (result.cancelled) {
			await output?.discard?.();
			return result;
		}
		if (options.checkGlyphs) {
			const glyphs = await checkAllGlyphs(
				entry.template,
				planExport(workspace, found),
				options.renderer,
				() => signal?.aborted ?? false,
			);
			if (glyphs) result.glyphs = glyphs;
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
