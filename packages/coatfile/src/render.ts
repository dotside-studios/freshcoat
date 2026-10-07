import {
	type AnalysisCache,
	type ChannelBalance,
	type ImageAnalysis,
	type ImageSampler,
	type PlanPolicy,
	type PrintPlan,
	type PrintPlanOptions,
	planForPrint,
} from "@freshcoat-js/for-print";
import {
	type Command,
	compileScene,
	createParagraphEngine,
	deriveFontMetrics,
	type EncodedPaintResult,
	type ExportSetting,
	exportPixelSize,
	type FontVMetrics,
	type FrameFinish,
	type ImageNode,
	type KeptPaintResult,
	missingGlyphs,
	type Node,
	type PaintCache,
	type PaintResult,
	type PaintRuntime,
	type PaintWarning,
	prepareScene,
	resolveExportScale,
	resolveSupersample,
	sampleImageNode,
	type TextEngine,
} from "@freshcoat-js/engine";
import { compile } from "./compile";
import type { CompiledTemplate, Template } from "./types";

// What a painted result is OF: the frame (side) it was rendered from, and the
// export setting it was rendered at. freshcoat paints one scene at a time and
// knows nothing about a card's sides or how many sizes a caller wants; coatfile
// — which owns both notions — tags each result here. `width`/`height` are the
// result's real pixel size and `scale` the density that produced it (both after
// any clamp), so a caller naming or caching files reads the numbers the pixels
// actually have. `supersample` is the sample rate those pixels were resolved
// from, also after clamping — it does not change the size, so a caller that
// asked for one and reads back 1 knows the request did not fit. `suffix` is the
// export setting's, carried through untouched.
export type ExportedAs = {
	name: string;
	scale: number;
	supersample: number;
	suffix?: string;
	width: number;
	height: number;
	/** Where the trim lies in the pixels, when the render includes bleed. */
	trim?: { x: number; y: number; width: number; height: number };
};

// A painted side. Kept/Encoded variants mirror the disposal policy of the env
// used (browser keeps the live canvas, server encodes to PNG).
export type PaintedFrame = PaintResult & ExportedAs;
export type KeptPaintedFrame = KeptPaintResult & ExportedAs;
export type EncodedPaintedFrame = EncodedPaintResult & ExportedAs;

// The ONE freshcoat environment a caller constructs (createBrowserEnv for a
// live canvas, createHeadlessEnv for offscreen → PNG). Everything else — the
// painter and the Paragraph text engine — is derived from `ck` here, so a
// consumer never touches freshcoat's rendering internals directly.
export type RenderRuntime = {
	// The CanvasKit-WASM instance the caller warmed.
	ck: unknown;
	env: PaintRuntime;
	// Font bytes per family (shaping + metrics). Omit for by-name/system fonts.
	fonts?: Map<string, Uint8Array[]>;
	// Per-family vertical metrics; derived from `fonts` when omitted.
	fontMetrics?: Record<string, FontVMetrics>;
	// A text engine built from `fonts`, reused across renders. The caller owns
	// it; one is created and disposed per call when omitted.
	textEngine?: TextEngine;
	// Keeps decoded images, SVG pictures, paths and the font provider across
	// paints, in place of any cache on `env`. The caller owns and disposes it.
	paintCache?: PaintCache;
	// Keeps print analyses across renders, so a batch analyzes each distinct
	// image once. The caller owns it.
	analysisCache?: AnalysisCache;
	// A short stable key for an image src, such as its asset's sha256, for
	// `analysisCache`. Undefined falls back to a hash of the src.
	analysisKey?: (src: string) => string | undefined;
};

// Print-optimization toggle. When enabled, each frame's node tree is run through
// @freshcoat-js/for-print's planner (per-layer print corrections attached as freshcoat
// adjustments) and a whole-frame finish is applied — so cards render print-ready
// without the caller wiring the planner itself. Off by default; `true` uses the
// defaults below.
export type PrintRenderOptions = {
	// Analyze each photo per-image (decode + correct with its own recommendation).
	// Off = sync, preset-based planning (no image decode). Default: false.
	analyze?: boolean;
	// Per-intent correction policy (see for-print PlanPolicy). Default: photos → YMCKO.
	policy?: PlanPolicy;
	// Whole-frame finishing pass. Default: YMCKO_FINISH. Pass `false` to disable.
	finish?: FrameFinish | false;
	// The printer's measured cast (see for-print PrintProfile), applied as the
	// finish's curve, including when `finish` is false.
	balance?: ChannelBalance;
};

// What to paint out of an already-compiled template.
export type ExportOptions = {
	// Restrict to these frames (e.g. only the visible side). Omit = all.
	frameNames?: string[];
	// Enable print optimization (see PrintRenderOptions). Omit/false = passthrough.
	print?: boolean | PrintRenderOptions;
	// Figma-style export settings — one painted result per frame PER setting, each
	// at that setting's density. Omit = a single 1× export.
	exports?: ExportSetting[];
};

