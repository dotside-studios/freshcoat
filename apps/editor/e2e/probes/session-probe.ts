import { fixtures } from "@freshcoat-js/coatfile/fixtures";
import { getCanvasKit } from "~/render/canvaskit";
import { createRenderSession } from "~/render/session";

export async function runSessionProbe(frames: number) {
	const ck = await getCanvasKit();
	const session = createRenderSession(ck);
	const template = fixtures.fullFeatureCard;
	const fonts = new Map<string, Uint8Array[]>();
	const images = new Map<string, Uint8Array>();
	const totals: number[] = [];
	const paints: number[] = [];
	const canvases = new Set<HTMLCanvasElement>();
	let probe: number[] = [];
	for (let i = 0; i < frames; i++) {
		const out = await session.render({
			template,
			images,
			values: { displayName: `Frame ${i}` },
			fonts,
			scale: 1,
			collect: () => null,
		});
		totals.push(out.timings.total);
		paints.push(out.timings.paint);
		canvases.add(out.canvas);
		if (i === frames - 1) {
			const c = document.createElement("canvas");
			c.width = out.canvas.width;
			c.height = out.canvas.height;
			const ctx = c.getContext("2d");
			ctx?.drawImage(out.canvas, 0, 0);
			probe = Array.from(
				ctx?.getImageData(10, 10, 1, 1).data ?? new Uint8ClampedArray(),
			);
		}
	}
	const stats = session.stats();
	session.dispose();
	const median = (xs: number[]) =>
		[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
	return {
		stats,
		canvases: canvases.size,
		first: totals[0],
		p50: median(totals),
		paintP50: median(paints),
		probe,
	};
}

/** The tools-site path: a fresh renderer, surface and text engine every render. */
export async function runUncachedProbe(frames: number) {
	const { renderTemplate } = await import("@freshcoat-js/coatfile/render");
	const { createRenderer } = await import("@freshcoat-js/engine");
	const ck = await getCanvasKit();
	const template = fixtures.fullFeatureCard;
	const totals: number[] = [];
	for (let i = 0; i < frames; i++) {
		const t0 = performance.now();
		const renderer = await createRenderer({
			ck,
			cache: false,
			surface: (width, height) => {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				return canvas;
			},
		});
		const results = await renderTemplate(
			renderer,
			template,
			{ displayName: `Frame ${i}` },
			{ output: { canvas: true } },
		);
		for (const r of results) r.release();
		renderer.dispose();
		totals.push(performance.now() - t0);
	}
	const sorted = [...totals].sort((a, b) => a - b);
	return { first: totals[0], p50: sorted[Math.floor(frames / 2)] };
}
