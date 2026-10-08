import type { CanvasKit } from "canvaskit-wasm";
import { paintScene } from "./canvaskit";
import { compileScene, prepareScene } from "./compile-scene";
import type { DecodedPixels } from "./decode";
import {
	type ExportSetting,
	exportPixelSize,
	resolveExportScale,
	resolveSupersample,
} from "./export-scale";
import { fontBytes, resolveFontRequest } from "./font-bytes";
import {
	createSharedFontProvider,
	type SharedFontProvider,
} from "./font-collection";
import { deriveFontMetrics } from "./font-metrics";
import { type ByteLoader, fetchLoader, mapLoader } from "./loader";
import type { Node } from "./node";
import {
	createPaintCache,
	type PaintCache,
	type PaintCacheOptions,
	type PaintCacheStats,
} from "./paint-cache";
import { forgetImage, paintCacheState } from "./paint-cache-state";
import { createParagraphEngine } from "./paragraph-layout";
import type { EncodeFormat, EncodeOptions } from "./png";
import {
	type CachedTextEngine,
	memoizeTextEngine,
	type TextEngineCacheStats,
} from "./text-cache";
import type { TextEngine } from "./text-engine";
import type { CanvasLike, PaintOutput } from "./runtime-types";
import type {
	Command,
	FontRequest,
	FontVMetrics,
	FrameFinish,
	PaintWarning,
} from "./types";
import type { Precision } from "./color-policy";
import type { CompileSceneOptions } from "./compile-scene";

/** Font bytes, or srcs read through the renderer's loader, by family. */
export type FontSources = Record<string, Array<Uint8Array | string>>;

export type SurfaceCanvas = HTMLCanvasElement | OffscreenCanvas;

export type RendererOptions = {
	ck: CanvasKit;
	/** Image bytes and local font files. Default: fetchLoader. */
	load?: ByteLoader;
	fonts?: FontSources;
	/**
	 * Where surfaces are made. "offscreen" (the default) is a CPU raster with
	 * exact pixels. A factory gives GPU-backed surfaces on the canvases it makes,
	 * which the `canvas` output hands back.
	 */
	surface?: "offscreen" | ((width: number, height: number) => SurfaceCanvas);
	/** Decoded images, SVG pictures, paths and the surface kept across paints. */
	cache?: PaintCacheOptions | false;
};

export type Output = { encode: EncodeOptions } | { pixels: true } | { canvas: true };
export type DefaultOutput = { encode: EncodeOptions };

export type FrameInfo = {
	warnings: PaintWarning[];
	/** Pixel size of the result. */
	width: number;
	height: number;
	scale: number;
	supersample: number;
};
export type EncodedFrame = FrameInfo & { bytes: Uint8Array; format: EncodeFormat };
export type PixelsFrame = FrameInfo & { pixels: DecodedPixels };
/**
 * A live canvas. With a cache the renderer reuses it on the next paint, so read
 * it before painting again; without one, `release()` frees it.
 */
export type CanvasFrame = FrameInfo & { canvas: SurfaceCanvas; release(): void };
export type FrameFor<O extends Output> = O extends { canvas: true }
	? CanvasFrame
	: O extends { pixels: true }
		? PixelsFrame
		: EncodedFrame;
export type RenderedFrame = EncodedFrame | PixelsFrame | CanvasFrame;

export type PaintOptions<O extends Output = DefaultOutput> = {
	/**
	 * Bytes for this paint only, by src. A src whose bytes change between paints
	 * is decoded again; srcs read through the loader are assumed stable.
	 */
	images?: Map<string, Uint8Array>;
	/** Default: PNG. */
	output?: O;
};

export type RenderOptions<O extends Output = DefaultOutput> = PaintOptions<O> & {
	/** The design size: layout and text shaping happen here. */
	width: number;
	height: number;
	/** Pixel density of the result. Default 1. */
	scale?: number;
	supersample?: number;
	/** A Figma-style export setting, in place of `scale` and `supersample`. */
	export?: ExportSetting;
	finish?: FrameFinish;
	leadingTrim?: boolean;
	/** Working precision of the surface and its layers. Default "u8". */
	precision?: Precision;
};

export type RendererCompileOptions = Omit<
	CompileSceneOptions,
	"textEngine" | "measure" | "fontMetrics"
>;

export type FontLoadReport = {
	failed: Array<{ family: string; error: string }>;
};

export type RendererStats = {
	fonts: string[];
	paintCache?: PaintCacheStats;
	text?: TextEngineCacheStats;
};

