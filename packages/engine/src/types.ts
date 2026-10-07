// freshcoat's type vocabulary: the geometry primitives, the backend-agnostic
// IR (Command / DrawCommand) the painters consume, the resolved style vocabulary
// compile bakes and paint reads, and the paint runtime contract. Kept free of
// zod / authoring (Template, Element) so a consumer can build a Command[] scene
// and render it without pulling in the template-authoring layer. freshcoat paints
// ONE scene per paint() — the notion of a card's multiple sides (named frames)
// lives in coatfile, which drives paint() once per side.
//
// The geometry primitives (Vec2, Size, BlendMode, GradientStop, FontDescriptor,
// FontFile) are hand-declared here as the canonical runtime shapes. coatfile
// re-derives them via zod (schemas.ts) for authoring/validation; the two are kept
// structurally identical.

import type { Precision } from "./color-policy";
import type { DecodedPixels } from "./decode";
import type { PaintCache } from "./paint-cache";
import type { EncodeFormat, EncodeOptions } from "./png";

export type Vec2 = { x: number; y: number };
export type Size = { width: number; height: number };
// Figma's layer blend modes, minus pass-through, which is a group's `isolate`
// left unset rather than a mode. `plus` is Figma's linear dodge.
export type BlendMode =
	| "normal"
	| "multiply"
	| "screen"
	| "overlay"
	| "darken"
	| "lighten"
	| "color-dodge"
	| "color-burn"
	| "hard-light"
	| "soft-light"
	| "difference"
	| "exclusion"
	| "hue"
	| "saturation"
	| "color"
	| "luminosity"
	| "plus"
	| "linear-burn";

// SVG's fill-rule. Nonzero is the default, as in SVG and Skia.
export type FillRule = "nonzero" | "evenodd";

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

// Variable-font axis values keyed by OpenType tag ("wdth", "opsz", "slnt", or a
// custom axis). The weight is its own field; a `wght` here overrides it.
export type FontVariations = Record<string, number>;
// OpenType feature settings by tag: 1 on, 0 off, or an alternate's index
// (salt, cvXX).
export type FontFeatures = Record<string, number>;

export type FontFile = {
	weight: FontWeight;
	style?: "normal" | "italic";
	src: string;
};

export type FontDescriptor =
	| { kind: "google"; family: string; url: string }
	| { kind: "fontsource"; family: string; url: string }
	| { kind: "local"; family: string; files: FontFile[] };

export type GradientStop = { offset: number; color: string };

export type PatternKind = "noise" | "paper" | "hatching" | "dots";

export type FontRequest =
	| { family: string }
	| { family: string; descriptor: FontDescriptor };

export type Shadow = {
	color: string;
	dx: number;
	dy: number;
	blur: number;
	/** Grows the shadow's silhouette before it is blurred (negative shrinks it),
	 *  matching Figma's "Spread" and CSS's third box-shadow length. */
	spread?: number;
	/** Draw the shadow INSIDE the drawable instead of behind it — Figma's inner
	 *  shadow, CSS's `inset`. The silhouette is inverted, so the shadow falls
	 *  from the shape's own edges inward. */
	inset?: boolean;
};

/** One shadow, or a stack of them painted bottom-up: the LAST entry is nearest
 *  the viewer, mirroring how a fills array stacks. Figma lists effects
 *  top-first, so a producer reverses them on the way in. */
export type Shadows = Shadow | Shadow[];

// Unified clip primitive applied to any Drawable. ImageElement.cornerRadius,
// ImageElement.mask, and TextElement fit:'clip' all lower to this at compile.
// Extra pixels the clip extends beyond the drawable box on each edge. Used by
// text fit:"clip" to let glyph overshoot (descenders below the baseline,
// ascenders/diacritics above the cap line) stay whole while still hiding
// fully-overflowing lines. Absent → a box-tight clip.
export type ClipOutset = { top: number; bottom: number };

