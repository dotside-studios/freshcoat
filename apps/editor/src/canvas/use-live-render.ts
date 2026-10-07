import { useEffect, useMemo, useRef, useState } from "react";
import { useController } from "~/app/context";
import { previewEdge, usePreviewImages } from "~/data/thumbnails";
import { getCanvasKit } from "~/render/canvaskit";
import {
	createMainBackend,
	type LiveBackend,
	type LiveRequest,
} from "~/render/live-frame";
import {
	createWorkerBackend,
	previewWorkerEnabled,
	type WorkerBackend,
} from "~/render/preview-client";
import {
	createRenderScheduler,
	type RenderScheduler,
} from "~/render/scheduler";
import { createRenderSession, displayDensity } from "~/render/session";
import { useDocumentFonts } from "~/render/use-document-fonts";
import { useEditor } from "~/state/hooks";
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
	// The main thread paints unless the worker is opted into and the browser
	// allows it, and again once the worker has failed.
	const [mode, setMode] = useState<"worker" | "main">(() =>
		previewWorkerEnabled() ? "worker" : "main",
	);
	const [ck, setCk] = useState<unknown>(null);
	const [activeScheduler, setScheduler] =
		useState<RenderScheduler<LiveRequest> | null>(null);

	useEffect(() => {
		if (mode !== "main") return;
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
	}, [controller, mode]);

	useEffect(() => {
		if (mode === "main" && !ck) return;
		let failed = false;
		let lastRequest: LiveRequest | null = null;
		const snapshotWaiters: ((c: HTMLCanvasElement) => void)[] = [];
		const worker =
			mode === "worker"
				? createWorkerBackend({
						onLost() {
							if (lastRequest) scheduler.request(lastRequest);
						},
						onFail() {
							failed = true;
							setMode("main");
						},
					})
				: null;
		const backend: LiveBackend =
			worker ?? createMainBackend(createRenderSession(ck));
		const scheduler = createRenderScheduler(
			(request: LiveRequest) => {
				lastRequest = request;
				return backend.render(request, {
					snapshot: snapshotWaiters.length > 0,
				});
			},
			{
				onResult(frame) {
					if (frame.snapshot)
						for (const resolve of snapshotWaiters.splice(0))
							resolve(frame.snapshot);
					setOutput((prev) =>
						prev?.canvas === frame.canvas && prev.scale === frame.scale
							? prev
							: { canvas: frame.canvas, scale: frame.scale },
					);
					controller.dispatch({
						type: "rendered",
						geometry: frame.geometry,
						timings: frame.timings,
						stats: scheduler.stats(),
						warnings: frame.warnings,
						barcodes: frame.barcodes,
					});
					exposeForTests({
						mode,
						backend,
						worker,
						scheduler,
						heldForPhotos,
						snapshot() {
							const request = lastRequest;
							if (!request)
								return Promise.reject(new Error("nothing rendered"));
							const copy = new Promise<HTMLCanvasElement>((resolve) =>
								snapshotWaiters.push(resolve),
							);
							scheduler.request(request);
							return copy;
						},
					});
				},
				onError(err) {
					// A failed worker hands over to the main thread, which renders
					// the same request again.
					if (failed) return;
					controller.dispatch({ type: "renderFailed", error: String(err) });
				},
			},
		);
		setScheduler(scheduler);
		return () => {
			setScheduler(null);
			scheduler.dispose();
			// A render may still be settling on the main thread; free the GPU
			// objects after it. A worker's go with it.
			if (worker) backend.dispose();
			else void scheduler.idle().then(() => backend.dispose());
		};
	}, [mode, ck, controller]);

	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	const density = template
		? displayDensity(zoom, dpr, {
				width: template.width,
				height: template.height,
			})
		: 1;

	useEffect(() => {
		if (
			!activeScheduler ||
			!template ||
			!fonts.fonts ||
			!template.template_data[side]
		)
			return;
		// Wait for the record's photos rather than paint them as missing.
		if (!datasetImages) {
			heldForPhotos.current ??= held();
			return;
		}
		activeScheduler.request({
			template,
			side,
			...(variantId !== undefined ? { variantId } : {}),
			hidden,
			values,
			fonts: fonts.fonts,
			photos: datasetImages,
			density,
		});
		heldForPhotos.current?.release();
		heldForPhotos.current = null;
	}, [
		activeScheduler,
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

type Held = { done: Promise<void>; release(): void };

function held(): Held {
	let release = () => {};
	const done = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { done, release };
}

function exposeForTests(hooks: {
	mode: "worker" | "main";
	backend: LiveBackend;
	worker: WorkerBackend | null;
	scheduler: RenderScheduler<LiveRequest>;
	heldForPhotos: { readonly current: Held | null };
	snapshot: () => Promise<HTMLCanvasElement>;
}) {
	const { backend, worker, scheduler, heldForPhotos } = hooks;
	const w = window as unknown as { __freshcoat?: Record<string, unknown> };
	w.__freshcoat = {
		...w.__freshcoat,
		previewMode: hooks.mode,
		cacheStats: () => backend.cacheStats(),
		renderStats: () => scheduler.stats(),
		renderIdle: async () => {
			for (let h = heldForPhotos.current; h; h = heldForPhotos.current)
				await h.done;
			await scheduler.idle();
		},
		snapshot: hooks.snapshot,
		...(worker ? { loseContext: () => worker.loseContext() } : {}),
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
