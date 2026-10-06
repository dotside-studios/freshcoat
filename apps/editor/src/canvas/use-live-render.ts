import type { Node, PaintWarning } from "@freshcoat-js/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { useController } from "~/app/context";
import { previewEdge, usePreviewImages } from "~/data/thumbnails";
import { collectGeometry, type LayerGeometry } from "~/doc/geometry";
import { buildPreview } from "~/doc/preview";
import { getCanvasKit } from "~/render/canvaskit";
import { createRenderScheduler } from "~/render/scheduler";
import {
	createRenderSession,
	displayDensity,
	type RenderInput,
	type RenderSession,
} from "~/render/session";
import { useDocumentFonts } from "~/render/use-document-fonts";
import { useEditor } from "~/state/hooks";
import type { BarcodeIssue } from "~/state/store";
import { activeSlot } from "~/state/workspace";

/**
 * Keeps the active side painted. Every document, value, side, variant,
 * visibility or density change requests a render; the scheduler coalesces them
 * so a drag paints as often as the pipeline keeps up. Returns the canvas the
 * session paints into, and the density it was painted at.
 */
export function useLiveRender(): {
	canvas: HTMLCanvasElement | null;
	scale: number;
	fontsLoading: boolean;
} {
	const controller = useController();
	const template = useEditor((s) => s.doc?.history.present ?? null);
	const side = useEditor((s) => s.side);
	const variantId = useEditor((s) => s.variantId);
	const hiddenLayers = useEditor((s) => s.hidden);
	const textEdit = useEditor((s) => s.textEdit);
	const hidden = useMemo(
		() => (textEdit ? new Set([...hiddenLayers, textEdit]) : hiddenLayers),
		[hiddenLayers, textEdit],
	);
	const values = useEditor((s) => s.values);
	const zoom = useEditor((s) => s.view.zoom);
	const datasetAssets = useEditor((s) => {
		const id = activeSlot(s)?.binding?.datasetId;
		return s.workspace?.datasets.find((d) => d.id === id)?.assets;
	});
	const fonts = useDocumentFonts(template);
	controller.fonts = fonts.fonts;
	const datasetImages = usePreviewImages(datasetAssets, values, liveEdge());
	// A render held back for the record's photos is still one to wait for, so
	// `renderIdle` waits for the photos and the render they allow.
	const heldForPhotos = useRef<Held | null>(null);
	useEffect(
		() => () => {
			heldForPhotos.current?.release();
			heldForPhotos.current = null;
		},
		[],
	);

	const [output, setOutput] = useState<{
		canvas: HTMLCanvasElement;
		scale: number;
	} | null>(null);
	const [ck, setCk] = useState<unknown>(null);
	const [pipeline, setPipeline] = useState<{
		session: RenderSession;
		scheduler: ReturnType<
			typeof createRenderScheduler<RenderInput<LayerGeometry>, unknown>
		>;
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		getCanvasKit()
			.then((instance) => {
				if (!cancelled) setCk(() => instance);
			})
			.catch((err) =>
				controller.dispatch({ type: "renderFailed", error: String(err) }),
			);
		return () => {
			cancelled = true;
		};
	}, [controller]);

	useEffect(() => {
		if (!ck) return;
		const session = createRenderSession(ck);
		const snapshotWaiters: ((c: HTMLCanvasElement) => void)[] = [];
		let lastInput: RenderInput<LayerGeometry> | null = null;
		const scheduler = createRenderScheduler(
			(input: RenderInput<LayerGeometry>) => {
				lastInput = input;
				return session.render(input);
			},
			{
				onResult(out, input, _ms) {
					// The drawing buffer is only readable in the task that painted it.
					for (const resolve of snapshotWaiters.splice(0)) {
						const copy = document.createElement("canvas");
						copy.width = out.canvas.width;
						copy.height = out.canvas.height;
						copy.getContext("2d")?.drawImage(out.canvas, 0, 0);
						resolve(copy);
					}
					setOutput((prev) =>
						prev?.canvas === out.canvas && prev.scale === out.scale
							? prev
							: { canvas: out.canvas, scale: out.scale },
					);
					controller.dispatch({
						type: "rendered",
						geometry: out.geometry,
						timings: out.timings,
						stats: scheduler.stats(),
						...splitWarnings(out.warnings, pathIdsOf.get(input)),
					});
					exposeForTests(session, scheduler, heldForPhotos, () => {
						const input = lastInput;
						if (!input) return Promise.reject(new Error("nothing rendered"));
						const copy = new Promise<HTMLCanvasElement>((resolve) =>
							snapshotWaiters.push(resolve),
						);
						scheduler.request(input);
						return copy;
					});
				},
				onError(err) {
					controller.dispatch({ type: "renderFailed", error: String(err) });
				},
			},
		);
		setPipeline({ session, scheduler });
		return () => {
			setPipeline(null);
			scheduler.dispose();
			// A render may still be settling; free the GPU objects after it.
			void scheduler.idle().then(() => session.dispose());
		};
	}, [ck, controller]);

	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	const density = template
		? displayDensity(zoom, dpr, {
				width: template.width,
				height: template.height,
			})
		: 1;

	useEffect(() => {
		const p = pipeline;
		if (!p || !template || !fonts.fonts || !template.template_data[side])
			return;
		// Wait for the record's photos rather than paint them as missing.
		if (!datasetImages) {
			heldForPhotos.current ??= held();
			return;
		}
		const preview = buildPreview(template, { side, variantId, hidden });
		const input: RenderInput<LayerGeometry> = {
			template: preview.template,
			images: withDatasetImages(preview.images, datasetImages),
			values,
			fonts: fonts.fonts,
			scale: density,
			collect: (root: Node) =>
				collectGeometry(root, preview.pathIds, template, side),
		};
		pathIdsOf.set(input, preview.pathIds);
		p.scheduler.request(input);
		heldForPhotos.current?.release();
		heldForPhotos.current = null;
	}, [
		pipeline,
		template,
		side,
		variantId,
		hidden,
		values,
		fonts.fonts,
		density,
		datasetImages,
	]);

	return {
		canvas: output?.canvas ?? null,
		scale: output?.scale ?? density,
		fontsLoading: fonts.loading,
	};
}