// A per-channel 256-entry transfer LUT (out = table[in]); r/g/b may share one
// table (gamma) or differ (arbitrary curves). See ./adjust.
// LUT arrays are treated as immutable once handed to the engine: the adjust
// helpers share them across calls and the painter caches their images by array
// identity, so mutating one in place is not seen. Build a new array instead.
export type AdjustLut = {
	r: Uint8Array;
	g: Uint8Array;
	b: Uint8Array;
};

// A sampled RGB cube for corrections whose channels interact. `data` is RGB
// triplets in r-fast order: ((b * size + g) * size + r) * 3. The renderer uses
// trilinear interpolation, so a small measured cube can correct hue bends a set
// of three independent 1D curves cannot express.
export type AdjustLut3d = {
	size: number;
	data: Uint8Array;
};

// Generic, domain-neutral per-layer color/tone adjustment applied as a layer
// composites — a sibling of opacity/blend/blur, NOT a print concept. `colorMatrix`
// (4×5, Skia convention, bias column in [0,1]) applies first (cross-channel:
// saturation/brightness/contrast); `lut` after (per-channel curves: gamma);
// `sharpen` is a spatial post-filter. All optional; absent = identity. Built via
// the helpers in ./adjust. A consumer maps its own domain intent down to this —
// freshcoat knows the math, not the reason.
export type Adjust = {
	colorMatrix?: number[]; // length 20, row-major RGBA rows + bias
	lut?: AdjustLut;
	lut3d?: AdjustLut3d;
	sharpen?: number; // 0 = none
	// How to resolve a color the matrix pushed outside [0,1]. "clip" (default)
	// clamps each channel independently, which rotates hue — a channel already at an
	// extreme pins while the others keep moving. "preserve-hue" scales chroma toward
	// the color's own luma until every channel fits, keeping hue and luminance and
	// giving up saturation instead.
	//
	// Applies to the matrix step; a 256-entry LUT cannot leave the range. Being
	// per-pixel and conditional, "preserve-hue" moves the matrix off the color filter
	// and onto the offscreen shader pass.
	gamut?: "clip" | "preserve-hue";
};

export type ShapeMask =
	| { kind: "rect"; outset?: ClipOutset }
	| { kind: "rounded-rect"; radius: CornerRadius; smoothing?: number }
	| { kind: "circle" }
	| { kind: "ellipse" }
	| { kind: "polygon"; sides: number; rotation?: number }
	| { kind: "squircle"; radius: number; smoothing?: number };

// A uniform radius, or per-corner [topLeft, topRight, bottomRight, bottomLeft]
// (matches CSS/Canvas2D roundRect order and Figma's per-corner radii).
export type CornerRadius = number | [number, number, number, number];

// The coordinate box a path's `d` is authored in (an SVG viewBox). When set on a
// path node, the painter scales the path from this box into the drawable's `size`
// (viewBox → viewport), so vector art is sized by the node box instead of by
// pre-scaling the path data. `x`/`y` default to 0. Gradient fills span the
// viewBox, so they map onto the full scaled box.
export type ViewBox = { x?: number; y?: number; width: number; height: number };

// A region of an image source, each field a fraction of the source's width or
// height, so the same crop holds whatever resolution the file is loaded at.
export type ImageCrop = { x: number; y: number; width: number; height: number };

export type Stroke = {
	color: string;
	width: number;
	// Empty array or undefined = solid line.
	dash?: number[];
	// Line cap/join. Omitted = canvas defaults (butt cap, miter join).
	cap?: "butt" | "round" | "square";
	join?: "round" | "bevel" | "miter";
	// Stroke position relative to the shape edge (Figma). Omitted = center (the
	// native canvas/Skia alignment). Honored by every stroked drawable.
	align?: "inside" | "outside" | "center";
};

