import type { Template } from "@freshcoat-js/coatfile";
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
	ms: number;
	/** set when the request asked for print: "fallback" when the print path
	 *  failed and the bytes are a plain render */
	print?: "on" | "fallback";
	/** why the print path failed */
	printError?: string;
	/** photo layers the print path pulled into the printer's range */
	gamut?: GamutNote[];
};

export type WorkerRequest =
	| { type: "init"; fonts: [string, Uint8Array[]][] }
	/** images the template itself carries, kept for every render */
	| { type: "images"; entries: [string, Blob][] }
	| ({ type: "render"; id: number } & RenderRequest)
	| { type: "dispose" };

export type WorkerReply =
	| { type: "ready"; ok: true; ms: number }
	| { type: "ready"; ok: false; error: string }
	| ({ type: "render"; id: number; ok: true } & RenderOutput)
	| { type: "render"; id: number; ok: false; error: string };
