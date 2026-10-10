import type { Template } from "@freshcoat-js/coatfile";
import type { Renderer } from "@freshcoat-js/engine";
import { createItemRenderer, type ItemRenderer } from "./item";
import type {
	RenderWorkerReply,
	RenderWorkerRequest,
	WorkerRenderRequest,
} from "./worker-protocol";

/** The part of a worker's own scope `serveRenders` uses: a web worker's
 *  `self`, or a Node `parentPort` through an adapter. */
export type WorkerScope = {
	postMessage(message: RenderWorkerReply, transfer: Transferable[]): void;
	onmessage: ((event: { data: RenderWorkerRequest }) => void) | null;
	close(): void;
};

/**
 * Answers a `createWorkerPool` from inside a worker. `createRenderer` makes
 * the worker's renderer, with its CanvasKit and image loader, on the first
 * `init` or render; the fonts come with `init`.
 */
export function serveRenders(
	scope: WorkerScope,
	createRenderer: () => Promise<Renderer>,
): void {
	let renderer: Renderer | undefined;
	let items: ItemRenderer | undefined;
	let fonts = new Map<string, Uint8Array[]>();
	/** the template of the last render; the pool sends it only when it changes */
	let current: Template | undefined;

	async function itemRenderer(): Promise<ItemRenderer> {
		renderer ??= await createRenderer();
		items ??= createItemRenderer({ renderer, fonts });
		return items;
	}

	async function renderSide(req: WorkerRenderRequest) {
		if (req.template) current = req.template;
		const template = current;
		if (!template) throw new Error("no template");
		const out = await (await itemRenderer()).render({ ...req, template });
		return { ...out, bytes: ownBytes(out.bytes) };
	}

	function reply(message: RenderWorkerReply, transfer: Transferable[] = []) {
		scope.postMessage(message, transfer);
	}

	async function handle(msg: RenderWorkerRequest): Promise<void> {
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
	scope.onmessage = (event) => {
		const msg = event.data;
		queue = queue.then(() => handle(msg));
	};
}

/** A buffer the worker alone owns, so it can be transferred rather than copied. */
function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength &&
		bytes.buffer instanceof ArrayBuffer
		? (bytes as Uint8Array<ArrayBuffer>)
		: bytes.slice();
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