// Gradient endpoints are in [0, 1] of the drawable's bbox.
export type ResolvedFill =
	| { kind: "solid"; color: string }
	| { kind: "linear"; stops: GradientStop[]; from: Vec2; to: Vec2 }
	// `radius` is a fraction of the drawable's LONGEST side, so one number means
	// the same distance whichever axis it describes. `radiusY` is the reach along
	// the axis perpendicular to the primary one and `rotation` the degrees that
	// primary axis is turned from +x; together they make the gradient an ellipse.
	// Omit both for a circle.
	| {
			kind: "radial";
			stops: GradientStop[];
			center: Vec2;
			radius: number;
			radiusY?: number;
			rotation?: number;
	  }
	// Angular (conic) gradient. `rotation` is the start angle in degrees, 0 = top
	// (12 o'clock), sweeping clockwise — matching Figma's angular gradient.
	| {
			kind: "angular";
			stops: GradientStop[];
			center: Vec2;
			rotation: number;
	  }
	// A procedural pattern in design units, anchored at the drawable's top-left,
	// so it moves with the shape and keeps its size at every export density.
	// `scale` is the feature size: noise grain, paper fibre, line spacing or dot
	// pitch. `density` in [0, 1] is how much of colors[1] covers colors[0].
	| {
			kind: "pattern";
			pattern: PatternKind;
			scale: number;
			angle: number;
			density: number;
			seed: number;
			colors: [string, string];
	  };

export type ResolvedFont = {
	family: string;
	weight: number;
	style: "normal" | "italic";
	size: number;
	letterSpacing?: number;
	lineHeight: number;
	// The authored line height was AUTO — the font's own line box, not this
	// number, which is only the fallback for a family whose metrics are unknown.
	// compileScene substitutes the real value (see ./line-height) before layout.
	autoLineHeight?: boolean;
	// Figma text decoration; absent = none.
	decoration?: "underline" | "line-through";
	variations?: FontVariations;
	features?: FontFeatures;
};

export type BakedTextLayout = {
	font: ResolvedFont;
	lines: TextLine[];
	totalHeight: number;
	shrinkApplied: boolean;
	// See TextLayout.missing.
	missing?: number[];
};

// One laid-out visual line. y is the line's top in target pixels (with
// verticalAlign already applied). Every line has at least one span; for
// single-style text, spans has a single element covering the full line. Mixed-style text fans into multiple spans with per-span font + color.
export type TextLine = {
	// Concatenation of span texts — kept for ergonomic access; derived from spans.
	text: string;
	y: number;
	// Explicit alphabetic baseline in target pixels, positioned with the same
	// line-box model graphic tools (Figma) use: the font's ascent + half of the
	// line's leading. The painter draws at this baseline.
	baseline?: number;
	// Extra advance after each space (U+0020), in target px: how a justified
	// line fills the box. The painter shapes the line with it.
	wordSpacing?: number;
	// The paragraph's base direction when it is right-to-left; the painter
	// orders the line's runs by it. Span x/width stay visual.
	direction?: "rtl";
	spans: TextLineSpan[];
};

export type TextLineSpan = {
	text: string;
	x: number; // absolute pixel x of the span's left edge
	width: number;
	font: ResolvedFont;
	color: string;
};

export type SetupCommand =
	// width/height are the scene's DESIGN size — the units every drawable's
	// pos/size is in. `scale` is the export's device-pixel multiplier (see
	// ./export-scale): the painter allocates a surface that many times bigger and
	// scales its canvas matrix to match, leaving the commands themselves untouched.
	// Absent = 1× (one device pixel per design unit).
	//
	// `supersample` raises the density the scene is RENDERED at without changing
	// the size it comes out at: the painter renders at `scale × supersample` and
	// reduces to `scale` before the finish pass. Absent/1 = render at the export
	// size (no reduction).
	//
	// `precision` is the bit depth of the working surface and offscreen layers
	// (see ./color-policy). Absent = "u8".
	| {
			op: "createCanvas";
			width: number;
			height: number;
			scale?: number;
			supersample?: number;
			precision?: Precision;
	  }
	| { op: "loadFonts"; requests: FontRequest[] }
	| { op: "loadImages"; srcs: string[] };

