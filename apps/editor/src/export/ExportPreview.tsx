import { type Template, variantSize } from "@freshcoat-js/coatfile";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { ToggleButton } from "@freshcoat-js/ui/toggle";
import type { DatasetAsset, ExportPreset } from "@freshcoat-js/workspace";
import { printEnabled } from "@freshcoat-js/workspace/export";
import type { CanvasKit } from "canvaskit-wasm";
import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { previewEdge, usePreviewImages } from "~/data/thumbnails";
import { buildPreview } from "~/doc/preview";
import { getCanvasKit } from "~/render/canvaskit";
import {
	createRenderScheduler,
	type RenderScheduler,
} from "~/render/scheduler";
import {
	createRenderSession,
	displayDensity,
	type RenderInput,
	type RenderOutput,
} from "~/render/session";
import { useDocumentFonts } from "~/render/use-document-fonts";
import PrintIcon from "~icons/mingcute/print-line";
import { type PreviewMode, splitAt, stepSplit } from "./preview-mode";
import { printerFileNote } from "./print";
import { usePrinterFile } from "./printer-file";

export type PreviewItem = {
	/** identifies what is shown, for tests and to skip repeat renders */
	key: string;
	side: string;
	values: Record<string, string>;
	variantId?: string;
};

type Size = { width: number; height: number };

/** What a printer file is rendered from: the export's own template, preset
 *  and photos, not the preview's. */
export type PrinterFileSource = {
	template: Template;
	preset: ExportPreset;
	assets: ReadonlyMap<string, DatasetAsset>;
};

type Input = RenderInput<null> & { key: string };

/**
 * One export item rendered with its own warm render session, scaled to fit
 * its box. The painted frame is copied into a 2D canvas, which stays readable
 * after the WebGL buffer is recycled.
 */
