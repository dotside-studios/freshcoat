import { fitDesignSize, type Template } from "@freshcoat-js/coatfile";
import type {
	CardSizeMm,
	Dataset,
	DatasetAsset,
	ExportItem,
	ExportPreset,
	PdfPage,
	SheetLayout,
	Workspace,
} from "@freshcoat-js/workspace";
import {
	assetRef,
	cardSizeMm,
	DEFAULT_QUALITY,
	exportSize,
	imageFormat,
	orientedSize,
	planExport,
	SheetLayoutError,
	slug,
	templateStem,
} from "@freshcoat-js/workspace";
import { gamutPercent, type PrintOutcome, printRequest } from "./print";
import type { RenderOutput, RenderRequest } from "./protocol";
import { planSheets, sheetLayout, withSideIndex } from "./sheets";
import {
	createPartZipSink,
	type JobFile,
	type OutputSink,
	type SinkResult,
} from "./sinks";
import type { WorkerPool } from "./worker-pool";

export type { JobFile } from "./sinks";

export type JobProgress = {
	/** items finished, failed ones included */
	done: number;
	failed: number;
	total: number;
	etaMs: number;
	/** bytes handed to the destination so far */
	bytes?: number;
};

export type JobItemResult = {
	key: string;
	recordId: string;
	side: string;
	fileName: string;
	ok: boolean;
	error?: string;
	/** how a rendered item came out; unset when it failed */
	print?: PrintOutcome;
	/** why the print path failed, for a "fallback" */
	printError?: string;
	/** the most photo color, in whole percent, pulled into printer range */
	gamut?: number;
};

export type JobStats = {
	poolSize: number;
	/** the most finished outputs held at once waiting to be written */
	maxHeld: number;
	/** the bound on items dispatched but not yet written: 2 x pool size */
	window: number;
};

export type JobResult = {
	/** the file still to hand over: a PDF, or a download's last part */
	file?: JobFile;
	items: JobItemResult[];
	cancelled: boolean;
	ms: number;
	/** what reached the destination, also when cancelled */
	sink?: SinkResult;
	/** set by every job that ran */
	stats?: JobStats;
};

export type JobPool = Pick<WorkerPool, "size" | "render" | "cancel">;

export type AssemblePdf = (
	pages: PdfPage[],
	options: {
		dpi: number;
		title?: string;
		layout?: SheetLayout;
		cardMm?: CardSizeMm;
	},
) => Promise<Uint8Array>;

export type ExportJobOptions = {
	pool: JobPool;
	onProgress?: (progress: JobProgress) => void;
	signal?: AbortSignal;
	/** defaults to `@freshcoat-js/workspace/pdf`, loaded when a PDF is made */
	assemblePdf?: AssemblePdf;
	/** where a zip format's files go; defaults to one zip in memory, handed
	 *  back as `file` */
	sink?: OutputSink;
	/** Asked once three PDF pages are made, when the whole PDF would pass
	 *  PDF_CONFIRM_BYTES; false cancels the job. */
	confirmLargePdf?: (estimatedBytes: number) => Promise<boolean>;
	now?: () => number;
};

export const REPORT_FILE_NAME = "export-report.csv";
/** A PDF is assembled in memory, so past this it asks first. */
export const PDF_CONFIRM_BYTES = 1024 ** 3;
const PDF_SAMPLE_PAGES = 3;

const loadAssemblePdf: AssemblePdf = async (pages, options) =>
	(await import("@freshcoat-js/workspace/pdf")).assemblePdf(pages, options);

/** The job's output name without an extension: the preset's name, else the
 *  template's file name. */
export function jobStem(workspace: Workspace, preset: ExportPreset): string {
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	const base = preset.name.trim() || templateStem(entry?.fileName ?? "").trim();
	return base ? slug(base) : "export";
}

/**
 * The preset a run over chosen records uses: every setting of its own, with
 * the record filter replaced by exactly these ids. `planExport` puts them in
 * dataset order and leaves out ids the dataset does not hold; a repeated id
 * counts once. The preset itself is not changed.
 */
export function withRecordIds(
	preset: ExportPreset,
	recordIds: readonly string[],
): ExportPreset {
	return { ...preset, records: "selected", selected: [...new Set(recordIds)] };
}

/** The job's output name: the preset's name, else the template's file name. */
export function jobFileName(
	workspace: Workspace,
	preset: ExportPreset,
): string {
	return `${jobStem(workspace, preset)}.${preset.format === "pdf" ? "pdf" : "zip"}`;
}

