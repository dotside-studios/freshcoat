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
	type DefaultOutput,
	type ExportSetting,
	exportPixelSize,
	type FrameFinish,
	type FrameFor,
	type ImageNode,
	missingGlyphs,
	type Node,
	type Output,
	type Renderer,
	resolveExportScale,
	resolveSupersample,
	sampleImageNode,
	withExportScale,
} from "@freshcoat-js/engine";
import { compile } from "./compile";
import type {
	CompiledTemplate,
	FrameWarning,
	PrintWarning,
	Template,
} from "./types";
import { variantSize } from "./variants";

// A painted side: what the renderer returned, tagged with the frame it was
// rendered from and the export setting it was rendered at. `width`/`height`,
// `scale` and `supersample` are the result's real values, after any clamp.
export type TemplateFrame<O extends Output = DefaultOutput> = Omit<
	FrameFor<O>,
	"warnings"
> & {
	warnings: FrameWarning[];
	name: string;
	// The export setting's suffix, carried through untouched.
	suffix?: string;
	/** Where the trim lies in the pixels, when the render includes bleed. */
	trim?: { x: number; y: number; width: number; height: number };
};

// Print-optimization toggle. When enabled, each frame's node tree is run through
// @freshcoat-js/for-print's planner (per-layer print corrections attached as freshcoat
// adjustments) and a whole-frame finish is applied, so cards render print-ready
// without the caller wiring the planner itself. Off by default; `true` uses the
// defaults below.
export type PrintRenderOptions = {
	// Analyze each photo per-image (decode + correct with its own recommendation).
	// Off = sync, preset-based planning (no image decode). Default: false.
	analyze?: boolean;
	// Per-intent correction policy (see for-print PlanPolicy). Default: photos -> YMCKO.
	policy?: PlanPolicy;
	// Whole-frame finishing pass. Default: YMCKO_FINISH. Pass `false` to disable.
	finish?: FrameFinish | false;
	// The printer's measured cast (see for-print PrintProfile), applied as the
	// finish's curve, including when `finish` is false.
	balance?: ChannelBalance;
};

// What to paint out of an already-compiled template.
export type RenderCompiledOptions<O extends Output = DefaultOutput> = {
	// Restrict to these frames (e.g. only the visible side). Omit = all.
	frameNames?: string[];
	// Enable print optimization (see PrintRenderOptions). Omit/false = passthrough.
	print?: boolean | PrintRenderOptions;
	// Figma-style export settings: one result per frame PER setting, each at
	// that setting's density. Omit = a single 1x export.
	exports?: ExportSetting[];
	// Keeps print analyses across renders, so a batch analyzes each distinct
	// image once. The caller owns it.
	analysisCache?: AnalysisCache;
	// A short stable key for an image src, such as its asset's sha256, for
	// `analysisCache`. Undefined falls back to a hash of the src.
	analysisKey?: (src: string) => string | undefined;
	// Image bytes for this render only, by src (see the renderer's PaintOptions).
	images?: Map<string, Uint8Array>;
	// Default: PNG.
	output?: O;
};

