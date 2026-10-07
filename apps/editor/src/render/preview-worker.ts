import { loadWorkerCanvasKit } from "./canvaskit-worker";
import { renderLiveFrame } from "./live-frame";
import { createOffscreenEnv } from "./offscreen-env";
import type { PreviewReply, PreviewRequest } from "./preview-protocol";
import { createPreviewReceiver } from "./preview-sync";
import { createRenderSession, type RenderSession } from "./session";

// The Edit canvas's pipeline, off the main thread: compile, layout, lowering
// and paint run here, into an OffscreenCanvas, and each frame is handed to the
// canvas on screen as a bitmap.

type WorkerScope = {
	postMessage(message: PreviewReply, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<PreviewRequest>) => void) | null;
	close(): void;
};
const scope = self as unknown as WorkerScope;

const receiver = createPreviewReceiver();
let display:
	| { canvas: OffscreenCanvas; ctx: ImageBitmapRenderingContext }
	| undefined;
let session: RenderSession | undefined;
/** the canvas the current surface was made on */
let surfaceCanvas: OffscreenCanvas | undefined;
let lost = false;

function reply(message: PreviewReply, transfer: Transferable[] = []) {
	scope.postMessage(message, transfer);
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function watch(canvas: OffscreenCanvas) {
	surfaceCanvas = canvas;
	const onLost = () => {
		// A surface replaced for a new size loses its context on purpose, and
		// its replacement is made in the same task.
		queueMicrotask(() => {
			if (canvas !== surfaceCanvas || lost) return;
			lost = true;
			reply({ type: "lost" });
		});
	};
	canvas.addEventListener("webglcontextlost", onLost);
	canvas.addEventListener("contextlost", onLost);
}

async function init(canvas: OffscreenCanvas) {
	const ctx = canvas.getContext("bitmaprenderer");
	if (!ctx) throw new Error("no bitmaprenderer context in this worker");
	if (!new OffscreenCanvas(1, 1).getContext("2d"))
		throw new Error("no 2D OffscreenCanvas in this worker");
	display = { canvas, ctx };
	const ck = await loadWorkerCanvasKit(__CANVASKIT_BASE__);
	session = createRenderSession(ck, (opts) =>
		createOffscreenEnv({ ...opts, onCanvas: watch }),
	);
}

async function render(msg: Extract<PreviewRequest, { type: "render" }>) {
	const request = receiver.apply(msg.update);
	if (!session || !display) throw new Error("the preview worker is not ready");
	if (lost) {
		lost = false;
		session.reset();
	}
	const { canvas, ...result } = await renderLiveFrame(session, request);
	if (!(canvas instanceof OffscreenCanvas))
		throw new Error("the frame was painted off any canvas");
	const bitmap = canvas.transferToImageBitmap();
	const snapshot = msg.snapshot ? await createImageBitmap(bitmap) : undefined;
	if (
		display.canvas.width !== bitmap.width ||
		display.canvas.height !== bitmap.height
	) {
		display.canvas.width = bitmap.width;
		display.canvas.height = bitmap.height;
	}
	display.ctx.transferFromImageBitmap(bitmap);
	reply(
		{
			type: "render",
			id: msg.id,
			ok: true,
			...result,
			stats: session.stats(),
			...(snapshot ? { snapshot } : {}),
		},
		snapshot ? [snapshot] : [],
	);
}

function loseContext() {
	const c = surfaceCanvas as unknown as {
		getContext(id: string): {
			getExtension(name: string): { loseContext(): void } | null;
		} | null;
	};
	const gl = c?.getContext("webgl2") ?? c?.getContext("webgl");
	gl?.getExtension("WEBGL_lose_context")?.loseContext();
}

async function handle(msg: PreviewRequest): Promise<void> {
	switch (msg.type) {
		case "init":
			try {
				await init(msg.canvas);
				reply({ type: "ready", ok: true });
			} catch (e) {
				reply({ type: "ready", ok: false, error: errorText(e) });
			}
			return;
		case "render":
			try {
				await render(msg);
			} catch (e) {
				reply({ type: "render", id: msg.id, ok: false, error: errorText(e) });
			}
			return;
		case "loseContext":
			loseContext();
			return;
		case "dispose":
			session?.dispose();
			session = undefined;
			scope.close();
			return;
	}
}

// One message at a time, in order, so each render's update applies on top of
// the one before it.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<PreviewRequest>) => {
	const msg = event.data;
	queue = queue.then(() => handle(msg));
};