function csvCell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function reportCsv(items: JobItemResult[]): string {
	const rows = [
		["file", "record", "side", "status", "error", "print", "gamut"],
	];
	for (const item of items)
		rows.push([
			item.fileName,
			item.recordId,
			item.side,
			item.ok ? "ok" : "failed",
			item.error ?? item.printError ?? "",
			item.print ?? "",
			item.gamut ? `${item.gamut}%` : "",
		]);
	return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** What a rendered item's report says about printing. */
function printResult(
	out: RenderOutput,
): Pick<JobItemResult, "print" | "printError" | "gamut"> {
	const gamut = gamutPercent(out.gamut);
	return {
		print: out.print ?? "off",
		...(out.printError ? { printError: out.printError } : {}),
		...(gamut > 0 ? { gamut } : {}),
	};
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function boundDatasetOf(
	workspace: Workspace,
	preset: ExportPreset,
): Dataset | undefined {
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	const id = entry?.binding?.datasetId;
	return id ? workspace.datasets.find((d) => d.id === id) : undefined;
}

function assetsByRef(dataset: Dataset | undefined): Map<string, DatasetAsset> {
	return new Map(
		(dataset?.assets ?? []).map((a) => [assetRef(a.sha256), a] as const),
	);
}

/** The pixel count of the largest photo the preset's items use, as stored,
 *  which is what a worker decodes whatever size it renders at. */
export function largestImagePixels(
	workspace: Workspace,
	preset: ExportPreset,
	plan: readonly ExportItem[] = planExport(workspace, preset),
): number {
	const assets = assetsByRef(boundDatasetOf(workspace, preset));
	if (assets.size === 0) return 0;
	let largest = 0;
	const seen = new Set<string>();
	for (const item of plan)
		for (const value of Object.values(item.values)) {
			if (seen.has(value)) continue;
			seen.add(value);
			const asset = assets.get(value);
			if (asset?.width && asset.height)
				largest = Math.max(largest, asset.width * asset.height);
		}
	return largest;
}

type ItemSize = {
	/** output pixels */
	width: number;
	height: number;
	scale: number;
	resize?: { width: number; height: number };
};

/**
 * What one item renders at. A template size is the design at the preset's
 * scale. A size from an image is the photo's oriented pixels, capped by
 * `maxEdge`: the design is laid out by its constraints at the photo's aspect
 * and rendered at the density that makes it exactly that many pixels.
 */
export function itemSize(
	template: Pick<Template, "width" | "height">,
	preset: ExportPreset,
	item: ExportItem,
	assets: ReadonlyMap<string, DatasetAsset>,
): ItemSize | { error: string } {
	const size = exportSize(preset);
	if (size.kind === "template")
		return {
			width: Math.round(template.width * preset.scale),
			height: Math.round(template.height * preset.scale),
			scale: preset.scale,
		};
	const asset = assets.get(item.values[size.field] ?? "");
	if (!asset) return { error: `No image in ${size.field}` };
	if (!asset.width || !asset.height)
		return { error: `Image in ${size.field} has no readable size` };
	const seen = orientedSize({
		width: asset.width,
		height: asset.height,
		orientation: asset.orientation,
	});
	const cap =
		size.maxEdge && size.maxEdge > 0
			? Math.min(1, size.maxEdge / Math.max(seen.width, seen.height))
			: 1;
	const width = Math.max(1, Math.round(seen.width * cap));
	const height = Math.max(1, Math.round(seen.height * cap));
	const resize = fitDesignSize(template, width, height);
	return { width, height, scale: width / resize.width, resize };
}

/** The photos an item's values name, so a worker gets only those. */
function imagesOf(
	item: ExportItem,
	assets: ReadonlyMap<string, DatasetAsset>,
): [string, Blob][] {
	const out: [string, Blob][] = [];
	for (const value of new Set(Object.values(item.values))) {
		const asset = assets.get(value);
		if (asset) out.push([value, asset.blob]);
	}
	return out;
}

/** A PDF's pages, kept in memory until the document is assembled. */
function pdfCollector() {
	const pages: PdfPage[] = [];
	let bytes = 0;
	return {
		pages,
		get bytes() {
			return bytes;
		},
		add(page: PdfPage) {
			pages.push(page);
			bytes += page.bytes.length;
		},
	};
}

/**
 * Renders every item `planExport` gives through the pool and writes them in
 * plan order to the sink, or into one PDF.
 *
 * At most `pool.size` items render at once, and at most `2 * pool.size` are
 * dispatched but not yet written: finished outputs wait for the ones before
 * them, and a full window, or a sink whose `ready` is pending, holds dispatch
 * back. A failed item is recorded and the job goes on. Aborting `signal`
 * stops dispatching, cancels the pool, aborts the sink and resolves at once.
 */
export function runExportJob(
	workspace: Workspace,
	preset: ExportPreset,
	options: ExportJobOptions,
): Promise<JobResult> {
	const { pool, onProgress, signal } = options;
	const now = options.now ?? (() => performance.now());
	const started = now();
	const entry = workspace.templates.find((t) => t.id === preset.templateId);
	const plan: ExportItem[] = entry ? planExport(workspace, preset) : [];
	const total = plan.length;
	const pdf = preset.format === "pdf";
	const format = imageFormat(preset);
	const quality =
		format === "png" ? undefined : (preset.quality ?? DEFAULT_QUALITY);
	const print = printRequest(preset.print);
	const concurrency = Math.max(1, pool.size);
	const windowSize = 2 * concurrency;
	const stats: JobStats = {
		poolSize: pool.size,
		maxHeld: 0,
		window: windowSize,
	};

	if (!entry || total === 0)
		return Promise.resolve({
			items: [],
			cancelled: false,
			ms: now() - started,
			stats,
		});

	const template = entry.template;
	const assets = assetsByRef(boundDatasetOf(workspace, preset));
	const sink: OutputSink | null = pdf
		? null
		: (options.sink ??
			createPartZipSink({
				name: jobStem(workspace, preset),
				partBytes: Number.POSITIVE_INFINITY,
			}));
	const collector = pdf ? pdfCollector() : null;
	// On sheets, every card is drawn at the template's size, and duplex pairs
	// a record's sides by their place in the plan, so a failed front still
	// leaves its back in the mirrored slot.
	const sheet = pdf ? sheetLayout(preset) : null;
	const cardMm = cardSizeMm(template.width, template.height, preset.dpi);
	const sideIndex = withSideIndex(plan).map((item) => item.sideIndex);
	if (sheet) {
		// Refused before anything renders, rather than after every page has.
		const sheets = planSheets(plan, template, preset);
		if (sheets?.error !== undefined)
			return Promise.reject(new SheetLayoutError(sheets.error));
	}

	const results: (JobItemResult | undefined)[] = new Array(total);
	const outputs: (RenderOutput | undefined)[] = new Array(total);
	const sizes: (ItemSize | undefined)[] = new Array(total);
	const recorded = () =>
		results.filter((r): r is JobItemResult => r !== undefined);

	return new Promise<JobResult>((resolve, reject) => {
		let settled = false;
		let next = 0;
		let written = 0;
		let inFlight = 0;
		let done = 0;
		let failed = 0;
		let busyMs = 0;
		let dispatching = false;
		let writing = false;
		let asked = false;

		const bytesOut = () => sink?.bytes ?? collector?.bytes ?? 0;
		const sinkResult = (): SinkResult | undefined =>
			sink
				? { kind: sink.kind, files: sink.files, bytes: sink.bytes }
				: undefined;

		const finish = (result: Omit<JobResult, "ms" | "stats">) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", abort);
			resolve({ ...result, ms: now() - started, stats });
		};

		const fail = (e: unknown) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", abort);
			pool.cancel();
			void sink?.abort();
			reject(e);
		};

		function abort() {
			if (settled) return;
			pool.cancel();
			void sink?.abort();
			finish({ items: recorded(), cancelled: true, sink: sinkResult() });
		}

		const complete = async () => {
			const items = recorded();
			try {
				if (sink) {
					await sink.ready;
					await sink.add(
						REPORT_FILE_NAME,
						new TextEncoder().encode(reportCsv(items)),
					);
					const out = await sink.finish();
					if (settled) return;
					const { file, ...rest } = out;
					finish({
						...(file ? { file } : {}),
						items,
						cancelled: false,
						sink: rest,
					});
					return;
				}
				let file: JobFile | undefined;
				if (collector && collector.pages.length > 0) {
					const assemble = options.assemblePdf ?? loadAssemblePdf;
					const bytes = await assemble(collector.pages, {
						dpi: preset.dpi,
						title: preset.name || workspace.name,
						...(sheet ? { layout: sheet, cardMm } : {}),
					});
					if (settled) return;
					file = {
						blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
						name: jobFileName(workspace, preset),
						mediaType: "application/pdf",
					};
				}
				finish({ file, items, cancelled: false });
			} catch (e) {
				fail(e);
			}
		};

		/** Writes finished outputs in plan order, one at a time. */
		const drain = async () => {
			if (writing) return;
			writing = true;
			try {
				while (!settled && written < total && results[written]) {
					const index = written;
					const out = outputs[index];
					outputs[index] = undefined;
					if (out) {
						if (sink) {
							await sink.ready;
							if (settled) return;
							await sink.add(plan[index].fileName, out.bytes);
						} else if (collector) {
							const size = sizes[index];
							collector.add({
								bytes: out.bytes,
								format: out.format === "jpeg" ? "jpeg" : "png",
								widthPx:
									size?.resize !== undefined ? size.width : template.width,
								heightPx:
									size?.resize !== undefined ? size.height : template.height,
								...(sheet
									? {
											recordId: plan[index].recordId,
											sideIndex: sideIndex[index],
											...(plan[index].variantId !== undefined
												? { variantId: plan[index].variantId }
												: {}),
										}
									: {}),
							});
							if (
								!asked &&
								options.confirmLargePdf &&
								collector.pages.length === PDF_SAMPLE_PAGES &&
								total > PDF_SAMPLE_PAGES
							) {
								asked = true;
								const estimate = (collector.bytes / PDF_SAMPLE_PAGES) * total;
								if (
									estimate > PDF_CONFIRM_BYTES &&
									!(await options.confirmLargePdf(estimate))
								) {
									abort();
									return;
								}
							}
						}
					}
					if (settled) return;
					written++;
					void dispatch();
				}
			} catch (e) {
				fail(e);
				return;
			} finally {
				writing = false;
			}
			if (!settled && written === total) void complete();
		};

		const settle = (
			index: number,
			startedAt: number,
			out: RenderOutput | undefined,
			error: unknown,
		) => {
			if (settled) return;
			if (startedAt >= 0) {
				inFlight--;
				busyMs += now() - startedAt;
			}
			const item = plan[index];
			const ok = out !== undefined;
			results[index] = {
				key: item.key,
				recordId: item.recordId,
				side: item.side,
				fileName: item.fileName,
				ok,
				...(ok ? printResult(out) : { error: errorText(error) }),
			};
			outputs[index] = out;
			done++;
			if (!ok) failed++;
			stats.maxHeld = Math.max(stats.maxHeld, done - written);
			const remaining = total - done;
			onProgress?.({
				done,
				failed,
				total,
				etaMs:
					done > 0
						? Math.round(((busyMs / done) * remaining) / concurrency)
						: 0,
				bytes: bytesOut(),
			});
			if (settled) return;
			void drain();
			void dispatch();
		};

		const start = (index: number) => {
			const item = plan[index];
			const size = itemSize(template, preset, item, assets);
			if ("error" in size) {
				settle(index, -1, undefined, new Error(size.error));
				return;
			}
			sizes[index] = size;
			const request: RenderRequest = {
				template,
				values: item.values,
				...(item.variantId !== undefined ? { variantId: item.variantId } : {}),
				side: item.side,
				scale: size.scale,
				images: imagesOf(item, assets),
				...(size.resize ? { resize: size.resize } : {}),
				format,
				...(quality !== undefined ? { quality } : {}),
				...(print ? { print } : {}),
			};
			const startedAt = now();
			inFlight++;
			pool.render(request).then(
				(out) => settle(index, startedAt, out, undefined),
				(error) => settle(index, startedAt, undefined, error),
			);
		};

		const canDispatch = () =>
			!settled &&
			next < total &&
			inFlight < concurrency &&
			next - written < windowSize;

		/** Starts items while the pool and the window have room, waiting on the
		 *  sink's `ready` before each. */
		const dispatch = async () => {
			if (dispatching) return;
			dispatching = true;
			try {
				while (canDispatch()) {
					if (sink) {
						await sink.ready;
						if (!canDispatch()) continue;
					}
					start(next++);
				}
			} catch (e) {
				fail(e);
			} finally {
				dispatching = false;
			}
		};

		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });
		void dispatch();
	});
}
