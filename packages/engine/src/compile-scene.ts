// compileScene — the PURE compile: a Node tree → the flat Command IR the painter
// walks. No runtime, no painter, no pixels — painting is the separate
// env.paint(commands, ck) step.
//
// Geometric lowering (rect / ellipse→path / path / image / bitmap / group) plus
// text: a text node's glyphs are baked here via the injected TextEngine
// (bakeText), or taken verbatim from a pre-baked `layout`.
// When a `measure`/`textEngine` is supplied, `layout` (auto-layout) groups are
// resolved to absolute geometry first; otherwise nodes must carry absolute
// pos/size. freshcoat owns text *shaping* (the TextEngine) but knows nothing
// about templates — the caller delivers final resolved values on the nodes.
import { bakeText, resolveLeadingTrim, textClipOutset } from "./bake-text";
import { parseColor } from "./color";
import type { Precision } from "./color-policy";
import { metricsLookup, resolveAutoLineHeights } from "./line-height";
import type {
	EllipseNode,
	GroupNode,
	MaskNode,
	Node,
	RectNode,
	TextNode,
} from "./node";
import { rectShape } from "./outline";
import { strokeInset } from "./paint-helpers";
import { resolveLayout } from "./resolve-layout";
import type { TextEngine } from "./text-engine";
import type { MeasureText } from "./text-types";
import type {
	Command,
	DrawCommand,
	FontRequest,
	FontVMetrics,
	FrameFinish,
	ShapeMask,
	Size,
} from "./types";

export type CompileSceneOptions = {
	width: number;
	height: number;
	// The text engine used to bake unbaked text nodes AND (via its measureText)
	// to size text during layout resolution. Omit only when every text node is
	// already pre-baked and the tree carries absolute geometry.
	textEngine?: TextEngine;
	// Overrides `textEngine.measureText` for layout resolution (rarely needed).
	// If neither this nor `textEngine` is set, `layout` groups are left as-is
	// (the tree must already be absolute).
	measure?: MeasureText;
	// Figma "Cap height to baseline" for baked text (default true).
	leadingTrim?: boolean;
	// Per-family vertical metrics for baking (else the global registry).
	fontMetrics?: Record<string, FontVMetrics>;
	// Override the derived setup assets. A bare tree walk can only reconstruct
	// font families (`{ family }`); a caller that carries FontDescriptors (load
	// by URL) supplies them here. Each is used verbatim for its own setup op when
	// set; the other is still derived from the walk.
	fonts?: FontRequest[];
	images?: string[];
	// A whole-frame post-composite output pass (white-clamp / black-extract /
	// dither). Emitted as a trailing `finishFrame` command the painter runs after
	// all drawables. Omit = no finishing.
	finish?: FrameFinish;
	// The tree already went through prepareScene (auto line heights resolved,
	// layout flattened to absolute geometry), so skip that step. Preparation is
	// NOT idempotent — resolveLayout folds each static container's own pos into
	// its children, and a second pass folds it in again — so a caller that needs
	// the absolute tree before compiling (to measure or rewrite it) prepares once
	// and says so here rather than letting this redo it.
	prepared?: boolean;
	// Export density (see ./export-scale). The compile stays in design units at
	// `width`×`height` whatever this is — it rides along on `createCanvas` for the
	// painter to size its surface with. Omit/1 = 1×.
	scale?: number;
	// Render density above the export density (see ./export-scale). Like `scale`
	// it changes nothing here — including the text baking below, which snaps to
	// the grid the export LANDS on, not the denser one it passes through. Omit/1 =
	// render at the export size.
	supersample?: number;
	// Working precision (see ./color-policy). Omit = "u8".
	precision?: Precision;
};

type BakeCtx = {
	textEngine?: TextEngine;
	leadingTrim?: boolean;
	fontMetrics?: Record<string, FontVMetrics>;
	deviceScale?: number;
};