export function ExportItemPreview({
	template,
	item,
	assets,
	className,
	mode = "output",
	sourceRef = null,
	split = 0.5,
	onSplitChange,
	printer,
}: {
	template: Template;
	item: PreviewItem;
	assets?: DatasetAsset[];
	className?: string;
	/** Source and Split need `sourceRef` */
	mode?: PreviewMode;
	/** the `ws:` reference of the photo Source and Split show */
	sourceRef?: string | null;
	/** the divider, as a fraction of the width from the left */
	split?: number;
	onSplitChange?: (split: number) => void;
	/** offers the Printer file toggle when the preset prints */
	printer?: PrinterFileSource;
}) {
	const boxRef = useRef<HTMLDivElement>(null);
	const hostRef = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState<Size | null>(null);
	const [ck, setCk] = useState<CanvasKit | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [painted, setPainted] = useState<string | null>(null);
	const [scheduler, setScheduler] = useState<RenderScheduler<Input> | null>(
		null,
	);
	const fonts = useDocumentFonts(template);
	const printing = !!printer && printEnabled(printer.preset);
	const [printerOn, setPrinterOn] = useState(false);
	const printerFile = usePrinterFile(
		printing && printerOn,
		printer?.template,
		printer?.preset,
		item,
		printer?.assets ?? NO_ASSETS,
	);
	const showPrinterFile = printing && printerOn;
	const printerUrl =
		showPrinterFile &&
		printerFile.url &&
		printerFile.key?.startsWith(`${item.key}|`)
			? printerFile.url
			: null;

	useLayoutEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		const measure = () => {
			const r = el.getBoundingClientRect();
			setBox((prev) =>
				prev && prev.width === r.width && prev.height === r.height
					? prev
					: { width: r.width, height: r.height },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		let cancelled = false;
		getCanvasKit()
			.then((instance) => {
				if (!cancelled) setCk(() => instance);
			})
			.catch((e) => {
				if (!cancelled) setError(String(e));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!ck) return;
		const session = createRenderSession(ck);
		const next = createRenderScheduler(
			(input: Input): Promise<RenderOutput<null>> => session.render(input),
			{
				onResult(out, input) {
					const host = hostRef.current;
					if (!host) return;
					let copy = host.querySelector("canvas");
					if (!copy) {
						copy = document.createElement("canvas");
						copy.className = "absolute inset-0 size-full";
						copy.dataset.testid = "export-preview-canvas";
						copy.setAttribute("aria-hidden", "true");
						host.appendChild(copy);
					}
					if (copy.width !== out.canvas.width) copy.width = out.canvas.width;
					if (copy.height !== out.canvas.height)
						copy.height = out.canvas.height;
					const ctx = copy.getContext("2d");
					ctx?.clearRect(0, 0, copy.width, copy.height);
					ctx?.drawImage(out.canvas, 0, 0);
					setPainted(input.key);
					setError(null);
				},
				onError(e) {
					setError(e instanceof Error ? e.message : String(e));
				},
			},
		);
		setScheduler(() => next);
		return () => {
			setScheduler(null);
			next.dispose();
			void next.idle().then(() => session.dispose());
		};
	}, [ck]);

	const shown = variantSize(template, item.variantId);
	const fit = box
		? Math.min(box.width / shown.width, box.height / shown.height)
		: 0;
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	const density = fit > 0 ? displayDensity(fit, dpr, shown) : 0;

	const sideIndex = template.template_data.findIndex(
		(f) => f.name === item.side,
	);
	const photos = usePreviewImages(
		assets,
		item.values,
		previewEdge(box ?? { width: 0, height: 0 }, dpr),
	);
	const images = useMemo(() => {
		if (sideIndex < 0 || !photos) return null;
		const preview = buildPreview(template, {
			side: sideIndex,
			variantId: item.variantId,
		});
		if (photos.size === 0) return preview;
		const merged = new Map(preview.images);
		for (const [ref, bytes] of photos) merged.set(ref, bytes);
		return { ...preview, images: merged };
	}, [template, sideIndex, item.variantId, photos]);

	// The photo the output was made from, at the same preview resolution the
	// render reads, so showing it decodes nothing new.
	const sourceBytes =
		mode !== "output" && sourceRef ? photos?.get(sourceRef) : undefined;
	const sourceUrl = useObjectUrl(sourceBytes);
	const showSource = mode !== "output" && !!sourceRef;

	const renderKey = `${item.key}|${density}`;
	useEffect(() => {
		if (!scheduler || !images || !fonts.fonts || density <= 0) return;
		scheduler.request({
			template: images.template,
			images: images.images,
			values: item.values,
			fonts: fonts.fonts,
			scale: density,
			collect: () => null,
			key: item.key,
		});
	}, [scheduler, images, fonts.fonts, density, item.values, item.key]);

	const loading = showPrinterFile
		? printerFile.state === "loading" || (!printerUrl && !printerFile.error)
		: painted !== item.key && !error;
	const shownError = showPrinterFile ? printerFile.error : error;
	const note: { text: string; tone?: "danger" } | null = showPrinterFile
		? shownError
			? {
					text: `Couldn't render the printer file: ${shownError}`,
					tone: "danger",
				}
			: printerFile.fallback
				? {
						text: "Couldn't optimize for the printer, showing the plain file",
						tone: "danger",
					}
				: { text: printerFileNote(printerFile.gamut) }
		: error
			? { text: error, tone: "danger" }
			: null;
	const width = Math.floor(shown.width * fit);
	const height = Math.floor(shown.height * fit);
	const dragSplit = (e: ReactPointerEvent<HTMLElement>) => {
		const host = hostRef.current;
		if (!host || !onSplitChange) return;
		onSplitChange(splitAt(e.clientX, host.getBoundingClientRect()));
	};
	return (
		<div
			className={cn("relative min-h-0 min-w-0", className)}
			data-testid="export-preview"
			data-state={shownError ? "error" : loading ? "loading" : "ready"}
			data-item={painted ?? undefined}
			data-render-key={renderKey}
			data-mode={showSource ? mode : "output"}
			data-printer-file={showPrinterFile ? "on" : undefined}
		>
			<div
				ref={boxRef}
				className={cn(
					"absolute inset-x-4 top-4 flex items-center justify-center",
					printing ? "bottom-10" : "bottom-4",
				)}
			>
				<div
					ref={hostRef}
					className={cn(
						"relative shrink-0 shadow-(--shadow-fc-artboard)",
						// The output keeps rendering underneath, so switching back
						// shows it at once.
						((showSource && mode === "source") || printerUrl) &&
							"[&>canvas]:invisible",
						showSource && mode === "split" && "cursor-ew-resize touch-none",
					)}
					style={{ width, height }}
					onPointerDown={
						showSource && mode === "split"
							? (e) => {
									if (e.button !== 0) return;
									e.currentTarget.setPointerCapture(e.pointerId);
									dragSplit(e);
								}
							: undefined
					}
					onPointerMove={
						showSource && mode === "split"
							? (e) => {
									if (e.currentTarget.hasPointerCapture(e.pointerId))
										dragSplit(e);
								}
							: undefined
					}
				>
					{printerUrl ? (
						<img
							src={printerUrl}
							alt=""
							draggable={false}
							className="absolute inset-0 size-full object-contain"
							data-testid="export-printer-file"
						/>
					) : null}
					{showSource && mode === "source" ? (
						<div className="fc-checkerboard absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
							{sourceUrl ? (
								<img
									src={sourceUrl}
									alt=""
									draggable={false}
									className="size-full object-contain"
									data-testid="export-preview-source"
								/>
							) : null}
						</div>
					) : null}
					{showSource && mode === "split" ? (
						<SplitOverlay
							url={sourceUrl}
							split={split}
							onSplitChange={onSplitChange}
						/>
					) : null}
				</div>
			</div>
			{printing ? (
				<div className="absolute inset-x-3 bottom-1.5 flex min-w-0 items-center gap-2">
					<ToggleButton
						shape="text"
						isSelected={printerOn}
						onChange={setPrinterOn}
						className="shrink-0 gap-1.5 text-fc-sm"
					>
						<PrintIcon className="size-4" />
						Printer file
					</ToggleButton>
					{note ? (
						<p
							className={cn(
								"m-0 min-w-0 flex-1 truncate text-fc-sm",
								note.tone === "danger"
									? "text-fc-danger-text"
									: "text-fc-muted",
							)}
							title={note.text}
							data-testid={showPrinterFile ? "export-printer-note" : undefined}
						>
							{note.text}
						</p>
					) : (
						<span className="flex-1" />
					)}
					{loading ? (
						<span className="shrink-0 text-fc-faint text-fc-sm">
							Rendering…
						</span>
					) : null}
				</div>
			) : error ? (
				<p className="absolute inset-x-4 bottom-1 text-center text-fc-danger text-fc-sm">
					{error}
				</p>
			) : loading ? (
				<span className="absolute right-3 bottom-1 text-fc-faint text-fc-sm">
					Rendering…
				</span>
			) : null}
		</div>
	);
}

const NO_ASSETS: ReadonlyMap<string, DatasetAsset> = new Map();

/** The source photo over the left part of the output, and the divider. */
function SplitOverlay({
	url,
	split,
	onSplitChange,
}: {
	url: string | undefined;
	split: number;
	onSplitChange?: (split: number) => void;
}) {
	const percent = Math.round(split * 1000) / 10;
	return (
		<>
			{url ? (
				<img
					src={url}
					alt=""
					draggable={false}
					className="pointer-events-none absolute inset-0 z-10 size-full object-cover"
					style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
					data-testid="export-preview-source"
				/>
			) : null}
			<span className="pointer-events-none absolute top-2 left-2 z-20 rounded-[3px] bg-fc-popover/85 px-1.5 py-0.5 font-medium text-[10px] text-fc-muted uppercase tracking-[0.06em]">
				Source
			</span>
			<span className="pointer-events-none absolute top-2 right-2 z-20 rounded-[3px] bg-fc-popover/85 px-1.5 py-0.5 font-medium text-[10px] text-fc-muted uppercase tracking-[0.06em]">
				Output
			</span>
			<div
				role="slider"
				tabIndex={0}
				aria-label="Split between source and output"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(percent)}
				aria-valuetext={`${Math.round(percent)}% source`}
				data-testid="export-split-divider"
				className="group/divider absolute inset-y-0 z-20 w-4 -translate-x-1/2 cursor-ew-resize outline-none"
				style={{ left: `${percent}%` }}
				onKeyDown={(e) => {
					const next = stepSplit(split, e.key, e.shiftKey);
					if (next === null) return;
					e.preventDefault();
					onSplitChange?.(next);
				}}
			>
				{/* White in both themes: it sits on the photo, not on the chrome. */}
				<span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-(--shadow-fc-handle)" />
				<span className="absolute top-1/2 left-1/2 flex h-7 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-0.5 rounded-full bg-white shadow-(--shadow-fc-handle) group-focus-visible/divider:outline-2 group-focus-visible/divider:outline-fc-accent group-focus-visible/divider:outline-solid">
					<span className="h-3 w-px bg-black/30" />
					<span className="h-3 w-px bg-black/30" />
				</span>
			</div>
		</>
	);
}

/** An object URL for bytes, revoked when they change or the caller unmounts. */
function useObjectUrl(bytes: Uint8Array | undefined): string | undefined {
	const [url, setUrl] = useState<{ bytes: Uint8Array; url: string } | null>(
		null,
	);
	useEffect(() => {
		if (!bytes || typeof URL.createObjectURL !== "function") return;
		const next = URL.createObjectURL(new Blob([bytes as BlobPart]));
		setUrl({ bytes, url: next });
		return () => {
			URL.revokeObjectURL(next);
			setUrl(null);
		};
	}, [bytes]);
	return url && url.bytes === bytes ? url.url : undefined;
}
