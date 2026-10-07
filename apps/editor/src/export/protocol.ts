import type { Template } from "@freshcoat-js/coatfile";
import type { PdfPage } from "@freshcoat-js/workspace";
import type { AssemblePdfOptions } from "@freshcoat-js/workspace/pdf";
import type { GlyphCheckItem, GlyphIssue } from "./glyph-preflight";
import type { GamutNote, RenderPrint } from "./print";

export type OutputFormat = "png" | "jpeg" | "webp";

export type RenderRequest = {
	template: Template;
	values: Record<string, string>;
	variantId?: string;
	side: string;
	/** device pixels per design unit */
	scale: number;
	/** the dataset photos this item's values name, by `ws:` reference; the
	 *  worker reads their bytes, the main thread never does */
	images: [ref: string, blob: Blob][];
	/** lay the design out at this size by its constraints first */
	resize?: { width: number; height: number };
	/** include the template's bleed around the trim */
	bleed?: boolean;
	format: OutputFormat;
	/** JPEG and WebP, 0..100 */
	quality?: number;
	/** render through for-print's card-printer path */
	print?: RenderPrint;
};

export type RenderOutput = {
	bytes: Uint8Array;
	/** what the bytes are; a build without an encoder answers in PNG */
	format: OutputFormat;
	width: number;
	height: number;
	/** CRC-32 of `bytes`, computed in the worker */
	crc?: number;
	ms: number;
	/** set when the request asked for print: "fallback" when the print path
	 *  failed and the bytes are a plain render */
	print?: "on" | "fallback";
	/** why the print path failed */
	printError?: string;
	/** photo layers the print path pulled into the printer's range */
	gamut?: GamutNote[];
};

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