// Everything that has to happen to a tree before it can be lowered: AUTO line
// heights become the font's own line box, then `layout` groups resolve to
// absolute geometry. compileScene runs this itself; a caller that needs the
// absolute tree first (to measure a layer as rendered, or to rewrite it) runs it
// here and compiles with `prepared: true`.
//
// AUTO line heights resolve BEFORE layout: they change how tall a wrapped
// paragraph is, so resolving them after measuring would size every hug box to
// the wrong height.
export function prepareScene(
	root: Node,
	opts: Pick<CompileSceneOptions, "textEngine" | "measure" | "fontMetrics">,
): Node {
	const measure = opts.measure ?? opts.textEngine?.measureText;
	const authored = resolveAutoLineHeights(
		root,
		metricsLookup(opts.fontMetrics, opts.textEngine?.metricsFor),
	);
	return measure ? resolveLayout(authored, { measure }) : authored;
}

export function compileScene(root: Node, opts: CompileSceneOptions): Command[] {
	const scene = opts.prepared ? root : prepareScene(root, opts);

	// A 1× export leaves `scale` off the command entirely — the density is an
	// opt-in, and an absent field keeps the stream identical to what it was before
	// export scaling existed.
	const scale = opts.scale ?? 1;
	const supersample = opts.supersample ?? 1;
	const commands: Command[] = [
		{
			op: "createCanvas",
			width: opts.width,
			height: opts.height,
			...(scale !== 1 ? { scale } : {}),
			...(supersample !== 1 ? { supersample } : {}),
			...(opts.precision && opts.precision !== "u8"
				? { precision: opts.precision }
				: {}),
		},
	];

	// `fonts` and `images` override INDEPENDENTLY: whichever is omitted is still
	// derived from the walk. Treating them as one all-or-nothing switch silently
	// blanked the other list, so a caller declaring only extra font families lost
	// every image src and the painter drew placeholders instead.
	const images = new Set<string>();
	const fonts = new Set<string>();
	collectAssets(scene, images, fonts);
	const fontRequests: FontRequest[] =
		opts.fonts ?? [...fonts].map((family) => ({ family }));
	const imageSrcs: string[] = opts.images ?? [...images];
	if (fontRequests.length > 0) {
		commands.push({ op: "loadFonts", requests: fontRequests });
	}
	if (imageSrcs.length > 0) {
		commands.push({ op: "loadImages", srcs: imageSrcs });
	}

	const ctx: BakeCtx = {
		textEngine: opts.textEngine,
		leadingTrim: opts.leadingTrim,
		fontMetrics: opts.fontMetrics,
		// Text is baked in design units, but its line advances snap to whole
		// pixels — of the surface it will be painted on, not of the design box.
		deviceScale: scale,
	};
	commands.push(lower(scene, ctx));
	// The finish runs on the composited frame, so it goes last.
	if (opts.finish && hasFinishOp(opts.finish)) {
		commands.push({ op: "finishFrame", finish: opts.finish });
	}
	return commands;
}

// True when a finish actually asks for something — an all-undefined finish is a
// no-op and shouldn't emit a command (or spin up the post-pass).
function hasFinishOp(f: FrameFinish): boolean {
	return (
		f.curve !== undefined ||
		f.whiteClamp !== undefined ||
		f.blackExtract !== undefined ||
		(typeof f.dither === "number" ? f.dither > 0 : (f.dither?.amount ?? 0) > 0)
	);
}

// The fonts and images a scene references — the same walk compileScene runs for
// its own setup commands, exposed for callers that must declare a frame's assets
// up front (coatfile's CompiledFrame, the worker's raw render source). Those
// callers hand the result back as `fonts`/`images`, which are OVERRIDES: an empty
// list means "load nothing", not "nothing found", so a second walk that drifted
// would silently render text in no font at all.
export function sceneAssets(node: Node): {
	fonts: FontRequest[];
	images: string[];
} {
	const images = new Set<string>();
	const fonts = new Set<string>();
	collectAssets(node, images, fonts);
	return {
		fonts: [...fonts].map((family) => ({ family })),
		images: [...images],
	};
}

function collectAssets(
	node: Node,
	images: Set<string>,
	fonts: Set<string>,
): void {
	switch (node.kind) {
		case "image":
			images.add(node.src);
			break;
		case "text":
			fonts.add(node.font.family);
			break;
		case "group":
			for (const child of node.children) collectAssets(child, images, fonts);
			break;
		case "mask":
			collectAssets(node.mask, images, fonts);
			for (const child of node.children) collectAssets(child, images, fonts);
			break;
	}
}

