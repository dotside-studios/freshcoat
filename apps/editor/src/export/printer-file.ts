import { resolveTemplateFonts, type Template } from "@freshcoat-js/coatfile";
import type {
	DatasetAsset,
	ExportItem,
	ExportPreset,
} from "@freshcoat-js/workspace";
import {
	gamutPercent,
	itemRequest,
	type RenderOutput,
	type RenderRequest,
} from "@freshcoat-js/workspace/export";
import { useEffect, useRef, useState } from "react";
import { fontCache } from "~/render/font-cache";
import { createWorkerPool, type WorkerPool } from "./worker-pool";

/** A printer file is shown, not handed over, so past this long edge it is
 *  rendered smaller. */
export const PRINTER_FILE_MAX_EDGE = 2048;

export type PrinterFileItem = Pick<
	ExportItem,
	"side" | "values" | "variantId"
> & { key: string };

/** The render request for one item's printer file: the export's own, through
 *  the print path, as PNG for a PDF, at most `PRINTER_FILE_MAX_EDGE` on its
 *  long edge. */
export function printerFileRequest(
	template: Template,
	preset: ExportPreset,
	item: PrinterFileItem,
	assets: ReadonlyMap<string, DatasetAsset>,
): RenderRequest | { error: string } {
	const built = itemRequest(template, preset, item, assets);
	if ("error" in built) return built;
	const { request, size } = built;
	const cap = Math.min(
		1,
		PRINTER_FILE_MAX_EDGE / Math.max(size.width, size.height),
	);
	// A PDF's pages are PNG unless it embeds JPEG, and the preview shows the
	// pixels the file holds.
	if (preset.format === "pdf") {
		const { quality: _q, vector: _v, ...png } = request;
		return { ...png, scale: size.scale * cap, format: "png" };
	}
	return { ...request, scale: size.scale * cap };
}

export type PrinterFile = {
	state: "idle" | "loading" | "ready" | "error";
	/** an object URL of the rendered file */
	url: string | null;
	/** the item key the URL shows */
	key: string | null;
	/** the most photo color pulled into printer range, in whole percent */
	gamut: number;
	/** set when the print path failed and the file is a plain render */
	fallback: string | null;
	error: string | null;
};

const IDLE: PrinterFile = {
	state: "idle",
	url: null,
	key: null,
	gamut: 0,
	fallback: null,
	error: null,
};

/**
 * Renders the previewed item through the export worker, print path and all,
 * while `on`. One worker, started on first use and ended with the preview;
 * stepping records quickly renders the latest one, not each in turn.
 */
export function usePrinterFile(
	on: boolean,
	template: Template | undefined,
	preset: ExportPreset | undefined,
	item: PrinterFileItem | null,
	assets: ReadonlyMap<string, DatasetAsset>,
): PrinterFile {
	const [file, setFile] = useState<PrinterFile>(IDLE);
	const pool = useRef<{
		pool: WorkerPool;
		template: Template | null;
		fonts: Promise<void> | null;
	} | null>(null);
	const busy = useRef(false);
	const latest = useRef<{ key: string; run: () => Promise<void> } | null>(null);

	useEffect(
		() => () => {
			pool.current?.pool.dispose();
			pool.current = null;
		},
		[],
	);

	useEffect(() => {
		if (!file.url) return;
		const url = file.url;
		return () => URL.revokeObjectURL(url);
	}, [file.url]);

	useEffect(() => {
		if (!on || !template || !preset || !item) return;
		const request = printerFileRequest(template, preset, item, assets);
		if ("error" in request) {
			latest.current = null;
			setFile({ ...IDLE, state: "error", key: item.key, error: request.error });
			return;
		}
		const key = `${item.key}|${request.scale}|${request.format}|${JSON.stringify(request.print ?? null)}`;
		setFile((prev) => ({ ...prev, state: "loading" }));
		const run = async () => {
			pool.current ??= {
				pool: createWorkerPool(1),
				template: null,
				fonts: null,
			};
			const own = pool.current;
			if (own.template !== template) {
				own.template = template;
				own.fonts = resolveTemplateFonts(template, { cache: fontCache }).then(
					({ fonts }) => own.pool.init(fonts),
				);
			}
			await own.fonts;
			const out: RenderOutput = await own.pool.render(request);
			if (latest.current?.key !== key) return;
			const url = URL.createObjectURL(
				new Blob([out.bytes as BlobPart], { type: `image/${out.format}` }),
			);
			setFile({
				state: "ready",
				url,
				key,
				gamut: gamutPercent(out.gamut),
				fallback:
					out.print === "fallback" ? (out.printError ?? "print failed") : null,
				error: null,
			});
		};
		latest.current = { key, run };
		const drain = async () => {
			if (busy.current) return;
			busy.current = true;
			try {
				let done: string | null = null;
				while (latest.current && latest.current.key !== done) {
					const next = latest.current;
					done = next.key;
					try {
						await next.run();
					} catch (e) {
						if (latest.current?.key === next.key)
							setFile({
								...IDLE,
								state: "error",
								key: next.key,
								error: e instanceof Error ? e.message : String(e),
							});
					}
				}
			} finally {
				busy.current = false;
			}
		};
		void drain();
	}, [on, template, preset, item, assets]);

	useEffect(() => {
		if (on) return;
		latest.current = null;
		setFile(IDLE);
	}, [on]);

	return file;
}
