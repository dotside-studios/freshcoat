import type { Template } from "@freshcoat-js/coatfile";
import { createRenderer, type Renderer } from "@freshcoat-js/engine";
import { getCanvasKit } from "~/render/canvaskit";
import { checkAllGlyphs } from "./glyph-preflight";
import type { GlyphWorkerReply, GlyphWorkerRequest } from "./protocol";

type Scope = {
	postMessage(message: GlyphWorkerReply): void;
	onmessage: ((event: MessageEvent<GlyphWorkerRequest>) => void) | null;
};
const scope = self as unknown as Scope;

let template: Template | undefined;
let renderer: Renderer | undefined;
let latest = 0;

async function handle(msg: GlyphWorkerRequest) {
	if (msg.template) template = msg.template;
	if (msg.fonts) {
		renderer?.dispose();
		renderer = await createRenderer({
			ck: await getCanvasKit(),
			fonts: Object.fromEntries(msg.fonts),
			cache: false,
		});
	}
	if (!template || !renderer) throw new Error("nothing to check");
	return checkAllGlyphs(template, msg.items, renderer, () => latest !== msg.id);
}

let queue: Promise<void> = Promise.resolve();
scope.onmessage = ({ data }) => {
	latest = data.id;
	queue = queue.then(async () => {
		try {
			const issues = await handle(data);
			if (issues) scope.postMessage({ type: "result", id: data.id, issues });
		} catch (e) {
			scope.postMessage({
				type: "error",
				id: data.id,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	});
};
