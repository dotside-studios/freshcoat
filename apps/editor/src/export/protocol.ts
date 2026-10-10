import type { Template } from "@freshcoat-js/coatfile";
import type { PdfPage } from "@freshcoat-js/workspace";
import type { GlyphCheckItem, GlyphIssue } from "@freshcoat-js/workspace/export";
import type { AssemblePdfOptions } from "@freshcoat-js/workspace/pdf";

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