function lower(node: Node, ctx: BakeCtx): DrawCommand {
	const base = {
		id: node.id,
		pos: node.pos ?? { x: 0, y: 0 },
		size: node.size ?? { width: 0, height: 0 },
		rotation: node.rotation,
		opacity: node.opacity,
		blendMode: node.blendMode,
		shadow: node.shadow,
		blur: node.blur,
		adjust: node.adjust,
	};
	switch (node.kind) {
		case "rect":
			return {
				...base,
				op: "drawRect",
				fills: node.fills,
				stroke: node.stroke,
				cornerRadius: node.cornerRadius,
				cornerSmoothing: node.cornerSmoothing,
			};
		case "ellipse":
			return {
				...base,
				op: "drawPath",
				d: ellipseSvg(base.size),
				fills: node.fills,
				stroke: node.stroke,
				...ellipseStroke(node, base.size),
			};
		case "path":
			return {
				...base,
				op: "drawPath",
				d: node.d,
				fills: node.fills,
				stroke: node.stroke,
				...(node.viewBox ? { viewBox: node.viewBox } : {}),
				...(node.fillRule ? { fillRule: node.fillRule } : {}),
			};
		case "image":
			return {
				...base,
				op: "drawImage",
				src: node.src,
				fit: node.fit,
				...(node.focus ? { focus: node.focus } : {}),
				...(node.crop ? { crop: node.crop } : {}),
				stroke: node.stroke,
				clip: node.mask,
			};
		case "group":
			return {
				...base,
				op: "drawGroup",
				clip: groupClip(node),
				...(node.isolate ? { isolate: true } : {}),
				children: [
					...groupBackground(node, base),
					...node.children.map((c) => lower(c, ctx)),
				],
			};
		case "mask":
			return lowerMask(node, base, ctx);
		case "text":
			return lowerText(node, base, ctx);
		case "bitmap":
			return {
				...base,
				op: "drawBitmap",
				pixels: node.pixels,
				pixelWidth: node.pixelWidth,
				pixelHeight: node.pixelHeight,
				...(node.role ? { role: node.role } : {}),
			};
	}
}

function lowerText(
	node: TextNode,
	base: Omit<DrawCommand, "op">,
	ctx: BakeCtx,
): DrawCommand {
	// Pre-baked layout wins (the caller already shaped it); otherwise bake now
	// via the injected engine. Only when neither is present is it an error.
	const layout =
		node.layout ??
		(ctx.textEngine
			? bakeText(node, {
					textEngine: ctx.textEngine,
					leadingTrim: ctx.leadingTrim,
					fontMetrics: ctx.fontMetrics,
					deviceScale: ctx.deviceScale,
				})
			: undefined);
	if (!layout) {
		throw new Error(
			"compileScene: text node has no pre-baked `layout` and no `textEngine` was supplied to bake it",
		);
	}
	// fit:"clip" clips overflow to the box, but glyphs legitimately overshoot it
	// (descenders/ascenders); outset the clip so visible glyphs stay whole.
	const clip =
		node.fit === "clip"
			? {
					kind: "rect" as const,
					outset: textClipOutset(
						node.font,
						resolveLeadingTrim(node, ctx.leadingTrim),
						ctx.fontMetrics,
					),
				}
			: undefined;
	return {
		...base,
		op: "drawText",
		clip,
		layout,
		color: node.color ?? "#000000",
		fill: node.fill,
	};
}

