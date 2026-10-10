import { isMainThread, parentPort, workerData } from "node:worker_threads";
import type { Template } from "@freshcoat-js/coatfile";
import { createRenderer } from "@freshcoat-js/engine";
import { fileLoader, loadCanvasKit } from "@freshcoat-js/engine/node";
import {
	createItemRenderer,
	IMAGE_CACHE_PIXELS,
	type RenderOutput,
	type RenderRequest,
} from "@freshcoat-js/workspace/export";

export const RENDER_WORKER = "freshcoat-render";

export type WorkerSetup = {
	role: typeof RENDER_WORKER;
	root: string;
	fonts: [string, Uint8Array[]][];
};

export type WorkerRequest =
	| {
			type: "render";
			id: number;
			request: Omit<RenderRequest, "template" | "images">;
			template?: Template;
			images: [string, Uint8Array][];
	  }
	| { type: "stop" };

export type WorkerReply =
	| { type: "ready"; error?: string }
	| { type: "render"; id: number; output: RenderOutput }
	| { type: "render"; id: number; error: string };

if (!isMainThread && (workerData as WorkerSetup | undefined)?.role === RENDER_WORKER)
	void serve(workerData as WorkerSetup);

async function serve(setup: WorkerSetup): Promise<void> {
	const port = parentPort;
	if (!port) return;
	const reply = (message: WorkerReply, transfer: ArrayBuffer[] = []) =>
		port.postMessage(message, transfer);
	let items: ReturnType<typeof createItemRenderer>;
	let dispose: () => void;
	try {
		const renderer = await createRenderer({
			ck: await loadCanvasKit("full"),
			load: fileLoader({ root: setup.root }),
			cache: { maxImagePixels: IMAGE_CACHE_PIXELS },
		});
		items = createItemRenderer({ renderer, fonts: new Map(setup.fonts) });
		dispose = () => {
			items.dispose();
			renderer.dispose();
		};
	} catch (error) {
		reply({ type: "ready", error: message(error) });
		return;
	}
	let template: Template | undefined;
	let queue = Promise.resolve();
	port.on("message", (msg: WorkerRequest) => {
		queue = queue.then(async () => {
			if (msg.type === "stop") {
				dispose();
				port.close();
				return;
			}
			if (msg.template) template = msg.template;
			try {
				if (!template) throw new Error("no template");
				const output = await items.render({
					...msg.request,
					template,
					images: msg.images.map(([ref, bytes]) => [ref, new Blob([bytes as Uint8Array<ArrayBuffer>])]),
				});
				const bytes = output.bytes.slice();
				reply({ type: "render", id: msg.id, output: { ...output, bytes } }, [bytes.buffer]);
			} catch (error) {
				reply({ type: "render", id: msg.id, error: message(error) });
			}
		});
	});
	reply({ type: "ready" });
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