export type Renderer = {
	readonly ck: CanvasKit;
	/** Every family the renderer holds bytes for. */
	readonly fonts: ReadonlyMap<string, Uint8Array[]>;
	render<O extends Output = DefaultOutput>(
		scene: Node,
		options: RenderOptions<O>,
	): Promise<FrameFor<O>>;
	/** Resolves layout and line heights, as compile does first. */
	prepare(scene: Node): Node;
	compile(scene: Node, options: RendererCompileOptions): Command[];
	paint<O extends Output = DefaultOutput>(
		commands: Command[],
		options?: PaintOptions<O>,
	): Promise<FrameFor<O>>;
	/** Bytes for a src, as a paint with these per-call images would read them. */
	loadBytes(src: string, images?: Map<string, Uint8Array>): Promise<Uint8Array>;
	addFonts(fonts: FontSources): Promise<void>;
	/** Loads the families these requests describe that the renderer lacks. */
	loadFonts(requests: readonly FontRequest[]): Promise<FontLoadReport>;
	stats(): RendererStats;
	/** Frees the cached surface and images; the next paint rebuilds them, as
	 *  after a lost GPU context. */
	clear(): void;
	dispose(): void;
};

type Text = {
	fonts: Map<string, Uint8Array[]>;
	engine: CachedTextEngine<TextEngine & { dispose(): void }>;
	metrics: Record<string, FontVMetrics>;
};