// The two sizes here are different knobs, and mixing them up is the easy mistake:
//
//   `width`/`height`   — the size the template is COMPILED at. compile() rescales
//                        the design into that box, so layout, wrapping and text
//                        shaping all happen there. This is the design size.
//   `exports`          — the density that compiled scene is RASTERIZED at, exactly
//                        like a row in Figma's export panel. Layout is untouched;
//                        only the pixel count changes.
//
// So a 1013×638 card exported at 2× gives a 2026×1276 PNG of the same layout —
// not the layout a 2026-wide compile would have produced. Text and vectors
// re-rasterize at the higher resolution and images resample from their source, so
// the extra pixels carry real detail. The scene is compiled ONCE per frame and
// painted once per setting, so extra densities cost a paint, not a re-bake.
export type RenderOptions = ExportOptions & {
	width: number;
	height: number;
	variantId?: string;
	/** Include the template's bleed around the trim. Off by default, so the
	 *  output is the trim alone. */
	bleed?: boolean;
};

type ResolvedPrint = {
	analyze: boolean;
	plan: PrintPlanOptions;
};

// Normalize the toggle to concrete settings, or null when off.
function resolvePrint(print: RenderOptions["print"]): ResolvedPrint | null {
	if (!print) return null;
	const o = print === true ? {} : print;
	return {
		analyze: o.analyze ?? false,
		plan: {
			...(o.policy ? { policy: o.policy } : {}),
			...(o.balance ? { balance: o.balance } : {}),
			...(o.finish !== undefined ? { finish: o.finish } : {}),
		},
	};
}

// Plan one frame's tree. The analyze path renders each photo for a per-image
// recommendation; if it fails (e.g. a missing image that will paint a placeholder
// anyway) it falls back to the sync preset-based plan for that frame rather than
// failing the render.
async function planFrame(
	root: Node,
	print: ResolvedPrint,
	sample: ImageSampler,
	options: PrintPlanOptions,
): Promise<PrintPlan> {
	const plan = { ...print.plan, ...options };
	if (!print.analyze) return planForPrint(root, plan);
	try {
		return await planForPrint(root, { ...plan, sample });
	} catch {
		return planForPrint(root, plan);
	}
}

// Below this the correction is touching the very top of the range on a sliver of
// the frame, which every boost does and no operator needs told about.
const GAMUT_REPORT_FLOOR = 0.02;

// Turn a frame's analyses into the warnings its paint result carries. One per
// layer that gave up chroma: which layer and how much, so the number can be read
// against the preview rather than inferred from it.
function gamutWarnings(
	analyses: Array<{ analysis: ImageAnalysis; node: ImageNode }>,
): PaintWarning[] {
	const out: PaintWarning[] = [];
	for (const { analysis, node } of analyses) {
		const { clipped, pullback } = analysis.gamut;
		if (clipped < GAMUT_REPORT_FLOOR) continue;
		out.push({ kind: "gamut_compressed", layer: node.src, clipped, pullback });
	}
	return out;
}

// Retarget a compiled scene at an export setting. Both the density and the
// sample rate live on the scene's own `createCanvas` (freshcoat's paint-time
// contract), so a re-export is this one-command swap rather than a second
// compileScene. A field is set only when it is not 1×, keeping the stream
// identical to a scene compiled without export settings at all.
function atExport(
	commands: Command[],
	scale: number,
	supersample: number,
): Command[] {
	if (scale === 1 && supersample === 1) return commands;
	return commands.map((c) =>
		c.op === "createCanvas"
			? {
					...c,
					...(scale !== 1 ? { scale } : {}),
					...(supersample !== 1 ? { supersample } : {}),
				}
			: c,
	);
}

function scaleBox(
	box: NonNullable<CompiledTemplate["trim"]>,
	scale: number,
): NonNullable<ExportedAs["trim"]> {
	return {
		x: box.x * scale,
		y: box.y * scale,
		width: box.width * scale,
		height: box.height * scale,
	};
}

// Compile a template AND paint it — the one call a consumer needs. compile()
// builds the freshcoat node tree; freshcoat's compileScene resolves layout +
// bakes text + lowers; env.paint rasterizes. Returns one result per rendered
// side, tagged with its frame name.
export async function render(
	template: Template,
	values: Record<string, unknown>,
	opts: RenderOptions,
	runtime: RenderRuntime,
): Promise<PaintedFrame[]> {
	const compiled = compile(template, values, {
		width: opts.width,
		height: opts.height,
		variantId: opts.variantId,
		...(opts.bleed ? { bleed: true } : {}),
	});
	return renderCompiled(
		compiled,
		{
			frameNames: opts.frameNames,
			print: opts.print,
			exports: opts.exports,
		},
		runtime,
	);
}