// A whole-frame, post-composite output pass — a sibling of the per-layer Adjust,
// but run once on the flattened result (these ops are conjunctive across channels
// / spatial, so they can't be a per-layer color transform). Domain-neutral: "map
// every channel through a curve", "snap near-white to white", "snap near-black to
// black", "add dither to break gradient banding". All optional; absent = skip that
// op. Thresholds are 0–255.
//
// A number is the original, per-channel dither shorthand. The object form adds a
// stable seed and a monochrome mode that applies one noise value to RGB together,
// avoiding colored grain. Both forms use peak noise in 0–255 levels.
export type FrameDither =
	| number
	| {
			amount: number;
			seed?: number;
			mode?: "per-channel" | "monochrome";
	  };

export type FrameFinish = {
	// Per-channel curve, applied before dither and the thresholds. Same format as
	// Adjust.lut.
	curve?: AdjustLut;
	whiteClamp?: number; // all channels > threshold → white
	blackExtract?: number; // all channels < threshold → black
	dither?: FrameDither;
};

// Emitted last by compileScene when a finish is requested; the painter runs it as
// a post-pass on the composited surface. Carried in the Command stream (like the
// loadFonts/loadImages directives) rather than a separate paint argument.
export type FinishCommand = { op: "finishFrame"; finish: FrameFinish };

export type DrawCommandBase = {
	// Stable source-node identity, retained in the lowered IR so paint warnings can
	// point to the exact layer a renderer could not fully process.
	id?: string;
	pos: Vec2;
	size: Size;
	rotation?: number;
	opacity?: number;
	blendMode?: BlendMode;
	clip?: ShapeMask;
	shadow?: Shadows;
	blur?: number;
	// Per-layer color/tone adjustment, applied to this drawable's pixels as it
	// composites (see Adjust). On a group/mask it adjusts the whole subtree's
	// composited result, like a Figma adjustment layer.
	adjust?: Adjust;
};

export type DrawTextCommand = DrawCommandBase & {
	op: "drawText";
	layout: BakedTextLayout;
	color: string;
	fill?: ResolvedFill;
};

export type DrawImageCommand = DrawCommandBase & {
	op: "drawImage";
	src: string;
	fit: "cover" | "contain" | "fill" | "tile";
	// See ImageNode.
	focus?: Vec2;
	crop?: ImageCrop;
	stroke?: Stroke;
};

// Raw RGBA pixels drawn into the box (nearest-neighbor, so QR / pixel art scale
// crisply). Row-major, length = pixelWidth * pixelHeight * 4.
export type DrawBitmapCommand = DrawCommandBase & {
	op: "drawBitmap";
	pixels: Uint8Array;
	pixelWidth: number;
	pixelHeight: number;
	role?: BitmapRole;
};

// What a bitmap is a picture of, when that changes how it is drawn. A barcode's
// modules are snapped to whole output pixels (see drawBitmap), and a skeleton
// preview draws it as bars rather than as a QR.
export type BitmapRole = "barcode";

export type DrawQrCommand = DrawCommandBase & {
	op: "drawQr";
	modules: boolean[][];
	foreground: string;
	background?: string;
	margin?: number;
};

export type DrawRectCommand = DrawCommandBase & {
	op: "drawRect";
	fills?: ResolvedFill[];
	stroke?: Stroke;
	cornerRadius?: CornerRadius;
	cornerSmoothing?: number;
};

export type DrawPathCommand = DrawCommandBase & {
	op: "drawPath";
	d: string;
	fills?: ResolvedFill[];
	stroke?: Stroke;
	// When set, scale the path from this authored box into `size` (see ViewBox).
	viewBox?: ViewBox;
	fillRule?: FillRule;
	// The outline the stroke is centered on, in place of `d`, when the aligned
	// stroke is an exact offset of the shape (an ellipse). `stroke.align` is
	// already applied to it.
	strokeD?: string;
};

