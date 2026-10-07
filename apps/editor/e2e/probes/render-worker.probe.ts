import { fixtures } from "@freshcoat-js/coatfile/fixtures";
import { renderTemplate } from "@freshcoat-js/coatfile/render";
import { createRenderer } from "@freshcoat-js/engine";
import { loadCanvasKit } from "@freshcoat-js/engine/browser";

self.onmessage = async () => {
	try {
		const t0 = performance.now();
		const renderer = await createRenderer({
			ck: await loadCanvasKit(__CANVASKIT_BASE__),
			cache: false,
		});
		const t1 = performance.now();
		const tpl = fixtures.fullFeatureCard;
		const times: number[] = [];
		let bytes = 0;
		for (let i = 0; i < 5; i++) {
			const s = performance.now();
			const [r] = await renderTemplate(renderer, tpl, {
				displayName: `Worker ${i}`,
			});
			times.push(performance.now() - s);
			if (r) bytes = r.bytes.length;
		}
		self.postMessage({ init: t1 - t0, times, bytes });
	} catch (e) {
		self.postMessage({ error: String(e), stack: (e as Error).stack });
	}
};
