import { fixtures } from "@freshcoat-js/coatfile/fixtures";
import { createHeadlessEnv } from "@freshcoat-js/coatfile/headless";
import { render } from "@freshcoat-js/coatfile/render";

async function loadCanvasKit(): Promise<unknown> {
	const src = await (await fetch(`${__CANVASKIT_BASE__}/canvaskit.js`)).text();
	// Indirect eval runs the classic script at global scope, where its
	// top-level `var CanvasKitInit` becomes a global, as a script tag would.
	// biome-ignore lint/security/noGlobalEval: loads canvaskit.js in a module worker
	const indirectEval = globalThis.eval;
	indirectEval(src);
	const init = (
		globalThis as { CanvasKitInit?: (o: unknown) => Promise<unknown> }
	).CanvasKitInit;
	if (!init) throw new Error("CanvasKitInit missing");
	return init({ locateFile: () => `${__CANVASKIT_BASE__}/canvaskit.wasm` });
}

self.onmessage = async () => {
	try {
		const t0 = performance.now();
		const ck = await loadCanvasKit();
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