// A mask node lowers by what its mask IS: a shape whose rendered coverage is
// exactly its geometry → a drawGroup clipped to that shape (one cheap clipPath);
// any other mask → a drawMasked command the painter composites via an offscreen
// coverage layer.
//
// `invert` and `channel` disqualify the fast path whatever the shape is. A
// clipPath keeps what the geometry covers, which is the alpha channel,
// uninverted: there is no inverse clip, and an OPAQUE shape's luminance coverage
// is its colour rather than its geometry (a black rect masks everything out
// under `luminance` and nothing out under a clip).
function lowerMask(
	node: MaskNode,
	base: Omit<DrawCommand, "op">,
	ctx: BakeCtx,
): DrawCommand {
	const children = node.children.map((c) => lower(c, ctx));
	const shape =
		node.invert || node.channel === "luminance" ? null : fastClip(node.mask);
	if (shape) {
		// The outer group keeps the mask node's box, so its rotation pivots where
		// the general path's does; the clip sits inside at the mask shape's box.
		return {
			...base,
			op: "drawGroup",
			children: [
				{
					op: "drawGroup",
					pos: node.mask.pos ?? { x: 0, y: 0 },
					size: node.mask.size ?? { width: 0, height: 0 },
					clip: shape,
					...(children.length > 1 ? { isolate: true } : {}),
					children,
				},
			],
		};
	}
	return {
		...base,
		op: "drawMasked",
		mask: lower(node.mask, ctx),
		children,
		channel: node.channel,
		invert: node.invert,
	};
}

// The fast-path predicate: a rect/ellipse whose painted alpha is exactly 1 over
// its geometry and 0 outside it, so clipping to the geometry keeps the same
// pixels. That means one opaque solid fill, no stroke, no adjust and no
// transform effects; the clip is the outline the fill draws. Everything else
// returns null → the offscreen path. It reads the MASK only; the mask node's
// own `invert`/`channel` are the caller's to check.
function fastClip(mask: Node): ShapeMask | null {
	if (
		mask.rotation ||
		(mask.opacity !== undefined && mask.opacity < 1) ||
		mask.blur ||
		(mask.blendMode && mask.blendMode !== "normal") ||
		mask.shadow ||
		mask.adjust
	)
		return null;
	if (mask.kind !== "rect" && mask.kind !== "ellipse") return null;
	if (mask.stroke || !opaqueSolid(mask.fills)) return null;
	if (mask.kind === "ellipse") return { kind: "ellipse" };
	return rectShape(mask.cornerRadius, mask.cornerSmoothing);
}

function opaqueSolid(fills: RectNode["fills"]): boolean {
	if (fills?.length !== 1) return false;
	const fill = fills[0];
	if (fill.kind !== "solid") return false;
	const c = parseColor(fill.color);
	return Array.isArray(c) && c[3] >= 1;
}

// A filled group's background, as an ordinary rect drawn first.
//
// Lowering it rather than teaching the painter about group fills keeps one
// implementation of fills, gradients, corner radii and smoothing — the rect's,
// which the parity suites already cover. The group's own composite effects
// (shadow, opacity, blur, adjust) stay on the group, so the fill is inside the
// layer they apply to and the shadow is cast by the filled box.
function groupBackground(
	node: GroupNode,
	base: Omit<DrawCommand, "op">,
): DrawCommand[] {
	if (!node.fills?.length) return [];
	return [
		{
			op: "drawRect",
			pos: base.pos,
			size: base.size,
			fills: node.fills,
			cornerRadius: node.cornerRadius,
			cornerSmoothing: node.cornerSmoothing,
		},
	];
}

function groupClip(node: GroupNode): ShapeMask | undefined {
	if (!node.clip) return undefined;
	return rectShape(node.cornerRadius, node.cornerSmoothing);
}

// Box-relative ellipse as an SVG path (two half-arcs), positioned at the node's
// pos by the painter. CanvasKit's Path.MakeFromSVGString handles arcs — the same
// path shape the painter already uses for circle/ellipse clips.
function ellipseSvg(size: Size): string {
	const rx = size.width / 2;
	const ry = size.height / 2;
	const cy = ry;
	return `M 0 ${cy} A ${rx} ${ry} 0 1 0 ${size.width} ${cy} A ${rx} ${ry} 0 1 0 0 ${cy} Z`;
}

// An inside/outside stroke on an ellipse follows the ellipse inset or outset
// by half the stroke width.
function ellipseStroke(
	node: EllipseNode,
	size: Size,
): { strokeD?: string } {
	const inset = node.stroke ? strokeInset(node.stroke) : 0;
	if (inset === 0) return {};
	const cx = size.width / 2;
	const cy = size.height / 2;
	const rx = Math.max(0, cx - inset);
	const ry = Math.max(0, cy - inset);
	return {
		strokeD: `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`,
	};
}