// Paint an already-compiled template. Use this when you need the node tree first
// — e.g. to read `frame.assets.images` and pre-load disk assets into the env
// before painting. freshcoat paints one scene per call and has no notion of
// sides, so coatfile drives it once per frame and tags each result with the
// frame name.
export async function renderCompiled(
	compiled: CompiledTemplate,
	opts: ExportOptions,
	runtime: RenderRuntime,
): Promise<PaintedFrame[]> {
	const fonts = runtime.fonts ?? new Map<string, Uint8Array[]>();
	const fontMetrics = runtime.fontMetrics ?? deriveFontMetrics(fonts);
	// biome-ignore lint/suspicious/noExplicitAny: ck is the untyped WASM instance
	const ck = runtime.ck as any;
	const ownEngine = runtime.textEngine
		? undefined
		: createParagraphEngine(ck, fonts);
	const textEngine = runtime.textEngine ?? (ownEngine as TextEngine);
	const print = resolvePrint(opts.print);
	// Analyze the layer AS RENDERED: draw the image into its own box honoring `fit`
	// (a cover crop shows only part of the source), bounded to a small buffer, then
	// read those pixels. freshcoat owns the CanvasKit calls, so for-print's analysis
	// stays canvas-free.
	const sample: ImageSampler = async (node) => {
		const pixels = await sampleImageNode(ck, node, runtime.env.loadImageBytes, {
			maxDim: 256,
		});
		if (!pixels) throw new Error(`print analyze: could not sample ${node.src}`);
		return pixels;
	};
	const analyzeOptions: PrintPlanOptions = {
		...(runtime.analysisCache ? { cache: runtime.analysisCache } : {}),
		...(runtime.analysisKey ? { srcKey: runtime.analysisKey } : {}),
	};
	// No export settings = the one 1× export, so the common case is unchanged.
	const settings: ExportSetting[] = opts.exports?.length ? opts.exports : [{}];
	const design = { width: compiled.width, height: compiled.height };
	try {
		const frames = compiled.frames.filter(
			(f) => !opts.frameNames || opts.frameNames.includes(f.name),
		);
		const results: PaintedFrame[] = [];
		for (const f of frames) {
			// Analyze-as-rendered needs each image's resolved box, but compileScene
			// prepares the scene only when it runs (below) — after planning. So the
			// analyze path prepares first, plans on the absolute tree, and tells
			// compileScene the tree is already prepared: preparation is not
			// idempotent, and a second pass folds every static container's own pos
			// into its children again, sliding whole layers off their boxes. The
			// sync/preset path is size-independent and skips this.
			const prepared = print?.analyze === true;
			const scene = prepared
				? prepareScene(f.root as Node, { textEngine, fontMetrics })
				: (f.root as Node);
			const analyses: Array<{ analysis: ImageAnalysis; node: ImageNode }> = [];
			const plan = print
				? await planFrame(scene, print, sample, {
						...analyzeOptions,
						onAnalysis: (analysis, node) => analyses.push({ analysis, node }),
					})
				: { scene, finish: undefined };
			const planWarnings = gamutWarnings(analyses);
			const commands = compileScene(plan.scene, {
				width: compiled.width,
				height: compiled.height,
				textEngine,
				fontMetrics,
				fonts: f.assets.fonts,
				images: f.assets.images,
				finish: plan.finish,
				prepared,
			});
			// One bake, one paint per density: the command stream is identical across
			// export settings apart from the density on its createCanvas, so each
			// extra size re-rasterizes the same scene instead of re-compiling it.
			for (const setting of settings) {
				const scale = resolveExportScale(setting.constraint, design);
				const supersample = resolveSupersample(
					setting.supersample,
					design,
					scale,
				);
				const result = await runtime.env.paint(
					atExport(commands, scale, supersample),
					ck,
					runtime.paintCache ? { cache: runtime.paintCache } : undefined,
				);
				results.push({
					...result,
					// Compile and planning found these, so they sit alongside what the
					// painter found.
					warnings: [
						...(f.warnings ?? []),
						...result.warnings,
						...planWarnings,
					],
					name: f.name,
					scale,
					supersample,
					suffix: setting.suffix,
					...exportPixelSize(design, scale),
					...(compiled.trim ? { trim: scaleBox(compiled.trim, scale) } : {}),
				});
			}
		}
		return results;
	} finally {
		ownEngine?.dispose();
	}
}

export type FrameMissingGlyphs = {
	frame: string;
	// The element id of the text that lacks glyphs.
	id?: string;
	text: string;
	codepoints: number[];
};

// The characters each frame's text shaped without a glyph for, read off the
// layout compileScene bakes anyway, so nothing is painted. A cached
// `textEngine` makes repeat records nearly free.
export function findMissingGlyphs(
	compiled: CompiledTemplate,
	runtime: {
		textEngine: TextEngine;
		fontMetrics?: Record<string, FontVMetrics>;
		frameNames?: string[];
	},
): FrameMissingGlyphs[] {
	const out: FrameMissingGlyphs[] = [];
	for (const f of compiled.frames) {
		if (runtime.frameNames && !runtime.frameNames.includes(f.name)) continue;
		const commands = compileScene(f.root as Node, {
			width: compiled.width,
			height: compiled.height,
			textEngine: runtime.textEngine,
			...(runtime.fontMetrics ? { fontMetrics: runtime.fontMetrics } : {}),
			fonts: f.assets.fonts,
			images: f.assets.images,
		});
		for (const m of missingGlyphs(commands)) out.push({ frame: f.name, ...m });
	}
	return out;
}