export async function createRenderer(options: RendererOptions): Promise<Renderer> {
	const { ck } = options;
	const load = options.load ?? fetchLoader;
	const factory = typeof options.surface === "function" ? options.surface : null;
	const cache: PaintCache | null =
		options.cache === false ? null : createPaintCache(options.cache);

	let fonts = new Map<string, Uint8Array[]>();
	// The descriptor each loaded family came from, so a family re-pointed at
	// another file is loaded again rather than served the old bytes.
	const fontKeys = new Map<string, string>();
	let text: Text | null = null;
	// The one provider layout and paint share, and the fonts map it holds.
	let fontSet: {
		fonts: Map<string, Uint8Array[]>;
		provider: SharedFontProvider;
	} | null = null;
	// Bytes a paint was handed per src, compared by identity on the next paint.
	const perCall = new Map<string, Uint8Array>();
	// One paint at a time: the cache, its surface and CanvasKit are shared.
	let queue: Promise<unknown> = Promise.resolve();
	let disposed = false;

	const alive = () => {
		if (disposed) throw new Error("renderer is disposed");
	};

	const fontProvider = (): SharedFontProvider => {
		if (fontSet?.fonts === fonts) return fontSet.provider;
		if (fontSet?.provider.extend(fonts)) fontSet.fonts = fonts;
		else {
			fontSet?.provider.release();
			fontSet = null;
			fontSet = { fonts, provider: createSharedFontProvider(ck, fonts) };
		}
		return fontSet.provider;
	};

	const textFor = (): Text => {
		if (text?.fonts !== fonts) {
			text?.engine.dispose();
			text = null;
			text = {
				fonts,
				engine: memoizeTextEngine(
					createParagraphEngine(ck, fonts, fontProvider()),
				),
				metrics: deriveFontMetrics(fonts),
			};
		}
		return text;
	};

	const resolveSources = async (sources: FontSources) =>
		Promise.all(
			Object.entries(sources).map(
				async ([family, list]) =>
					[
						family,
						await Promise.all(
							list.map((s) => (typeof s === "string" ? load(s) : s)),
						),
					] as const,
			),
		);

	const setFonts = (entries: ReadonlyArray<readonly [string, Uint8Array[]]>) => {
		if (entries.length === 0) return;
		fonts = new Map([...fonts, ...entries]);
	};

	const serial = <T>(task: () => Promise<T>): Promise<T> => {
		const run = queue.then(task, task);
		queue = run.catch(() => {});
		return run;
	};

	const doPaint = async <O extends Output>(
		commands: Command[],
		paintOptions: PaintOptions<O> | undefined,
	): Promise<FrameFor<O>> => {
		alive();
		const output = (paintOptions?.output ?? { encode: {} }) as Output;
		if ("canvas" in output && !factory)
			throw new Error('the "canvas" output needs a surface factory');
		const images = paintOptions?.images;
		if (cache && images) {
			const state = paintCacheState(cache);
			for (const [src, bytes] of images) {
				if (perCall.get(src) === bytes) continue;
				forgetImage(state, src);
				perCall.set(src, bytes);
			}
		}
		// Held across the paint's awaits, which a setFonts can land between.
		const shared = fontProvider();
		shared.retain();
		let result: PaintOutput;
		try {
			result = await paintScene(
				ck,
				commands,
				{
					resolveFont: (req) => resolveFontRequest(req, fonts),
					fonts,
					loadBytes: mapLoader(images, load),
					...(cache ? { cache } : {}),
					...(factory
						? {
								canvas: {
									createCanvas: (w, h) =>
										factory(w, h) as unknown as CanvasLike,
								},
							}
						: {}),
				},
				{ fontProvider: shared },
			);
		} finally {
			shared.release();
		}
		const info = frameInfo(commands, result.warnings);
		if ("canvas" in output) {
			return {
				...info,
				canvas: result.canvas as unknown as SurfaceCanvas,
				release: result.dispose,
			} as FrameFor<O>;
		}
		try {
			if ("pixels" in output) {
				const pixels = result.readPixels?.();
				if (!pixels) throw new Error("the painted surface could not be read back");
				return { ...info, pixels } as FrameFor<O>;
			}
			const encoded = await result.encode(output.encode);
			return { ...info, ...encoded } as FrameFor<O>;
		} finally {
			result.dispose();
		}
	};

	const renderer: Renderer = {
		ck,
		get fonts() {
			return fonts;
		},
		render(scene, renderOptions) {
			alive();
			const design = { width: renderOptions.width, height: renderOptions.height };
			const setting: ExportSetting = renderOptions.export ?? {
				constraint: { kind: "scale", value: renderOptions.scale ?? 1 },
				supersample: renderOptions.supersample,
			};
			const scale = resolveExportScale(setting.constraint, design);
			const supersample = resolveSupersample(setting.supersample, design, scale);
			return serial(() => {
				const commands = renderer.compile(scene, {
					...design,
					finish: renderOptions.finish,
					leadingTrim: renderOptions.leadingTrim,
					precision: renderOptions.precision,
					...(scale !== 1 ? { scale } : {}),
					...(supersample !== 1 ? { supersample } : {}),
				});
				return doPaint(commands, renderOptions);
			});
		},
		prepare(scene) {
			alive();
			const { engine, metrics } = textFor();
			return prepareScene(scene, { textEngine: engine, fontMetrics: metrics });
		},
		compile(scene, compileOptions) {
			alive();
			const { engine, metrics } = textFor();
			return compileScene(scene, {
				...compileOptions,
				textEngine: engine,
				fontMetrics: metrics,
			});
		},
		paint(commands, paintOptions) {
			alive();
			return serial(() => doPaint(commands, paintOptions));
		},
		loadBytes(src, images) {
			return mapLoader(images, load)(src);
		},
		async addFonts(sources) {
			alive();
			setFonts(await resolveSources(sources));
		},
		async loadFonts(requests) {
			alive();
			const failed: FontLoadReport["failed"] = [];
			const loaded: Array<readonly [string, Uint8Array[]]> = [];
			await Promise.all(
				requests.map(async (req) => {
					if (!("descriptor" in req)) return;
					const key = JSON.stringify(req.descriptor);
					// Bytes given directly win over a descriptor, as they do when painting.
					if (fonts.has(req.family) && (fontKeys.get(req.family) ?? key) === key)
						return;
					try {
						const bytes = (await fontBytes(resolveFontRequest(req), load)).filter(
							(b) => b.length > 0,
						);
						if (bytes.length === 0) throw new Error("no font files");
						fontKeys.set(req.family, key);
						loaded.push([req.family, bytes]);
					} catch (e) {
						failed.push({
							family: req.family,
							error: e instanceof Error ? e.message : String(e),
						});
					}
				}),
			);
			setFonts(loaded);
			return { failed };
		},
		stats() {
			return {
				fonts: [...fonts.keys()],
				...(cache ? { paintCache: cache.stats() } : {}),
				...(text ? { text: text.engine.cacheStats() } : {}),
			};
		},
		clear() {
			alive();
			cache?.clear();
			perCall.clear();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			text?.engine.dispose();
			text = null;
			cache?.dispose();
			fontSet?.provider.release();
			fontSet = null;
		},
	};

	if (options.fonts) await renderer.addFonts(options.fonts);
	return renderer;
}

function frameInfo(commands: Command[], warnings: PaintWarning[]): FrameInfo {
	const first = commands[0];
	if (first?.op !== "createCanvas")
		throw new Error("a compiled scene starts with createCanvas");
	const scale = first.scale ?? 1;
	return {
		warnings,
		...exportPixelSize(first, scale),
		scale,
		supersample: first.supersample ?? 1,
	};
}
