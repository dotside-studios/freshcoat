import { compile, type Template } from "@freshcoat-js/coatfile";
import {
	createRenderer,
	type Node,
	type PaintCacheStats,
	type PaintWarning,
	type Renderer,
	resolveExportScale,
	type SurfaceCanvas,
} from "@freshcoat-js/engine";
import type { CanvasKit } from "canvaskit-wasm";

export type RenderInput<G> = {
	/** A single-side template, ready to compile (see doc/preview). */
	template: Template;
	images: Map<string, Uint8Array>;
	values: Record<string, unknown>;
	fonts: Map<string, Uint8Array[]>;
	/** Device pixels per template unit. */
	scale: number;
	/** Reads layer boxes off the laid-out scene. */
	collect: (prepared: Node) => G;
};

export type RenderTimings = {
	compile: number;
	layout: number;
	lower: number;
	paint: number;
	total: number;
};

export type RenderOutput<G> = {
	canvas: HTMLCanvasElement;
	geometry: G;
	warnings: PaintWarning[];
	timings: RenderTimings;
	/** The density actually painted at, after the export clamp. */
	scale: number;
};

export type RenderSession = {
	render<G>(input: RenderInput<G>): Promise<RenderOutput<G>>;
	stats(): PaintCacheStats | undefined;
	/** Frees the surface and everything decoded, so the next render starts
	 *  over, as after a lost GPU context. */
	reset(): void;
	dispose(): void;
};

/** Makes the canvas each surface is painted on. */
export type SurfaceFactory = (width: number, height: number) => SurfaceCanvas;

const domCanvas: SurfaceFactory = (width, height) => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	return canvas;
};

/**
 * One renderer kept warm across renders: its paint cache owns the surface,
 * font provider and decoded images, and its paragraph engine and font metrics
 * are rebuilt only when the fonts map changes identity.
 */
export function createRenderSession(
	ck: CanvasKit,
	surface: SurfaceFactory = domCanvas,
): RenderSession {
	let renderer: Renderer | null = null;
	const ready = createRenderer({ ck, surface }).then((r) => {
		renderer = r;
		return r;
	});
	let fonts: Map<string, Uint8Array[]> | null = null;
	let disposed = false;

	return {
		async render(input) {
			if (disposed) throw new Error("render session is disposed");
			const r = await ready;
			const { template } = input;
			if (fonts !== input.fonts) {
				await r.addFonts(Object.fromEntries(input.fonts));
				fonts = input.fonts;
			}
			const t0 = performance.now();
			const compiled = compile(template, input.values, {
				width: template.width,
				height: template.height,
			});
			const frame = compiled.frames[0];
			if (!frame) throw new Error("template has no side to render");
			const t1 = performance.now();

			const prepared = r.prepare(frame.root as Node);
			const geometry = input.collect(prepared);
			const t2 = performance.now();

			const design = { width: template.width, height: template.height };
			const scale = resolveExportScale(
				{ kind: "scale", value: input.scale },
				design,
			);
			const commands = r.compile(prepared, {
				...design,
				fonts: frame.assets.fonts,
				images: frame.assets.images,
				prepared: true,
				...(scale !== 1 ? { scale } : {}),
			});
			const t3 = performance.now();

			const result = await r.paint(commands, {
				images: input.images,
				output: { canvas: true },
			});
			const t4 = performance.now();

			return {
				canvas: result.canvas as HTMLCanvasElement,
				geometry,
				// The scene is compiled here rather than through renderCompiled, so
				// the compile warnings are read off the frame.
				warnings: [...(frame.warnings ?? []), ...result.warnings],
				scale,
				timings: {
					compile: t1 - t0,
					layout: t2 - t1,
					lower: t3 - t2,
					paint: t4 - t3,
					total: t4 - t0,
				},
			};
		},
		stats: () => renderer?.stats().paintCache,
		reset: () => renderer?.clear(),
		dispose() {
			disposed = true;
			void ready.then((r) => r.dispose());
		},
	};
}

const DENSITY_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4];
const MAX_PIXELS = 8.3e6;

/** The density a side is painted at for a given zoom: the next step up from
 *  what the screen shows, capped at about 4K pixels. */
export function displayDensity(
	zoom: number,
	dpr: number,
	size: { width: number; height: number },
): number {
	const want = zoom * dpr;
	const step =
		DENSITY_STEPS.find((s) => s >= want - 1e-6) ?? DENSITY_STEPS.at(-1) ?? 1;
	const cap = Math.sqrt(MAX_PIXELS / (size.width * size.height));
	const capped = DENSITY_STEPS.filter((s) => s <= cap).at(-1) ?? 0.25;
	return Math.min(step, capped);
}
