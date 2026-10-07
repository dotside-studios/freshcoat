import { createParagraphEngine, type Template } from "@freshcoat-js/coatfile";
import { deriveFontMetrics, memoizeTextEngine } from "@freshcoat-js/engine";
import { loadWorkerCanvasKit } from "~/render/canvaskit-worker";
import { checkAllGlyphs, type GlyphText } from "./glyph-preflight";
import type { GlyphWorkerReply, GlyphWorkerRequest } from "./protocol";

type Scope = {
	postMessage(message: GlyphWorkerReply): void;
	onmessage: ((event: MessageEvent<GlyphWorkerRequest>) => void) | null;
};
const scope = self as unknown as Scope;

let template: Template | undefined;
let text: (GlyphText & { dispose(): void }) | undefined;
let latest = 0;

async function handle(msg: GlyphWorkerRequest) {
	const ck = await loadWorkerCanvasKit(__CANVASKIT_BASE__);
	if (msg.template) template = msg.template;
	if (msg.fonts) {
		text?.dispose();
		const fonts = new Map(msg.fonts);
		const engine = createParagraphEngine(ck, fonts);
		text = {
			textEngine: memoizeTextEngine(engine),
			fontMetrics: deriveFontMetrics(fonts),
			dispose: engine.dispose,
		};
	}
	if (!template || !text) throw new Error("nothing to check");
	return checkAllGlyphs(template, msg.items, text, () => latest !== msg.id);
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