export type DrawGroupCommand = DrawCommandBase & {
	op: "drawGroup";
	children: DrawCommand[];
	// See GroupNode.isolate.
	isolate?: boolean;
};

// The general mask (non-fast-path): draw `children` to an offscreen layer, then
// composite `mask`'s coverage onto it (alpha or luminance channel, optionally
// inverted). A shape-only mask never reaches here — it lowers to a drawGroup
// with a `clip`.
export type DrawMaskedCommand = DrawCommandBase & {
	op: "drawMasked";
	mask: DrawCommand;
	children: DrawCommand[];
	channel?: "alpha" | "luminance";
	invert?: boolean;
};

export type DrawCommand =
	| DrawTextCommand
	| DrawImageCommand
	| DrawBitmapCommand
	| DrawQrCommand
	| DrawRectCommand
	| DrawPathCommand
	| DrawGroupCommand
	| DrawMaskedCommand;

export type Command = SetupCommand | DrawCommand | FinishCommand;

// Vertical font metrics normalized per em (multiply by font size for pixels).
// Figma positions the first baseline from the OS/2 typo metrics + cap height;
// supply these (parsed from the font bytes via readFontMetrics) so compile bakes
// a Figma-accurate baseline instead of falling back to approximations.
export type FontVMetrics = {
	ascent: number;
	descent: number; // positive magnitude
	lineGap: number;
	capHeight: number; // 0 if the font predates OS/2 v2
};

export type CanvasLike = {
	width: number;
	height: number;
	getContext(type: "2d"): CanvasRenderingContext2DLike | null;
};

// Structural stand-ins for the DOM's nominal CanvasGradient/CanvasPattern, so a
// non-DOM canvas satisfies them without a cast.
export type CanvasGradientLike = {
	addColorStop(offset: number, color: string): void;
};
export type CanvasPatternLike = {
	readonly __canvasPattern?: never;
};

// The Canvas2D string unions, declared rather than taken from the DOM lib.
// This package is consumed by a server whose tsconfig has no DOM — a worker that
// could name `document` is a worker that can typecheck a mistake — and these are
// the only DOM types its public surface referenced.
export type LineCap = "butt" | "round" | "square";
export type LineJoin = "round" | "bevel" | "miter";
export type TextAlign = "start" | "end" | "left" | "right" | "center";
export type TextBaseline =
	| "top"
	| "hanging"
	| "middle"
	| "alphabetic"
	| "ideographic"
	| "bottom";

