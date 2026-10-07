import { fixtures } from "@freshcoat-js/coatfile/fixtures";
import { createHeadlessEnv } from "@freshcoat-js/coatfile/headless";
import { render } from "@freshcoat-js/coatfile/render";
import { loadCanvasKit } from "@freshcoat-js/engine/browser";

self.onmessage = async () => {
	try {
		const t0 = performance.now();
		const ck = await loadCanvasKit(__CANVASKIT_BASE__);
		const t1 = performance.now();
		const tpl = fixtures.fullFeatureCard;
		const times: number[] = [];
		let bytes = 0;
		for (let i = 0; i < 5; i++) {
			const s = performance.now();
			const [r] = await render(
				tpl,
				{ displayName: `Worker ${i}` },
				{ width: tpl.width, height: tpl.height },
				{ ck, env: createHeadlessEnv({}) },
			);
			times.push(performance.now() - s);
			if (r && "bytes" in r) bytes = r.bytes.length;
		}
		self.postMessage({ init: t1 - t0, times, bytes });
	} catch (e) {
		self.postMessage({ error: String(e), stack: (e as Error).stack });
	}
};
