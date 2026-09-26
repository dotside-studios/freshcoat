import { compile, getBarcodeEncoder, type Template } from "@freshcoat/coatfile";
import {
	type Command,
	compileScene,
	createPaintCache,
	createParagraphEngine,
	deriveFontMetrics,
	type FontVMetrics,
	memoizeTextEngine,
	type Node,
	type PaintCacheStats,
	type PaintWarning,
	prepareScene,
	resolveExportScale,
	type TextEngine,
} from "freshcoat";
import { createBrowserEnv } from "freshcoat/browser";
import { hasBarcode, loadBarcodeEncoder } from "./barcode";

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
	stats(): PaintCacheStats;
	dispose(): void;
};

/**
 * One CanvasKit pipeline kept warm across renders: the paint cache owns the
 * surface, font provider and decoded images, and the paragraph engine and font
 * metrics are rebuilt only when the fonts map changes identity.
 */
export function createRenderSession(ck: unknown): RenderSession {
	const cache = createPaintCache();
	let text: {
		fonts: Map<string, Uint8Array[]>;
		engine: TextEngine & { dispose(): void };
		metrics: Record<string, FontVMetrics>;
	} | null = null;
	let env: {
		fonts: Map<string, Uint8Array[]>;
		images: Map<string, Uint8Array>;
		runtime: ReturnType<typeof createBrowserEnv>;
	} | null = null;
	let disposed = false;

	const textFor = (fonts: Map<string, Uint8Array[]>) => {
		if (text?.fonts !== fonts) {
			text?.engine.dispose();
			text = {
				fonts,
				engine: memoizeTextEngine(createParagraphEngine(ck, fonts)),
				metrics: deriveFontMetrics(fonts),
			};
		}
		return text;
	};

	const envFor = (
		fonts: Map<string, Uint8Array[]>,
		images: Map<string, Uint8Array>,
	) => {
		if (env?.fonts !== fonts || env.images !== images) {
			env = {
				fonts,
				images,
				runtime: createBrowserEnv({ fonts, images, cache }),
			};
		}
		return env.runtime;
	};

	return {
		async render(input) {
			if (disposed) throw new Error("render session is disposed");
			const { template } = input;
			// Without the encoder a barcode draws as a placeholder; a failed load
			// still renders, and the placeholder's warning says why.
			if (!getBarcodeEncoder() && hasBarcode(template))
				await loadBarcodeEncoder().catch(() => {});
			const t0 = performance.now();
			const compiled = compile(template, input.values, {
				width: template.width,
				height: template.height,
			});
			const frame = compiled.frames[0];
			if (!frame) throw new Error("template has no side to render");
			const t1 = performance.now();

			const { engine, metrics } = textFor(input.fonts);
			const prepared = prepareScene(frame.root as Node, {
				textEngine: engine,
				fontMetrics: metrics,
			});
			const geometry = input.collect(prepared);
			const t2 = performance.now();

			const design = { width: template.width, height: template.height };
			const scale = resolveExportScale(
				{ kind: "scale", value: input.scale },
				design,
			);
			const commands: Command[] = compileScene(prepared, {
				...design,
				textEngine: engine,
				fontMetrics: metrics,
				fonts: frame.assets.fonts,
				images: frame.assets.images,
				prepared: true,
				...(scale !== 1 ? { scale } : {}),
			});
			const t3 = performance.now();

			const result = await envFor(input.fonts, input.images).paint(
				commands,
				ck,
			);
			const t4 = performance.now();
			if (!("canvas" in result))
				throw new Error("the browser runtime returned no canvas");

			return {
				canvas: result.canvas as unknown as HTMLCanvasElement,
				geometry,
				// compileScene is called directly here, so the compile warnings
				// renderCompiled would merge are read off the frame.
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
		stats: () => cache.stats(),
		dispose() {
			disposed = true;
			text?.engine.dispose();
			text = null;
			env = null;
			cache.dispose();
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