export type CanvasRenderingContext2DLike = {
	fillStyle: string | CanvasGradientLike | CanvasPatternLike;
	strokeStyle: string;
	lineWidth: number;
	lineCap: LineCap;
	lineJoin: LineJoin;
	globalAlpha: number;
	globalCompositeOperation: string;
	font: string;
	textAlign: TextAlign;
	textBaseline: TextBaseline;
	shadowColor: string;
	shadowBlur: number;
	shadowOffsetX: number;
	shadowOffsetY: number;
	filter: string;
	// High-quality image resampling for scaled draws. Optional: not every
	// canvas exposes them.
	imageSmoothingEnabled?: boolean;
	imageSmoothingQuality?: "low" | "medium" | "high";
	save(): void;
	restore(): void;
	translate(x: number, y: number): void;
	rotate(angle: number): void;
	fillRect(x: number, y: number, w: number, h: number): void;
	strokeRect(x: number, y: number, w: number, h: number): void;
	beginPath(): void;
	closePath(): void;
	rect(x: number, y: number, w: number, h: number): void;
	// Optional path arg fills/strokes a prebuilt Path2D (used for squircles);
	// omitting it fills/strokes the current path.
	fill(path?: unknown): void;
	stroke(path?: unknown): void;
	clip(): void;
	measureText(text: string): { width: number };
	fillText(text: string, x: number, y: number): void;
	drawImage(
		image: unknown,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void;
	drawImage(
		image: unknown,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void;
	roundRect(
		x: number,
		y: number,
		w: number,
		h: number,
		radius: number | number[],
	): void;
	setLineDash(segments: number[]): void;
	createLinearGradient(
		x0: number,
		y0: number,
		x1: number,
		y1: number,
	): CanvasGradientLike;
	createRadialGradient(
		x0: number,
		y0: number,
		r0: number,
		x1: number,
		y1: number,
		r1: number,
	): CanvasGradientLike;
	createConicGradient(
		startAngle: number,
		x: number,
		y: number,
	): CanvasGradientLike;
	createPattern(
		image: unknown,
		repetition: "repeat" | "repeat-x" | "repeat-y" | "no-repeat",
	): CanvasPatternLike | null;
};

export type ImageLike = {
	width: number;
	height: number;
};

export type PaintWarning =
	| { kind: "image_load_failed"; src: string; error: string }
	// An SVG source drew without a feature it uses (text, filters, patterns).
	| { kind: "svg_unsupported"; src: string; feature: string }
	| { kind: "font_load_failed"; family: string; error: string }
	| { kind: "qr_generate_failed"; value: string; error: string }
	// A barcode element compiled with no encoder registered, so it drew as a
	// placeholder. `layer` is the element id.
	| { kind: "barcode_unavailable"; symbology: string; layer?: string }
	// The encoder refused the value; `message` says why, in its words.
	| {
			kind: "barcode_invalid";
			symbology: string;
			value: string;
			message: string;
			layer?: string;
	  }
	| { kind: "unhandled_op"; op: string }
	// An `adjust` component the painter fell back on instead of applying — e.g. the
	// offscreen surface or SkSL effect for `lut`/`sharpen` couldn't be created. The
	// layer still paints (matrix-only); the component is skipped, not silent.
	// `gamut` means "preserve-hue" was asked for and the matrix ran through the
	// clipping color filter instead, so that layer's out-of-range colors kept the
	// hue shift the mode exists to prevent.
	| {
			kind: "adjust_unsupported";
			component: "lut" | "lut3d" | "sharpen" | "gamut";
			// The source node id when supplied; image src is used as a useful fallback.
			layer?: string;
	  }
	// Part of a layer went past the output range and chroma was given back to hold
	// the hue (see Adjust.gamut). Not a failure — the render is correct — but that
	// area ends up less saturated than the source art. `clipped` and `pullback` are
	// 0–1 shares; `layer` names the src when known.
	| {
			kind: "gamut_compressed";
			layer?: string;
			clipped: number;
			pullback: number;
	  };

// Raw paint output. Carries lifecycle closures the runtime decides whether to
// call — the "env owns disposal" seam. Internal to the paint step.
export type PaintOutput = {
	// The raster surface, when the backend has one. A backend that emits a
	// document rather than pixels has no canvas and leaves this unset; its bytes
	// come back from encode() like any other format.
	canvas?: CanvasLike;
	warnings: PaintWarning[];
	// The painted frame as raw RGBA, at the device size the scene was rendered at.
	// Separate from encode() because a comparison between two backends is about
	// pixels, not about which encoder wrote them. null when the surface cannot be
	// read back (a lost context); absent when the backend cannot rasterize at all.
	readPixels?(): DecodedPixels | null;
	// PNG bytes of the painted frame. Async because encoding goes through the
	// platform's deflate (see ./png), which is a stream.
	encode(
		opts?: EncodeOptions,
	): Promise<{ bytes: Uint8Array; format: EncodeFormat }>;
	dispose(): void;
};

// The canvas host — a live surface to back a displayable (WebGL/SW) CanvasKit
// surface with, when present. Its presence IS the capability: a host-less
// runtime (createHeadlessEnv) renders offscreen instead.
export type CanvasHost = {
	createCanvas(width: number, height: number): CanvasLike;
	decodeImage(bytes: Uint8Array): Promise<ImageLike>;
	encode(canvas: CanvasLike): Uint8Array;
};

// What a runtime knows about a font request without fetching: pre-supplied bytes
// (env already has them), a descriptor to load from, or nothing (by-name). The
// shared `fontBytes` helper turns this into bytes; a native font system (Canvas2D)
// can instead consume the resolution directly (register by path / stylesheet).
export type FontResolution =
	| { kind: "bytes"; bytes: Uint8Array[] }
	| { kind: "descriptor"; descriptor: FontDescriptor }
	| { kind: "none" };

// The runtime (env) — the agnostic paint TARGET: offscreen-encode (server) vs
// live-canvas keep (browser). Owns image byte I/O, font resolution + surface
// lifecycle. `paint` takes the CanvasKit instance directly (CanvasKit is the
// only backend, so there is no painter-strategy indirection).
export type PaintRuntime = {
	// Resolve a font request to what the env has (bytes / descriptor / nothing). A
	// bare string is a by-name request.
	resolveFont(req: FontRequest | string): FontResolution;
	// Every family the env holds bytes for. A paint through a cache registers
	// all of them, so a scene that uses fewer keeps the cached provider.
	fonts?: Map<string, Uint8Array[]>;
	loadImageBytes(src: string): Promise<Uint8Array>;
	// Decoded images the runtime owns. When present, paint asks it for each image
	// instead of decoding loadImageBytes itself, and never frees what it returns:
	// a caller that keeps its own bounded cache of decoded images (an export
	// worker reusing a logo across records) frees them on its own schedule. Null
	// is an image that could not be had, painted as a placeholder.
	loadImage?(src: string, ck: unknown): Promise<unknown | null>;
	canvas?: CanvasHost;
	// Native (DOM) font registration, browser env only: the resolution is loaded
	// by the platform (FontFace / stylesheet). Absent on a canvas-less runtime.
	registerFont?(family: string, res: FontResolution): void | Promise<void>;
	// Keeps the font provider, decoded images and surface across paints (see
	// ./paint-cache). Absent, every paint builds and frees its own.
	cache?: PaintCache;
	// Paint ONE compiled scene (a Command[] beginning with createCanvas) to a
	// single surface. Multi-side rendering is the caller's loop — freshcoat has no
	// notion of named frames/sides. ck is the CanvasKit-WASM instance; typed
	// loosely as it has no TS types, and optional because a runtime built around a
	// non-CanvasKit Painter has no use for one. `opts.cache` paints through that
	// cache in place of the runtime's own.
	paint(
		commands: Command[],
		ck?: unknown,
		opts?: { cache?: PaintCache },
	): Promise<PaintResult>;
};

// The backend seam: a compiled scene becomes an output. CanvasKit is the only
// implementation, and there is no plan for a second one; the parameter exists so
// that the conformance suite can grade a Painter without reaching into the
// runtime, which is also how the reference backend is graded today. A backend
// that emitted a document rather than pixels would leave PaintOutput.canvas unset
// and answer encode() with its own bytes and format.
export type Painter = (
	commands: Command[],
	rt: PaintRuntime,
) => Promise<PaintOutput>;

// paint() output after the runtime applies its disposal policy: browser keeps the
// live canvas (+ dispose for unmount), server hands back encoded bytes. Neither
// carries a frame/side name — the caller knows which scene it painted.
export type KeptPaintResult = {
	canvas: CanvasLike;
	warnings: PaintWarning[];
	dispose(): void;
};
export type EncodedPaintResult = {
	// The encoded image, in whatever `format` says. Not named `png`: a WebP
	// render answers here too, and a field read as the wrong format is how a
	// caller comes to store one under the other's content type.
	bytes: Uint8Array;
	format: EncodeFormat;
	warnings: PaintWarning[];
};
export type PaintResult = KeptPaintResult | EncodedPaintResult;