/** The layer key each compiled id came from, per request, so a warning naming
 *  an id can point at the layer. */
const pathIdsOf = new WeakMap<object, Map<string, string>>();

const NO_WARNINGS = Object.freeze([]) as unknown as string[];

/** Barcode values the encoder refused go to the Issues list as hints, with
 *  their layer; everything else is a line under "Last render". */
function splitWarnings(
	warnings: PaintWarning[],
	pathIds: Map<string, string> | undefined,
): { warnings: string[]; barcodes: BarcodeIssue[] } {
	const out = { warnings: [] as string[], barcodes: [] as BarcodeIssue[] };
	for (const w of warnings) {
		if (w.kind === "barcode_invalid") {
			const key = w.layer ? pathIds?.get(w.layer) : undefined;
			out.barcodes.push({
				...(key ? { key } : {}),
				symbology: w.symbology,
				value: w.value,
				message: w.message,
			});
		} else out.warnings.push(describeWarning(w));
	}
	if (out.warnings.length === 0) out.warnings = NO_WARNINGS;
	return out;
}

function describeWarning(w: PaintWarning): string {
	switch (w.kind) {
		case "image_load_failed":
			return `Couldn't load image: ${w.src.startsWith("data:") ? "inline data" : w.src}`;
		case "font_load_failed":
			return `Couldn't load font: ${w.family}`;
		case "qr_generate_failed":
			return `Couldn't generate QR code: ${w.value}`;
		case "barcode_unavailable":
			return "Couldn't load the barcode encoder, so barcodes draw as placeholders";
		case "unhandled_op":
			return `Unhandled draw op: ${w.op}`;
		case "adjust_unsupported":
			return `Adjustment skipped: ${w.component}`;
		default:
			return w.kind;
	}
}

type Held = { done: Promise<void>; release(): void };

function held(): Held {
	let release = () => {};
	const done = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { done, release };
}

function exposeForTests(
	session: RenderSession,
	scheduler: { stats(): unknown; idle(): Promise<void> },
	heldForPhotos: { readonly current: Held | null },
	snapshot: () => Promise<HTMLCanvasElement>,
) {
	const w = window as unknown as { __freshcoat?: Record<string, unknown> };
	w.__freshcoat = {
		...w.__freshcoat,
		cacheStats: () => session.stats(),
		renderStats: () => scheduler.stats(),
		renderIdle: async () => {
			for (let h = heldForPhotos.current; h; h = heldForPhotos.current)
				await h.done;
			await scheduler.idle();
		},
		snapshot,
	};
}

/** The long edge the Edit canvas decodes dataset photos at. */
function liveEdge(): number {
	if (typeof window === "undefined") return 2048;
	return previewEdge(
		{ width: window.innerWidth, height: window.innerHeight },
		window.devicePixelRatio || 1,
	);
}

const merged = new WeakMap<
	Map<string, Uint8Array>,
	WeakMap<Map<string, Uint8Array>, Map<string, Uint8Array>>
>();

/** The template's own images plus the record's dataset photos, which image
 *  cells reference as `ws:<sha256>`. Stable per pair, so the render env is
 *  only rebuilt when either changes. */
function withDatasetImages(
	images: Map<string, Uint8Array>,
	photos: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
	if (photos.size === 0) return images;
	let byPhotos = merged.get(images);
	if (!byPhotos) {
		byPhotos = new WeakMap();
		merged.set(images, byPhotos);
	}
	const hit = byPhotos.get(photos);
	if (hit) return hit;
	const out = new Map(images);
	for (const [ref, bytes] of photos) out.set(ref, bytes);
	byPhotos.set(photos, out);
	return out;
}
