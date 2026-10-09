import type { Template } from "@freshcoat-js/coatfile";
import { createRenderer, type Renderer } from "@freshcoat-js/engine";
import { loadCanvasKit as loadCanvasKitAt } from "@freshcoat-js/engine/browser";
import {
	createItemRenderer,
	IMAGE_CACHE_PIXELS,
	type ItemRenderer,
} from "@freshcoat-js/workspace/export";
import type {
	WorkerRenderRequest,
	WorkerReply,
	WorkerRequest,
} from "./protocol";

type WorkerScope = {
	postMessage(message: WorkerReply, transfer: Transferable[]): void;
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
	close(): void;
};
const scope = self as unknown as WorkerScope;

// The `full` build: the default one the editor's canvas uses has neither the
// JPEG nor the WebP encoder, and would answer every photo export in PNG.
const CANVASKIT_BASE = `${__CANVASKIT_BASE__}/full`;

let renderer: Renderer | undefined;
let items: ItemRenderer | undefined;
let fonts = new Map<string, Uint8Array[]>();
/** the template of the last render; the pool sends it only when it changes */
let current: Template | undefined;

async function itemRenderer(): Promise<ItemRenderer> {
	renderer ??= await createRenderer({
		ck: await loadCanvasKitAt(CANVASKIT_BASE),
		cache: { maxImagePixels: IMAGE_CACHE_PIXELS },
	});
	items ??= createItemRenderer({ renderer, fonts });
	return items;
}

/** A buffer the worker alone owns, so it can be transferred rather than copied. */
function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength &&
		bytes.buffer instanceof ArrayBuffer
		? (bytes as Uint8Array<ArrayBuffer>)
		: bytes.slice();
}

async function renderSide(req: WorkerRenderRequest) {
	if (req.template) current = req.template;
	const template = current;
	if (!template) throw new Error("no template");
	const out = await (await itemRenderer()).render({ ...req, template });
	return { ...out, bytes: ownBytes(out.bytes) };
}

function reply(message: WorkerReply, transfer: Transferable[] = []) {
	scope.postMessage(message, transfer);
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

async function handle(msg: WorkerRequest): Promise<void> {
	switch (msg.type) {
		case "init": {
			fonts = new Map(msg.fonts);
			items?.setFonts(fonts);
			const started = performance.now();
			try {
				await itemRenderer();
				reply({ type: "ready", ok: true, ms: performance.now() - started });
			} catch (e) {
				reply({ type: "ready", ok: false, error: errorText(e) });
			}
			return;
		}
		case "jobEnd":
			items?.endJob();
			return;
		case "render":
			try {
				const out = await renderSide(msg);
				reply({ type: "render", id: msg.id, ok: true, ...out }, [
					out.bytes.buffer,
				]);
			} catch (e) {
				reply({ type: "render", id: msg.id, ok: false, error: errorText(e) });
			}
			return;
		case "dispose":
			items?.dispose();
			items = undefined;
			renderer?.dispose();
			renderer = undefined;
			current = undefined;
			scope.close();
			return;
	}
}

// Messages are handled one at a time and in order, so an `init` sent before a
// `render` always applies to it, and a `jobEnd` waits for the renders before it.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const msg = event.data;
	queue = queue.then(() => handle(msg));
};