// The two sizes here are different knobs, and mixing them up is the easy mistake:
//
//   `width`/`height`   the size the template is COMPILED at. compile() rescales
//                      the design into that box, so layout, wrapping and text
//                      shaping all happen there. This is the design size, and
//                      defaults to the template's own.
//   `exports`          the density that compiled scene is RASTERIZED at, exactly
//                      like a row in Figma's export panel. Layout is untouched;
//                      only the pixel count changes.
//
// So a 1013x638 card exported at 2x gives a 2026x1276 image of the same layout,
// not the layout a 2026-wide compile would have produced. The scene is compiled
// ONCE per frame and painted once per setting, so extra densities cost a paint,
// not a re-bake.
export type RenderTemplateOptions<O extends Output = DefaultOutput> =
	RenderCompiledOptions<O> & {
		width?: number;
		height?: number;
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
function resolvePrint(
	print: RenderCompiledOptions["print"],
): ResolvedPrint | null {
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
): PrintWarning[] {
	const out: PrintWarning[] = [];
	for (const { analysis, node } of analyses) {
		const { clipped, pullback } = analysis.gamut;
		if (clipped < GAMUT_REPORT_FLOOR) continue;
		out.push({ kind: "gamut_compressed", layer: node.src, clipped, pullback });
	}
	return out;
}

function scaleBox(
	box: NonNullable<CompiledTemplate["trim"]>,
	scale: number,
): NonNullable<TemplateFrame["trim"]> {
	return {
		x: box.x * scale,
		y: box.y * scale,
		width: box.width * scale,
		height: box.height * scale,
	};
}

// Compile a template and paint each of its sides. The template's fonts load
// through the renderer.
export async function renderTemplate<O extends Output = DefaultOutput>(
	renderer: Renderer,
	template: Template,
	values: Record<string, unknown>,
	options: RenderTemplateOptions<O> = {},
): Promise<Array<TemplateFrame<O>>> {
	// Without an encoder a barcode draws as a placeholder; a failed load still
	// renders, and the placeholder's warning says why.
	const size = variantSize(template, options.variantId);
	const compiled = compile(template, values, {
		width: options.width ?? size.width,
		height: options.height ?? size.height,
		variantId: options.variantId,
		...(options.frameNames ? { frameNames: options.frameNames } : {}),
		...(options.bleed ? { bleed: true } : {}),
	});
	return renderCompiled(renderer, compiled, options);
}

// Paint an already-compiled template, one result per frame and export setting.
// Use this when the node tree is needed first, or for a scene compiled
// elsewhere. Fonts the frames describe load through the renderer; one that
// fails paints with a fallback face and a `font_load_failed` warning.
export async function renderCompiled<O extends Output = DefaultOutput>(
	renderer: Renderer,
	compiled: CompiledTemplate,
	options: RenderCompiledOptions<O> = {},
): Promise<Array<TemplateFrame<O>>> {
	const frames = compiled.frames.filter(
		(f) => !options.frameNames || options.frameNames.includes(f.name),
	);
	await renderer.loadFonts(frames.flatMap((f) => f.assets.fonts));
	const print = resolvePrint(options.print);
	// Analyze the layer AS RENDERED: draw the image into its own box honoring `fit`
	// (a cover crop shows only part of the source), bounded to a small buffer, then
	// read those pixels. The engine owns the CanvasKit calls, so for-print's
	// analysis stays canvas-free.
	const sample: ImageSampler = async (node) => {
		const pixels = await sampleImageNode(
			renderer.ck,
			node,
			(src) => renderer.loadBytes(src, options.images),
			{ maxDim: 256 },
		);
		if (!pixels) throw new Error(`print analyze: could not sample ${node.src}`);
		return pixels;
	};
	const analyzeOptions: PrintPlanOptions = {
		...(options.analysisCache ? { cache: options.analysisCache } : {}),
		...(options.analysisKey ? { srcKey: options.analysisKey } : {}),
	};
	// No export settings = the one 1x export, so the common case is unchanged.
	const settings: ExportSetting[] = options.exports?.length
		? options.exports
		: [{}];
	const design = { width: compiled.width, height: compiled.height };
	const results: Array<TemplateFrame<O>> = [];
	for (const f of frames) {
		// Analyze-as-rendered needs each image's resolved box, but compile prepares
		// the scene only when it runs (below), after planning. So the analyze path
		// prepares first, plans on the absolute tree, and tells compile the tree is
		// already prepared: preparation is not idempotent, and a second pass folds
		// every static container's own pos into its children again, sliding whole
		// layers off their boxes. The sync/preset path is size-independent and
		// skips this.
		const prepared = print?.analyze === true;
		const scene = prepared ? renderer.prepare(f.root as Node) : (f.root as Node);
		const analyses: Array<{ analysis: ImageAnalysis; node: ImageNode }> = [];
		const plan = print
			? await planFrame(scene, print, sample, {
					...analyzeOptions,
					onAnalysis: (analysis, node) => analyses.push({ analysis, node }),
				})
			: { scene, finish: undefined };
		const planWarnings = gamutWarnings(analyses);
		const commands = renderer.compile(plan.scene, {
			...design,
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
			const supersample = resolveSupersample(setting.supersample, design, scale);
			const result = await renderer.paint(withExportScale(commands, scale, supersample), {
				...(options.images ? { images: options.images } : {}),
				...(options.output ? { output: options.output } : {}),
			});
			results.push({
				...result,
				// Compile and planning found these, so they sit alongside what the
				// painter found.
				warnings: [...(f.warnings ?? []), ...result.warnings, ...planWarnings],
				name: f.name,
				scale,
				supersample,
				suffix: setting.suffix,
				...exportPixelSize(design, scale),
				...(compiled.trim ? { trim: scaleBox(compiled.trim, scale) } : {}),
			} as unknown as TemplateFrame<O>);
		}
	}
	return results;
}

export type FrameMissingGlyphs = {
	frame: string;
	// The element id of the text that lacks glyphs.
	id?: string;
	text: string;
	codepoints: number[];
};

// The characters each frame's text shaped without a glyph for, read off the
// layout compile bakes anyway, so nothing is painted. The renderer's cached
// text engine makes repeat records nearly free.
export function findMissingGlyphs(
	renderer: Renderer,
	compiled: CompiledTemplate,
	options: { frameNames?: string[] } = {},
): FrameMissingGlyphs[] {
	const out: FrameMissingGlyphs[] = [];
	for (const f of compiled.frames) {
		if (options.frameNames && !options.frameNames.includes(f.name)) continue;
		const commands = renderer.compile(f.root as Node, {
			width: compiled.width,
			height: compiled.height,
			fonts: f.assets.fonts,
			images: f.assets.images,
		});
		for (const m of missingGlyphs(commands)) out.push({ frame: f.name, ...m });
	}
	return out;
}

/** A render warning as one line of readable text. */
export function describeWarning(w: FrameWarning): string {
	switch (w.kind) {
		case "image_load_failed":
			return `Couldn't load image: ${w.src.startsWith("data:") ? "inline data" : w.src}`;
		case "svg_unsupported":
			return `SVG drawn without ${w.feature}: ${w.src.startsWith("data:") ? "inline data" : w.src}`;
		case "font_load_failed":
			return `Couldn't load font: ${w.family}`;
		case "unhandled_op":
			return `Unhandled draw op: ${w.op}`;
		case "adjust_unsupported":
			return `Adjustment skipped: ${w.component}`;
		case "text_path_overflow":
			return `Text runs past the end of its path${w.layer ? `: ${w.layer}` : ""}`;
		case "arc_text_overflow":
			return `Curved text is longer than its circle${w.layer ? `: ${w.layer}` : ""}`;
		case "arc_radius_clamped":
			return `Curved text radius raised to its font size${w.layer ? `: ${w.layer}` : ""}`;
		case "pattern_unsupported":
			return `Pattern shader failed, painted solid: ${w.pattern}`;
		case "barcode_invalid":
			return `Barcode: ${w.message}`;
		case "gamut_compressed":
			return `Colour pulled into printer range: ${Math.round(w.clipped * 100)}%${w.layer ? ` of ${w.layer}` : ""}`;
		default:
			return (w as { kind: string }).kind;
	}
}
