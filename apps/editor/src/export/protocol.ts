import type { Template } from "@freshcoat-js/coatfile";
import type { PdfPage } from "@freshcoat-js/workspace";
import type {
	GlyphCheckItem,
	GlyphIssue,
	RenderOutput,
	RenderRequest,
} from "@freshcoat-js/workspace/export";
import type { AssemblePdfOptions } from "@freshcoat-js/workspace/pdf";

/** `template` is left out when it is the one the worker rendered last. */
export type WorkerRenderRequest = Omit<RenderRequest, "template"> & {
	template?: Template;
};

export type WorkerRequest =
	| { type: "init"; fonts: [string, Uint8Array[]][] }
	/** the job is over: free what was kept across its items */
	| { type: "jobEnd" }
	| ({ type: "render"; id: number } & WorkerRenderRequest)
	| { type: "dispose" };

export type WorkerReply =
	| { type: "ready"; ok: true; ms: number }
	| { type: "ready"; ok: false; error: string }
	| ({ type: "render"; id: number; ok: true } & RenderOutput)
	| { type: "render"; id: number; ok: false; error: string };

export type PdfAssembleOptions = Omit<AssemblePdfOptions, "onProgress">;

export type PdfWorkerRequest = {
	type: "assemble";
	pages: PdfPage[];
	options: PdfAssembleOptions;
};

export type PdfWorkerReply =
	| { type: "progress"; done: number; total: number }
	| { type: "done"; bytes: Uint8Array }
	| { type: "error"; error: string };

export type GlyphWorkerRequest = {
	type: "check";
	id: number;
	/** left out when unchanged since the last request */
	template?: Template;
	/** left out when unchanged since the last request */
	fonts?: [string, Uint8Array[]][];
	items: GlyphCheckItem[];
};

export type GlyphWorkerReply =
	| { type: "result"; id: number; issues: GlyphIssue[] }
	| { type: "error"; id: number; error: string };
