// CanvasKit (WASM Skia) render backend. Consumes the backend-agnostic Command
// IR (one scene's `Command[]` from compileScene) and paints via the full Skia
// API: Canvas/Paint/Shader for fills, ParagraphBuilder (HarfBuzz shaping →
// Figma-matching kerning) for text, the ImageFilter graph for blur/shadow, and
// drawImageRect/image shaders for images.
//
// The caller supplies an initialized CanvasKit instance (this module imports
// only `canvaskit-wasm` types, so it stays runtime-agnostic), the font bytes,
// and any image bytes keyed by src. Text is drawn at the compile-baked baseline
// (`line.baseline`).
import type {
	BlendModeEnumValues,
	Blender,
	Canvas,
	CanvasKit,
	ColorFilter,
	Font,
	FontWeightEnumValues,
	GlyphRun,
	Image,
	ImageFilter,
	ImageInfo,
	InputMatrix,
	Paint,
	Path,
	Rect,
	RRect,
	RuntimeEffect,
	Shader,
	SkPicture,
	StrokeCapEnumValues,
	StrokeJoinEnumValues,
	Surface,
	TextStyle,
	TypefaceFontProvider,
} from "canvaskit-wasm";
import {
	type ArcLine,
	placeOnArc,
	rsxformBounds,
	spanAt,
	spanByteStarts,
} from "./arc-text";
import { parseColor } from "./color";
import {
	imageInfo,
	makeImageFromPixels,
	makeLayerSurface,
	type Precision,
	resolvePrecision,
} from "./color-policy";
import { compileScene } from "./compile-scene";
import { exportPixelSize, resolveSupersample } from "./export-scale";
import { dataUrlToBytes, fontArrayBuffer, fontBytes } from "./font-bytes";
import { deleteFontProvider, makeParagraphBuilder } from "./font-collection";
import {
	cachedLutImage,
	createLutImages,
	evictUnusedLutImages,
	freeLutImages,
	type LutImages,
} from "./lut-images";
import {
	backgroundFits,
	cacheBackground,
	cacheFinishNoise,
	cachedFontProvider,
	cachedLine,
	cachedMipmaps,
	cachedPath,
	cachedSurface,
	closestBackground,
	evictUnusedImages,
	evictUnusedLines,
	evictUnusedPaths,
	type PaintCacheState,
	paintCacheState,
	type ShapedLine,
	touchBackground,
} from "./paint-cache-state";
import {
	decorationLine,
	fitRect,
	fontFeatureList,
	fontVariationList,
	strokeInset,
} from "./paint-helpers";
import { flattenOverWhite } from "./jpeg";
import {
	DEFAULT_JPEG_QUALITY,
	DEFAULT_WEBP_QUALITY,
	encodePng,
} from "./png";
import { outlineGeometry, outlineIsPath, rectShape } from "./outline";
import { PATTERN_SKSL, type PatternFill } from "./pattern";
import type { SvgItem } from "./svg/index";
import { isSvg } from "./svg/sniff";
import type {
	AdjustLut,
	BlendMode,
	CanvasLike,
	Command,
	DrawBitmapCommand,
	DrawCommand,
	DrawImageCommand,
	DrawMaskedCommand,
	DrawPathCommand,
	DrawTextCommand,
	FontRequest,
	FrameFinish,
	PaintOutput,
	PaintRuntime,
	PaintWarning,
	ResolvedFill,
	ShapeMask,
	Size,
	Stroke,
	TextArc,
	TextLine,
} from "./types";

type EnumKey<E> = Exclude<keyof E, "values">;

type LoadedFontBytes = { family: string; bytes: Uint8Array };

// The scene box every drawable is positioned in: the DESIGN size (the units the
// commands carry) plus the export density the surface was allocated at. Only the
// passes that step outside the scaled canvas matrix — the adjust offscreen, the
// frame finish — need the scale; everything else draws in design units and lets
// the canvas matrix do the work.
// `grid` is how many device pixels make one output pixel: the supersample
// factor, 1 when the scene is drawn at its export size.
type Frame = {
	width: number;
	height: number;
	scale: number;
	grid?: number;
	precision?: Precision;
};

// Canvas2D shadowBlur ≈ 2·sigma. Figma's layer-blur value is ~2.27× the
// Gaussian sigma (bjango blur-radius comparison), so a value of N → sigma N/2.27.
const SHADOW_SIGMA = (blur: number) => blur / 2;
const LAYER_BLUR_SIGMA = (blur: number) => blur / 2.2727;

const WEIGHTS: Record<number, EnumKey<FontWeightEnumValues>> = {
	100: "Thin",
	200: "ExtraLight",
	300: "Light",
	400: "Normal",
	500: "Medium",
	600: "SemiBold",
	700: "Bold",
	800: "ExtraBold",
	900: "Black",
};

// A per-frame bin of CanvasKit handles to free after the snapshot is taken —
// shaders, filters, paths, images, etc. leak native memory otherwise.
type Bin = {
	track: <T>(o: T) => T;
	free: () => void;
	// Reusing an equal table keeps a photo-heavy scene from allocating and
	// uploading the same LUT texture for every adjusted layer. `free` deletes
	// them unless a PaintCache passed in owns them.
	luts: LutImages;
	// A mipmapped copy of `img`, kept with the cached image under `src` when
	// there is one, else freed with the bin.
	mipmaps: (src: string, img: Image) => Image;
	// Path.MakeFromSVGString(d), shared through the PaintCache when there is
	// one. Callers must not mutate the result.
	path: (ck: CanvasKit, d: string, evenOdd?: boolean) => Path | null;
};
function makeBin(cache?: PaintCacheState | null): Bin {
	const items: { delete(): void }[] = [];
	const luts = cache?.luts ?? createLutImages();
	const track = <T>(o: T): T => {
		if (o && typeof (o as { delete?: unknown }).delete === "function")
			items.push(o as unknown as { delete(): void });
		return o;
	};
	return {
		track,
		free: () => {
			for (const o of items) {
				try {
					o.delete();
				} catch {}
			}
			if (!cache) freeLutImages(luts);
		},
		luts,
		mipmaps: (src, img) => {
			const build = () => img.makeCopyWithDefaultMipmaps();
			return (
				(cache && cachedMipmaps(cache, src, img, build)) ?? track(build())
			);
		},
		path: (ck, d, evenOdd = false) => {
			const build = () => {
				const path = ck.Path.MakeFromSVGString(d);
				if (path && evenOdd) path.setFillType(ck.FillType.EvenOdd);
				return path;
			};
			return cache
				? cachedPath(cache, evenOdd ? `e${d}` : `n${d}`, build)
				: track(build());
		},
	};
}

function toColor(ck: CanvasKit, input: string) {
	const c = parseColor(input);
	return c && c !== "none" ? ck.Color(c[0], c[1], c[2], c[3]) : ck.BLACK;
}

// Device pixels per local unit under the canvas's current matrix.
function devicePx(canvas: Canvas): number {
	const m = canvas.getTotalMatrix();
	const px = Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3]));
	return Number.isFinite(px) && px > 0 ? px : 1;
}

// `px` is device pixels per design unit and `unit` the local units one design
// unit spans, which differ from 1 only inside a path's viewBox.
type PatternSpace = { px: number; unit?: [number, number] };

function patternShader(
	ck: CanvasKit,
	bin: Bin,
	fill: PatternFill,
	x: number,
	y: number,
	space: PatternSpace,
): Shader {
	const [c0, c1] = fill.colors;
	const eff = cachedEffect(ck, `pattern-${fill.pattern}`, () =>
		ck.RuntimeEffect.Make(PATTERN_SKSL[fill.pattern]),
	);
	if (!eff)
		return bin.track(ck.Shader.MakeColor(toColor(ck, c0), ck.ColorSpace.SRGB));
	const scale = Math.max(fill.scale, 1e-3);
	const [ux, uy] = space.unit ?? [1, 1];
	const local = ck.Matrix.multiply(
		ck.Matrix.translated(x, y),
		ck.Matrix.scaled(ux, uy),
		ck.Matrix.rotated((fill.angle * Math.PI) / 180),
		ck.Matrix.scaled(scale, scale),
	);
	const density = Math.min(Math.max(fill.density, 0), 1);
	const uniforms = [
		...toColor(ck, c0),
		...toColor(ck, c1),
		density,
		1 / (scale * space.px),
	];
	if (fill.pattern === "hatching" || fill.pattern === "dots")
		return bin.track(eff.makeShader(uniforms, local));
	const octaves = fill.pattern === "paper" ? 4 : 3;
	const noise = bin.track(
		fill.pattern === "paper"
			? ck.Shader.MakeTurbulence(1, 1, octaves, fill.seed, 0, 0)
			: ck.Shader.MakeFractalNoise(1, 1, octaves, fill.seed, 0, 0),
	);
	return bin.track(eff.makeShaderWithChildren(uniforms, [noise], local));
}

function shaderFor(
	ck: CanvasKit,
	bin: Bin,
	fill: Exclude<ResolvedFill, { kind: "solid" }>,
	x: number,
	y: number,
	w: number,
	h: number,
	space: PatternSpace = { px: 1 },
): Shader {
	if (fill.kind === "pattern") return patternShader(ck, bin, fill, x, y, space);
	if (fill.kind === "linear") {
		return bin.track(
			ck.Shader.MakeLinearGradient(
				[x + fill.from.x * w, y + fill.from.y * h],
				[x + fill.to.x * w, y + fill.to.y * h],
				fill.stops.map((s) => toColor(ck, s.color)),
				fill.stops.map((s) => s.offset),
				ck.TileMode.Clamp,
			),
		);
	}
	if (fill.kind === "angular") {
		const cx = x + fill.center.x * w;
		const cy = y + fill.center.y * h;
		// rotation 0 = top; a sweep's 0 is at 3 o'clock, so it turns by
		// rotation - 90. Skia measures sweep angles from 0 to 360, so the turn
		// is a local matrix about the centre: a start angle would leave part
		// of the circle outside the swept window, clamped to an end stop.
		const turn = (((fill.rotation - 90) % 360) + 360) % 360;
		return bin.track(
			ck.Shader.MakeSweepGradient(
				cx,
				cy,
				fill.stops.map((s) => toColor(ck, s.color)),
				fill.stops.map((s) => s.offset),
				ck.TileMode.Clamp,
				turn === 0 ? null : ck.Matrix.rotated((turn * Math.PI) / 180, cx, cy),
				0,
				0,
				360,
			),
		);
	}
	const cx = x + fill.center.x * w;
	const cy = y + fill.center.y * h;
	const longest = Math.max(w, h);
	const rx = fill.radius * longest;
	const ry = (fill.radiusY ?? fill.radius) * longest;
	const rotation = fill.rotation ?? 0;
	const colors = fill.stops.map((s) => toColor(ck, s.color));
	const offsets = fill.stops.map((s) => s.offset);
	// Skia only draws circles, so an elliptical gradient is that circle under a
	// local matrix: squash the secondary axis to ry/rx, then turn the whole thing
	// to where the primary axis points. Both operate about the center so the
	// gradient stays put. A circular gradient skips the matrix entirely.
	if (rx <= 0 || (ry === rx && rotation % 180 === 0)) {
		return bin.track(
			ck.Shader.MakeRadialGradient(
				[cx, cy],
				rx,
				colors,
				offsets,
				ck.TileMode.Clamp,
			),
		);
	}
	const localMatrix = ck.Matrix.multiply(
		ck.Matrix.rotated((rotation * Math.PI) / 180, cx, cy),
		ck.Matrix.scaled(1, ry / rx, cx, cy),
	);
	return bin.track(
		ck.Shader.MakeRadialGradient(
			[cx, cy],
			rx,
			colors,
			offsets,
			ck.TileMode.Clamp,
			localMatrix,
		),
	);
}

// A TypefaceFontProvider registered from explicit font bytes (no global font
// registry, no cache poisoning) — Paragraph resolves families against it.
// The env's whole fonts map, then whatever the scene loaded from elsewhere.
function withEnvFonts(
	loaded: LoadedFontBytes[],
	fonts: Map<string, Uint8Array[]>,
): LoadedFontBytes[] {
	const out: LoadedFontBytes[] = [];
	for (const [family, faces] of fonts)
		for (const bytes of faces) out.push({ family, bytes });
	for (const f of loaded) if (!fonts.has(f.family)) out.push(f);
	return out;
}

function makeFontProvider(
	ck: CanvasKit,
	fonts: LoadedFontBytes[],
): TypefaceFontProvider {
	const provider = ck.TypefaceFontProvider.Make();
	for (const f of fonts) {
		provider.registerFont(fontArrayBuffer(f.bytes), f.family);
	}
	return provider;
}

const STROKE_CAP: Record<string, EnumKey<StrokeCapEnumValues>> = {
	butt: "Butt",
	round: "Round",
	square: "Square",
};
const STROKE_JOIN: Record<string, EnumKey<StrokeJoinEnumValues>> = {
	miter: "Miter",
	round: "Round",
	bevel: "Bevel",
};

function strokePaint(ck: CanvasKit, bin: Bin, stroke: Stroke): Paint {
	const p = bin.track(new ck.Paint());
	p.setAntiAlias(true);
	p.setStyle(ck.PaintStyle.Stroke);
	p.setColor(toColor(ck, stroke.color));
	p.setStrokeWidth(stroke.width);
	p.setStrokeCap(ck.StrokeCap[STROKE_CAP[stroke.cap ?? "butt"]]);
	p.setStrokeJoin(ck.StrokeJoin[STROKE_JOIN[stroke.join ?? "miter"]]);
	if (stroke.dash && stroke.dash.length > 0)
		p.setPathEffect(bin.track(ck.PathEffect.MakeDash(stroke.dash)));
	return p;
}

// An inside/outside stroke along an arbitrary outline: twice the width,
// clipped to the outline's interior (inside) or its exterior (outside). A
// path's fill type decides what the interior is.
function drawClippedStroke(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	outline: Outline,
	stroke: Stroke,
) {
	canvas.save();
	clipOutline(
		ck,
		canvas,
		outline,
		stroke.align === "inside" ? ck.ClipOp.Intersect : ck.ClipOp.Difference,
	);
	drawOutline(
		canvas,
		outline,
		strokePaint(ck, bin, { ...stroke, width: stroke.width * 2 }),
	);
	canvas.restore();
}

type Outline =
	| { kind: "rect"; rect: Rect }
	| { kind: "rrect"; rrect: RRect }
	| { kind: "path"; path: Path; dx?: number; dy?: number };

// A path outline is built at the origin and placed by the canvas matrix, as
// drawPath places a node's path. Skia converts an SVG arc between diametric
// endpoints in float, so an ellipse built at an offset comes out slightly
// distorted and antialiases differently from the one drawMasked draws.
function outlineOf(
	ck: CanvasKit,
	bin: Bin,
	shape: ShapeMask,
	x: number,
	y: number,
	w: number,
	h: number,
	inset = 0,
): Outline | null {
	const g = outlineGeometry(shape, x, y, w, h, inset);
	if (!g) return null;
	if (g.kind === "path") {
		const local = outlineGeometry(shape, 0, 0, w, h, inset);
		if (local?.kind !== "path") return null;
		const path = bin.path(ck, local.d) as Path;
		return { kind: "path", path, dx: x, dy: y };
	}
	const rect = ck.LTRBRect(...g.ltrb);
	if (g.kind === "rect") return { kind: "rect", rect };
	const [tl, tr, br, bl] = g.radii;
	return {
		kind: "rrect",
		rrect: Float32Array.of(...g.ltrb, tl, tl, tr, tr, br, br, bl, bl),
	};
}

function drawOutline(canvas: Canvas, o: Outline, paint: Paint) {
	if (o.kind === "rect") canvas.drawRect(o.rect, paint);
	else if (o.kind === "rrect") canvas.drawRRect(o.rrect, paint);
	else if (!o.dx && !o.dy) canvas.drawPath(o.path, paint);
	else {
		canvas.save();
		canvas.translate(o.dx ?? 0, o.dy ?? 0);
		canvas.drawPath(o.path, paint);
		canvas.restore();
	}
}

function clipOutline(
	ck: CanvasKit,
	canvas: Canvas,
	o: Outline,
	op = ck.ClipOp.Intersect,
) {
	if (o.kind === "rect") canvas.clipRect(o.rect, op, true);
	else if (o.kind === "rrect") canvas.clipRRect(o.rrect, op, true);
	else {
		canvas.translate(o.dx ?? 0, o.dy ?? 0);
		canvas.clipPath(o.path, op, true);
		canvas.translate(-(o.dx ?? 0), -(o.dy ?? 0));
	}
}

function outlineMatrix(o: Outline, m: Affine): Affine {
	return o.kind === "path" && (o.dx || o.dy)
		? translateAffine(m, o.dx ?? 0, o.dy ?? 0)
		: m;
}

function clipShape(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	shape: ShapeMask,
	pos: { x: number; y: number },
	size: Size,
) {
	clipOutline(
		ck,
		canvas,
		outlineOf(ck, bin, shape, pos.x, pos.y, size.width, size.height) as Outline,
	);
}

function outlineBounds(o: Outline): Bounds {
	if (o.kind === "path") {
		const [l, t, r, b] = o.path.getBounds();
		return [l, t, r, b] as Bounds;
	}
	const r = o.kind === "rect" ? o.rect : o.rrect;
	return [r[0], r[1], r[2], r[3]].map(f32) as Bounds;
}

// The stroke along `shape`, offset for inside/outside alignment.
function drawOutlineStroke(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	shape: ShapeMask,
	pos: { x: number; y: number },
	size: Size,
	stroke: Stroke,
) {
	const { x, y } = pos;
	const { width: w, height: h } = size;
	const inset = strokeInset(stroke);
	const o = outlineOf(ck, bin, shape, x, y, w, h, inset);
	if (o) {
		drawOutline(canvas, o, strokePaint(ck, bin, stroke));
		return;
	}
	const whole = outlineOf(ck, bin, shape, x, y, w, h) as Outline;
	drawClippedStroke(ck, canvas, bin, whole, stroke);
}

function textStyleOf(
	ck: CanvasKit,
	span: DrawTextCommand["layout"]["lines"][number]["spans"][number],
	cmd: DrawTextCommand,
	fallbackFamilies: string[] = [],
	wordSpacing?: number,
) {
	const weight =
		WEIGHTS[Math.round((span.font.weight || 400) / 100) * 100] ?? "Normal";
	return {
		color: toColor(ck, span.color ?? cmd.color ?? "#000000"),
		fontFamilies: [
			span.font.family,
			...fallbackFamilies.filter((f) => f !== span.font.family),
		],
		fontSize: span.font.size,
		fontStyle: {
			weight: ck.FontWeight[weight],
			slant:
				span.font.style === "italic" ? ck.FontSlant.Italic : ck.FontSlant.Upright,
		},
		// Instantiate a variable face at the span's weight and axes instead of
		// drawing its default instance under synthetic bold — see paragraph-layout's
		// spanTextStyle, which measures with the identical style.
		fontVariations: fontVariationList(span.font.weight, span.font.variations),
		...(span.font.features
			? { fontFeatures: fontFeatureList(span.font.features) }
			: {}),
		...(span.font.letterSpacing
			? { letterSpacing: span.font.letterSpacing }
			: {}),
		...(wordSpacing ? { wordSpacing } : {}),
	};
}

// Render each baked line with a ParagraphBuilder — HarfBuzz shaping applies the
// kerning Figma uses — aligning the paragraph's baseline to the baked
// baseline via getLineMetrics.
const shapedLines = new WeakMap<TypefaceFontProvider, PaintCacheState>();

function drawText(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	bin: Bin,
	cmd: DrawTextCommand,
) {
	// A gradient fill spans the whole text box, applied to every glyph (via a
	// foreground paint) and its decoration, overriding per-span colors.
	const fillShader =
		cmd.fill && cmd.fill.kind !== "solid"
			? shaderFor(
					ck,
					bin,
					cmd.fill,
					cmd.pos.x,
					cmd.pos.y,
					cmd.size.width,
					cmd.size.height,
					{ px: devicePx(canvas) },
				)
			: null;
	let fgPaint: Paint | null = null;
	let bgPaint: Paint | null = null;
	if (fillShader) {
		fgPaint = bin.track(new ck.Paint());
		fgPaint.setAntiAlias(true);
		fgPaint.setShader(fillShader);
		bgPaint = bin.track(new ck.Paint());
		bgPaint.setColor(ck.TRANSPARENT);
	}
	const fallback = (provider as { __families?: string[] }).__families ?? [];
	if (cmd.arc) {
		drawArcText(ck, canvas, provider, bin, cmd, cmd.arc, fallback, fgPaint);
		return;
	}
	// Gradient paints depend on position, so those lines are not cached.
	const cache = fgPaint ? undefined : shapedLines.get(provider);
	const rows = visibleRows(canvas);
	for (const line of cmd.layout.lines) {
		const first = line.spans[0];
		if (!first) continue;
		if (rows) {
			const baseline = line.baseline ?? line.y;
			const reach = 2 * Math.max(...line.spans.map((s) => s.font.size));
			if (baseline + reach < rows.top || baseline - reach > rows.bottom)
				continue;
		}
		const shape = () =>
			shapeLine(ck, provider, cmd, line, fallback, fgPaint, bgPaint);
		let shaped: ShapedLine;
		if (cache)
			shaped = cachedLine(cache, lineKey(line, cmd.color, fallback), shape);
		else {
			shaped = shape();
			bin.track(shaped.para);
		}
		const { para, ascent } = shaped;
		const left =
			line.direction === "rtl"
				? Math.min(...line.spans.map((s) => s.x))
				: first.x;
		canvas.drawParagraph(para, left, (line.baseline ?? line.y) - ascent);
		// Decoration lines are drawn as rects
		// rather than via Paragraph decoration, so both backends agree.
		const baseline = line.baseline ?? line.y;
		for (const span of line.spans) {
			if (!span.font.decoration) continue;
			const { top, thickness } = decorationLine(
				span.font.size,
				span.font.decoration,
				baseline,
			);
			const p = bin.track(new ck.Paint());
			p.setAntiAlias(true);
			if (fillShader) p.setShader(fillShader);
			else p.setColor(toColor(ck, span.color));
			canvas.drawRect(ck.XYWHRect(span.x, top, span.width, thickness), p);
		}
	}
}

// Each baked line shaped once, as drawText shapes it, with its run positions
// relative to the paragraph baseline and its ring offset from the first line.
function arcLines(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	bin: Bin,
	cmd: DrawTextCommand,
	fallback: string[],
): { line: TextLine; arc: ArcLine }[] {
	const cache = shapedLines.get(provider);
	const first = cmd.layout.lines[0];
	const base0 = first ? (first.baseline ?? first.y) : 0;
	const out: { line: TextLine; arc: ArcLine }[] = [];
	for (const line of cmd.layout.lines) {
		if (!line.spans[0]) continue;
		const shape = () =>
			shapeLine(ck, provider, cmd, line, fallback, null, null);
		let shaped: ShapedLine;
		if (cache)
			shaped = cachedLine(cache, lineKey(line, cmd.color, fallback), shape);
		else {
			shaped = shape();
			bin.track(shaped.para);
		}
		const sl = shaped.para.getShapedLines()[0];
		for (const run of sl?.runs ?? []) bin.track(run.typeface);
		out.push({
			line,
			arc: {
				runs: sl?.runs ?? [],
				baseline: sl?.baseline ?? 0,
				offset: (line.baseline ?? line.y) - base0,
			},
		});
	}
	return out;
}

function arcCenter(cmd: DrawTextCommand): [number, number] {
	return [
		cmd.pos.x + cmd.size.width / 2,
		cmd.pos.y + cmd.size.height / 2,
	];
}

function runFont(ck: CanvasKit, bin: Bin, run: GlyphRun): Font {
	const font = bin.track(new ck.Font(run.typeface, run.size));
	font.setSubpixel(true);
	font.setEdging(ck.FontEdging.AntiAlias);
	const scaleX = (run as { scaleX?: number }).scaleX;
	if (scaleX && scaleX !== 1) font.setScaleX(scaleX);
	if (run.fakeBold) font.setEmbolden(true);
	if (run.fakeItalic) font.setSkewX(-FAKE_ITALIC_SKEW);
	return font;
}

// Text along a circle: the line's own shaped glyphs, each drawn under an
// RSXform, colored by the span its cluster belongs to.
function drawArcText(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	bin: Bin,
	cmd: DrawTextCommand,
	arc: TextArc,
	fallback: string[],
	fgPaint: Paint | null,
) {
	const lines = arcLines(ck, provider, bin, cmd, fallback);
	const [cx, cy] = arcCenter(cmd);
	const placed = placeOnArc(
		lines.map((l) => l.arc),
		arc,
		cx,
		cy,
	);
	const paints = new Map<string, Paint>();
	const paintFor = (color: string) => {
		let p = paints.get(color);
		if (!p) {
			p = bin.track(new ck.Paint());
			p.setAntiAlias(true);
			p.setColor(toColor(ck, color));
			paints.set(color, p);
		}
		return p;
	};
	lines.forEach(({ line, arc: shaped }, li) => {
		const starts = spanByteStarts(line.spans.map((s) => s.text));
		shaped.runs.forEach((run, ri) => {
			const xforms = placed[li]?.[ri];
			const n = run.glyphs.length;
			if (!xforms || n === 0) return;
			const font = runFont(ck, bin, run);
			let from = 0;
			while (from < n) {
				const span = spanAt(starts, run.offsets[from] as number);
				let to = from + 1;
				while (to < n && spanAt(starts, run.offsets[to] as number) === span)
					to++;
				const blob = ck.TextBlob.MakeFromRSXformGlyphs(
					run.glyphs.subarray(from, to),
					xforms.subarray(4 * from, 4 * to),
					font,
				);
				if (blob) {
					bin.track(blob);
					const color = line.spans[span]?.color ?? cmd.color ?? "#000000";
					canvas.drawTextBlob(blob, 0, 0, fgPaint ?? paintFor(color));
				}
				from = to;
			}
		});
	});
}

// The local rects arc text's glyphs can cover: each glyph's font box under its
// RSXform.
function arcTextBounds(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	bin: Bin,
	cmd: DrawTextCommand,
	arc: TextArc,
	fallback: string[],
	em: Bounds,
): Bounds[] {
	const lines = arcLines(ck, provider, bin, cmd, fallback);
	const [cx, cy] = arcCenter(cmd);
	const placed = placeOnArc(
		lines.map((l) => l.arc),
		arc,
		cx,
		cy,
	);
	const out: Bounds[] = [];
	lines.forEach(({ arc: shaped }, li) => {
		shaped.runs.forEach((run, ri) => {
			const xforms = placed[li]?.[ri];
			if (!xforms) return;
			const size = run.size;
			const skew = run.fakeItalic
				? FAKE_ITALIC_SKEW * Math.max(-em[1], em[3], 0) * size
				: 0;
			const slack = size / 8;
			const b = rsxformBounds(xforms, [
				Math.min(0, em[0]) * size - skew - slack,
				Math.min(0, em[1]) * size - slack,
				Math.max(0, em[2]) * size + skew + slack,
				Math.max(0, em[3]) * size + slack,
			]);
			if (b) out.push(b);
		});
	});
	return out;
}

function shapeLine(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	cmd: DrawTextCommand,
	line: DrawTextCommand["layout"]["lines"][number],
	fallback: string[],
	fgPaint: Paint | null,
	bgPaint: Paint | null,
): ShapedLine {
	const first = line.spans[0] as (typeof line.spans)[number];
	const style = new ck.ParagraphStyle({
		textStyle: textStyleOf(ck, first, cmd, fallback, line.wordSpacing),
		...(line.direction === "rtl"
			? {
					textDirection: ck.TextDirection.RTL,
					textAlign: ck.TextAlign.Left,
				}
			: {}),
	});
	const builder = makeParagraphBuilder(ck, style, provider);
	for (const span of line.spans) {
		// Typed as a constructor only; CanvasKit also allows the plain call.
		const ts = (ck.TextStyle as unknown as (ts: TextStyle) => TextStyle)(
			textStyleOf(ck, span, cmd, fallback, line.wordSpacing),
		);
		if (fgPaint) builder.pushPaintStyle(ts, fgPaint, bgPaint as Paint);
		else builder.pushStyle(ts);
		builder.addText(span.text);
		builder.pop();
	}
	const para = builder.build();
	builder.delete();
	para.layout(1e6); // single pre-wrapped line; no re-wrapping
	const lm = para.getLineMetrics();
	return { para, ascent: lm.length ? lm[0].ascent : 0 };
}

// Mitchell–Netravali cubic (B = C = 1/3): Skia's canonical "high quality"
// resampler — sharp, ring-free magnification and clean mild minification.
const MITCHELL = 1 / 3;

// Draw a scaled image slice with quality sampling chosen by scale direction.
// drawImageRect's bare overload falls back to SkSamplingOptions()'s default —
// nearest-neighbour, no mipmaps — so any up- or down-scaled placement comes out
// jagged and soft (visible on the OG share card, whose art is downscaled into
// its frame). Card art is routinely dropped into a slot larger or smaller than
// itself, so pick per draw:
//   • Heavy minification (a big photo shrunk into a small slot): sample a
//     mipmapped copy trilinearly, so shrinking doesn't alias or shimmer.
//   • Otherwise (upscale, or a mild shrink like the OG card): Mitchell cubic.
function drawImageRectHQ(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	src: string,
	img: Image,
	rect: Rect,
	dest: Rect,
	paint: Paint | null,
	scale: number,
) {
	// Below this ratio, cubic sampling of the full-res image starts to alias;
	// mipmaps (each level pre-filtered) keep the shrink clean. Above it, cubic
	// is both sharper and cheaper (no mip pyramid to build).
	if (scale > 0 && scale < 0.5) {
		const mipped = bin.mipmaps(src, img);
		canvas.drawImageRectOptions(
			mipped,
			rect,
			dest,
			ck.FilterMode.Linear,
			ck.MipmapMode.Linear,
			paint,
		);
	} else {
		canvas.drawImageRectCubic(img, rect, dest, MITCHELL, MITCHELL, paint);
	}
}

// A light-gray field + a centered photo glyph (frame + sun + mountains) for an unresolved image.
function drawImagePlaceholder(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	pos: { x: number; y: number },
	size: { width: number; height: number },
) {
	const field = bin.track(new ck.Paint());
	field.setColor(toColor(ck, "#e5e7eb"));
	canvas.drawRect(ck.XYWHRect(pos.x, pos.y, size.width, size.height), field);
	const icon = Math.min(size.width, size.height) * 0.38;
	if (icon < 6) return;
	const x = pos.x + (size.width - icon) / 2;
	const y = pos.y + (size.height - icon) / 2;
	const gray = toColor(ck, "#9ca3af");
	const stroke = bin.track(new ck.Paint());
	stroke.setColor(gray);
	stroke.setStyle(ck.PaintStyle.Stroke);
	stroke.setStrokeWidth(Math.max(1, icon * 0.07));
	stroke.setAntiAlias(true);
	canvas.drawRect(ck.XYWHRect(x, y, icon, icon), stroke);
	const fill = bin.track(new ck.Paint());
	fill.setColor(gray);
	fill.setAntiAlias(true);
	// This CanvasKit build only exposes Path.MakeFromSVGString, so
	// draw the sun as an SVG circle path rather than canvas.drawCircle.
	const sr = icon * 0.1;
	const scx = x + icon * 0.32;
	const scy = y + icon * 0.3;
	const sun = `M ${scx - sr} ${scy} A ${sr} ${sr} 0 1 0 ${scx + sr} ${scy} A ${sr} ${sr} 0 1 0 ${scx - sr} ${scy} Z`;
	canvas.drawPath(bin.path(ck, sun) as Path, fill);
	const mtn = `M ${x + icon * 0.08} ${y + icon * 0.85} L ${x + icon * 0.42} ${
		y + icon * 0.5
	} L ${x + icon * 0.62} ${y + icon * 0.68} L ${x + icon * 0.8} ${
		y + icon * 0.45
	} L ${x + icon * 0.92} ${y + icon * 0.85} Z`;
	canvas.drawPath(bin.path(ck, mtn) as Path, fill);
}

// The node's outline stroke, drawn along its mask (or its box when unmasked).
// Shared by the painted-image and placeholder paths so both get the same border.
function drawImageStroke(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	cmd: DrawImageCommand,
) {
	if (!cmd.stroke) return;
	drawOutlineStroke(
		ck,
		canvas,
		bin,
		cmd.clip ?? { kind: "rect" },
		cmd.pos,
		cmd.size,
		cmd.stroke,
	);
}

function drawImage(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	images: Map<string, Image | SvgPicture>,
	cmd: DrawImageCommand,
	issues: PaintIssues,
) {
	const { pos, size } = cmd;
	const img = images.get(cmd.src);
	if (!img) {
		// No image (unfilled {{token}} in a preview, or a failed load) → draw an
		// image placeholder (gray field + photo glyph) rather than a bare rect,
		// clipped to the node's mask so it matches the shape a real image fills
		// (e.g. a circular avatar), then stroked like the painted path. Reported so
		// callers that expected a real image can tell — previews that intend the
		// placeholder simply ignore the warning.
		issues.missingImages.push(cmd.src);
		canvas.save();
		if (cmd.clip) clipShape(ck, canvas, bin, cmd.clip, pos, size);
		drawImagePlaceholder(ck, canvas, bin, pos, size);
		canvas.restore();
		drawImageStroke(ck, canvas, bin, cmd);
		return;
	}
	canvas.save();
	if (cmd.clip) clipShape(ck, canvas, bin, cmd.clip, pos, size);
	if (isSvgPicture(img)) {
		drawSvgPicture(ck, canvas, bin, img, cmd);
		canvas.restore();
		drawImageStroke(ck, canvas, bin, cmd);
		return;
	}
	const paint = bin.track(new ck.Paint());
	paint.setAntiAlias(true);
	if (cmd.fit === "tile") {
		const shader = bin.track(
			img.makeShaderOptions(
				ck.TileMode.Repeat,
				ck.TileMode.Repeat,
				ck.FilterMode.Linear,
				ck.MipmapMode.None,
			),
		);
		paint.setShader(shader);
		canvas.drawRect(ck.XYWHRect(pos.x, pos.y, size.width, size.height), paint);
	} else {
		const r = fitRect(
			img.width(),
			img.height(),
			pos.x,
			pos.y,
			size.width,
			size.height,
			cmd.fit,
			cmd,
		);
		drawImageRectHQ(
			ck,
			canvas,
			bin,
			cmd.src,
			img,
			ck.XYWHRect(r.sx, r.sy, r.sw, r.sh),
			ck.XYWHRect(r.dx, r.dy, r.dw, r.dh),
			paint,
			Math.min(r.dw / r.sw, r.dh / r.sh),
		);
	}
	canvas.restore();
	drawImageStroke(ck, canvas, bin, cmd);
}

// A barcode reads by the widths of its bars, so an edge that lands between two
// pixels (a grey column either side of a bar) is a misread waiting to happen.
// When the bitmap is drawn upright, its module size in output pixels is floored
// to a whole number and the code centred in its box on whole pixels. Returns the
// rect in device space, or null to draw as placed.
function snapBarcode(
	canvas: Pick<Canvas, "getTotalMatrix">,
	cmd: DrawBitmapCommand,
	grid: number,
): { x: number; y: number; width: number; height: number } | null {
	const m = canvas.getTotalMatrix();
	const [a, b, c, d, e, f, g, h] = m;
	const eps = 1e-9;
	if (
		Math.abs(b) > eps ||
		Math.abs(d) > eps ||
		Math.abs(g) > eps ||
		Math.abs(h) > eps ||
		a <= 0 ||
		e <= 0
	)
		return null;
	const { pos, size, pixelWidth, pixelHeight } = cmd;
	const dx = (a * pos.x + c) / grid;
	const dy = (e * pos.y + f) / grid;
	const dw = (a * size.width) / grid;
	const dh = (e * size.height) / grid;
	const along = (start: number, extent: number, module: number, n: number) => {
		if (module < 1) return { start, extent };
		const snapped = Math.floor(module + 1e-6) * n;
		return {
			start: Math.round(start + (extent - snapped) / 2),
			extent: snapped,
		};
	};
	// A 1D code is one row stretched to the bar height, so only its columns
	// carry modules; its top and bottom just land on whole pixels. A 2D code
	// keeps square modules, so both axes take the smaller whole size.
	let x: { start: number; extent: number };
	let y: { start: number; extent: number };
	if (pixelHeight === 1) {
		x = along(dx, dw, dw / pixelWidth, pixelWidth);
		const top = Math.round(dy);
		y = { start: top, extent: Math.max(1, Math.round(dy + dh) - top) };
	} else {
		const module = Math.min(dw / pixelWidth, dh / pixelHeight);
		x = along(dx, dw, module, pixelWidth);
		y = along(dy, dh, module, pixelHeight);
	}
	return {
		x: x.start * grid,
		y: y.start * grid,
		width: x.extent * grid,
		height: y.extent * grid,
	};
}

function drawBitmap(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	cmd: DrawBitmapCommand,
	frame: Frame,
) {
	const { pos, size, pixels, pixelWidth, pixelHeight } = cmd;
	if (pixelWidth <= 0 || pixelHeight <= 0) return;
	const img = makeImageFromPixels(
		ck,
		"pixels",
		pixelWidth,
		pixelHeight,
		pixels,
	);
	if (!img) return;
	canvas.save();
	if (cmd.clip) clipShape(ck, canvas, bin, cmd.clip, pos, size);
	const paint = bin.track(new ck.Paint());
	const snapped =
		cmd.role === "barcode" ? snapBarcode(canvas, cmd, frame.grid ?? 1) : null;
	// Nearest-neighbor keeps QR module / pixel-art edges crisp when scaled up.
	const src = ck.XYWHRect(0, 0, pixelWidth, pixelHeight);
	if (snapped) {
		// Drawn in device space, where the snapped rect was worked out.
		const inverse = ck.Matrix.invert(canvas.getTotalMatrix());
		if (inverse) canvas.concat(inverse);
		canvas.drawImageRectOptions(
			img,
			src,
			ck.XYWHRect(snapped.x, snapped.y, snapped.width, snapped.height),
			ck.FilterMode.Nearest,
			ck.MipmapMode.None,
			paint,
		);
	} else {
		canvas.drawImageRectOptions(
			img,
			src,
			ck.XYWHRect(pos.x, pos.y, size.width, size.height),
			ck.FilterMode.Nearest,
			ck.MipmapMode.None,
			paint,
		);
	}
	img.delete();
	canvas.restore();
}

export type SvgPicture = {
	svgPicture: SkPicture;
	width: number;
	height: number;
	// Pixels of the rasters the recording holds, nested pictures' included.
	rasterPixels: number;
	features: string[];
	delete(): void;
};

function isSvgPicture(img: unknown): img is SvgPicture {
	return typeof img === "object" && img !== null && "svgPicture" in img;
}

// What a drawing embeds: the data URLs its images draw, and whether it has
// text, which a picture leaves out.
function svgContents(
	items: SvgItem[],
	out: { images: Set<string>; text: boolean },
): { images: Set<string>; text: boolean } {
	for (const item of items) {
		if (item.kind === "image") out.images.add(item.href);
		else if (item.kind === "text") out.text = true;
		else if (item.kind === "group") {
			svgContents(item.children, out);
			if (item.mask) svgContents(item.mask, out);
		}
	}
	return out;
}

const MAX_SVG_NESTING = 4;

type SvgModule = typeof import("./svg/index");

let svgModule: Promise<SvgModule> | undefined;
function loadSvg(): Promise<SvgModule> {
	svgModule ??= import("./svg/index").catch((e) => {
		svgModule = undefined;
		throw e;
	});
	return svgModule;
}

// Recorded at the drawing's own size and scaled when drawn, so it stays
// vector at every density.
function makeSvgPicture(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	bytes: Uint8Array,
	svg: SvgModule,
	nesting = 0,
): SvgPicture {
	const { parseSvg, svgToNode } = svg;
	const drawing = parseSvg(new TextDecoder().decode(bytes));
	const { width, height } = drawing;
	const contents = svgContents(drawing.children, {
		images: new Set(),
		text: false,
	});
	const features = drawing.warnings.map((w) => w.feature);
	if (contents.text) features.push("text");
	const images = new Map<string, Image | SvgPicture>();
	for (const src of contents.images) {
		try {
			const data = dataUrlToBytes(src);
			const img = isSvg(data)
				? nesting < MAX_SVG_NESTING
					? makeSvgPicture(ck, provider, data, svg, nesting + 1)
					: null
				: ck.MakeImageFromEncoded(data);
			if (img) images.set(src, img);
			else if (!features.includes("image-decode")) features.push("image-decode");
		} catch {
			if (!features.includes("image-decode")) features.push("image-decode");
		}
	}
	const commands = compileScene(svgToNode(drawing), { width, height });
	const recorder = new ck.PictureRecorder();
	const bin = makeBin();
	try {
		const canvas = recorder.beginRecording(ck.LTRBRect(0, 0, width, height));
		const issues: PaintIssues = {
			unhandled: [],
			missingImages: [],
			adjustUnsupported: new Map(),
		};
		for (const cmd of commands)
			if (cmd.op.startsWith("draw"))
				paintDrawable(
					ck,
					canvas,
					provider,
					images,
					bin,
					cmd as DrawCommand,
					issues,
					{ width, height, scale: 1, grid: 1 },
				);
		const picture = recorder.finishRecordingAsPicture();
		let rasterPixels = 0;
		for (const img of images.values())
			rasterPixels += isSvgPicture(img)
				? img.rasterPixels
				: img.width() * img.height();
		return {
			svgPicture: picture,
			width,
			height,
			rasterPixels,
			features,
			delete: () => picture.delete(),
		};
	} finally {
		for (const img of images.values()) img.delete();
		bin.free();
		recorder.delete();
	}
}

function drawSvgPicture(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	img: SvgPicture,
	cmd: DrawImageCommand,
) {
	const { pos, size } = cmd;
	if (cmd.fit === "tile") {
		const paint = bin.track(new ck.Paint());
		paint.setAntiAlias(true);
		paint.setShader(
			bin.track(
				img.svgPicture.makeShader(
					ck.TileMode.Repeat,
					ck.TileMode.Repeat,
					ck.FilterMode.Linear,
					// Typed as optional; CanvasKit also takes null.
					null as unknown as InputMatrix,
					ck.LTRBRect(0, 0, img.width, img.height),
				),
			),
		);
		canvas.drawRect(ck.XYWHRect(pos.x, pos.y, size.width, size.height), paint);
		return;
	}
	const r = fitRect(
		img.width,
		img.height,
		pos.x,
		pos.y,
		size.width,
		size.height,
		cmd.fit,
		cmd,
	);
	canvas.clipRect(ck.XYWHRect(r.dx, r.dy, r.dw, r.dh), ck.ClipOp.Intersect, true);
	canvas.translate(r.dx, r.dy);
	canvas.scale(r.dw / r.sw, r.dh / r.sh);
	canvas.translate(-r.sx, -r.sy);
	canvas.drawPicture(img.svgPicture);
}

function drawPath(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	cmd: DrawPathCommand,
) {
	const path = bin.path(ck, cmd.d, cmd.fillRule === "evenodd");
	if (!path) return;
	canvas.save();
	canvas.translate(cmd.pos.x, cmd.pos.y); // path coords are origin-relative
	// A viewBox scales the authored path into the node's size box (SVG viewBox →
	// viewport). Fills then span the viewBox, so they map onto the full box.
	const vb = cmd.viewBox;
	let boxW = cmd.size.width;
	let boxH = cmd.size.height;
	const space: PatternSpace = { px: devicePx(canvas) };
	if (vb && vb.width > 0 && vb.height > 0) {
		canvas.scale(cmd.size.width / vb.width, cmd.size.height / vb.height);
		if (vb.x || vb.y) canvas.translate(-(vb.x ?? 0), -(vb.y ?? 0));
		boxW = vb.width;
		boxH = vb.height;
		space.unit = [vb.width / cmd.size.width, vb.height / cmd.size.height];
	}
	const ox = vb?.x ?? 0;
	const oy = vb?.y ?? 0;
	for (const fill of cmd.fills ?? []) {
		const paint = bin.track(new ck.Paint());
		paint.setAntiAlias(true);
		if (fill.kind === "solid") paint.setColor(toColor(ck, fill.color));
		else if (fill.kind === "pattern")
			paint.setShader(patternShader(ck, bin, fill, ox, oy, space));
		else paint.setShader(shaderFor(ck, bin, fill, 0, 0, boxW, boxH));
		canvas.drawPath(path, paint);
	}
	if (cmd.stroke) {
		const outline = cmd.strokeD ? bin.path(ck, cmd.strokeD) : null;
		if (outline) canvas.drawPath(outline, strokePaint(ck, bin, cmd.stroke));
		else if (strokeInset(cmd.stroke) !== 0)
			drawClippedStroke(ck, canvas, bin, { kind: "path", path }, cmd.stroke);
		else canvas.drawPath(path, strokePaint(ck, bin, cmd.stroke));
	}
	canvas.restore();
}

// Out-param threaded through the recursive paint walk, collecting the non-fatal
// problems the caller turns into PaintWarnings. `missingImages` matters because a
// drawImage whose src has no decoded entry paints the placeholder glyph — visually
// a plausible image, so without this a scene whose srcs never reached the loader
// reports a clean paint and callers serve a card full of placeholders.
type PaintIssues = {
	unhandled: string[];
	missingImages: string[];
	// `adjust` components this CanvasKit build can't apply (see layerPaint).
	adjustUnsupported: Map<
		string,
		{ component: "lut" | "lut3d" | "sharpen" | "gamut"; layer?: string }
	>;
};

function reportAdjustUnsupported(
	issues: PaintIssues,
	cmd: DrawCommand,
	component: "lut" | "lut3d" | "sharpen" | "gamut",
) {
	const layer = cmd.id ?? (cmd.op === "drawImage" ? cmd.src : undefined);
	issues.adjustUnsupported.set(`${component}\u0000${layer ?? ""}`, {
		component,
		layer,
	});
}

// Visible local y range, or null when the transform rotates or skews.
function visibleRows(canvas: Canvas): { top: number; bottom: number } | null {
	const [, b, , d, e, f, g, h, i] = canvas.getTotalMatrix();
	if (b !== 0 || d !== 0 || g !== 0 || h !== 0 || i !== 1 || !(e > 0))
		return null;
	const clip = canvas.getDeviceClipBounds();
	return { top: (clip[1] - f) / e, bottom: (clip[3] - f) / e };
}

// Everything textStyleOf and the paragraph style read. Strings are length
// prefixed so no text can forge a separator.
function lineKey(
	line: DrawTextCommand["layout"]["lines"][number],
	color: string | undefined,
	fallback: string[],
): string {
	const str = (s: string | undefined) =>
		s === undefined ? "-" : `${s.length}:${s}`;
	const record = (r: Record<string, number> | undefined) => {
		let out = "";
		if (r) for (const [k, v] of Object.entries(r)) out += `${str(k)}=${v},`;
		return out;
	};
	let key = `${fallback.length}${fallback.map(str).join("")}${str(color)}`;
	key += `|${line.wordSpacing || 0}|${line.direction ?? ""}`;
	for (const s of line.spans) {
		const f = s.font;
		key += `|${str(s.text)}${str(s.color)}${str(f.family)}`;
		key += `${f.weight},${f.style},${f.size},${f.letterSpacing || 0}`;
		key += `;${record(f.variations)};${record(f.features)}`;
	}
	return key;
}

function drawShape(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	images: Map<string, Image | SvgPicture>,
	bin: Bin,
	cmd: DrawCommand,
	issues: PaintIssues,
	frame: Frame,
) {
	if (cmd.op === "drawRect") {
		const { x, y } = cmd.pos;
		const { width: w, height: h } = cmd.size;
		const shape = rectShape(cmd.cornerRadius, cmd.cornerSmoothing);
		const outline = outlineOf(ck, bin, shape, x, y, w, h) as Outline;
		for (const fill of cmd.fills ?? []) {
			const paint = bin.track(new ck.Paint());
			paint.setAntiAlias(true);
			if (fill.kind === "solid") paint.setColor(toColor(ck, fill.color));
			else
				paint.setShader(
					shaderFor(ck, bin, fill, x, y, w, h, { px: devicePx(canvas) }),
				);
			drawOutline(canvas, outline, paint);
		}
		if (cmd.stroke)
			drawOutlineStroke(ck, canvas, bin, shape, cmd.pos, cmd.size, cmd.stroke);
	} else if (cmd.op === "drawText") {
		drawText(ck, canvas, provider, bin, cmd);
	} else if (cmd.op === "drawImage") {
		drawImage(ck, canvas, bin, images, cmd, issues);
	} else if (cmd.op === "drawBitmap") {
		drawBitmap(ck, canvas, bin, cmd, frame);
	} else if (cmd.op === "drawPath") {
		drawPath(ck, canvas, bin, cmd);
	} else if (cmd.op === "drawQr") {
		const { pos, size, modules, margin = 0, foreground, background } = cmd;
		const m = (Math.min(size.width, size.height) - margin * 2) / modules.length;
		const bg = bin.track(new ck.Paint());
		bg.setColor(toColor(ck, background ?? "#ffffff"));
		canvas.drawRect(ck.XYWHRect(pos.x, pos.y, size.width, size.height), bg);
		const fg = bin.track(new ck.Paint());
		fg.setColor(toColor(ck, foreground));
		// Under a rotation or skew, adjacent rects rasterize their shared edges
		// differently from one merged rect, so runs are merged only when the
		// canvas is axis-aligned. Edges are computed as the per-module rects
		// computed them.
		const [, b, , d, , , g, h] = canvas.getTotalMatrix();
		const merge = b === 0 && d === 0 && g === 0 && h === 0;
		for (let y = 0; y < modules.length; y++) {
			const top = pos.y + margin + y * m;
			for (let x = 0; x < modules.length; x++) {
				if (!modules[y][x]) continue;
				const start = x;
				while (merge && x + 1 < modules.length && modules[y][x + 1]) x++;
				canvas.drawRect(
					ck.LTRBRect(
						pos.x + margin + start * m,
						top,
						pos.x + margin + x * m + m,
						top + m,
					),
					fg,
				);
			}
		}
	} else if (cmd.op === "drawGroup") {
		for (const child of cmd.children)
			paintDrawable(ck, canvas, provider, images, bin, child, issues, frame);
	} else if (cmd.op === "drawMasked") {
		drawMasked(ck, canvas, provider, images, bin, cmd, issues, frame);
	} else {
		issues.unhandled.push((cmd as { op: string }).op);
	}
}

// The general mask: draw children to an offscreen content layer, then composite
// the mask's coverage onto it. DstIn keeps content where the mask is opaque
// (DstOut where it's transparent, for invert). Luminance coverage is
// luminance(straight RGB) × alpha (SVG 1.1 masking), which equals luminance of
// the premultiplied color. A color matrix sees unpremultiplied color, so the
// mask is first composited over opaque black: the result is opaque with the
// premultiplied RGB, and the matrix then maps its luminance to alpha.
// Luminance is taken on sRGB-encoded values with Rec. 709 weights, not on
// linearRGB as SVG's default color-interpolation would.
function drawMasked(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	images: Map<string, Image | SvgPicture>,
	bin: Bin,
	cmd: DrawMaskedCommand,
	issues: PaintIssues,
	frame: Frame,
) {
	const content: DrawCommand = {
		op: "drawGroup",
		pos: cmd.pos,
		size: cmd.size,
		children: cmd.children,
	};
	const ctm = (canvas.getTotalMatrix() as number[]).slice(0, 6) as Affine;
	const bounds = originInvariant(cmd.mask, ctm)
		? layerBounds(ck, canvas, provider, images, bin, content, frame)
		: null;
	canvas.saveLayer(undefined, bounds);
	for (const child of cmd.children)
		paintDrawable(ck, canvas, provider, images, bin, child, issues, frame);
	const maskPaint = bin.track(new ck.Paint());
	maskPaint.setBlendMode(cmd.invert ? ck.BlendMode.DstOut : ck.BlendMode.DstIn);
	if (cmd.channel === "luminance")
		maskPaint.setColorFilter(
			bin.track(
				ck.ColorFilter.MakeCompose(
					bin.track(
						ck.ColorFilter.MakeMatrix([
							0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2126, 0.7152,
							0.0722, 0, 0,
						]),
					),
					bin.track(
						ck.ColorFilter.MakeBlend(ck.BLACK, ck.BlendMode.DstOver),
					),
				),
			),
		);
	canvas.saveLayer(maskPaint, bounds);
	paintDrawable(ck, canvas, provider, images, bin, cmd.mask, issues, frame);
	canvas.restore();
	canvas.restore();
}

// The color-matrix component of an `adjust` as a Skia ColorFilter — the cheap
// per-pixel path, folded into the layer paint. The nonlinear `lut` and spatial
// `sharpen` components can't be a color filter, so they take the offscreen SkSL
// path (see paintAdjustedOffscreen); here we handle only the matrix.
function adjustColorFilter(
	ck: CanvasKit,
	bin: Bin,
	cmd: DrawCommand,
): ColorFilter | null {
	const m = cmd.adjust?.colorMatrix;
	if (!m) return null;
	return shaderSideMatrix(cmd.adjust)
		? null
		: bin.track(ck.ColorFilter.MakeMatrix(m));
}

// Whether a 4×5 matrix touches only RGB: alpha is neither an input to the color
// rows (column 3) nor transformed itself (row 3 is identity). The shader carries
// alpha alongside unpremultiplied RGB, so it stands in for the color filter only
// for these. Every matrix ./adjust builds qualifies.
function matrixIsRgbOnly(m: number[]): boolean {
	if (m.length !== 20) return false;
	const zero = (v: number) => Math.abs(v) < 1e-6;
	return (
		zero(m[3]) &&
		zero(m[8]) &&
		zero(m[13]) &&
		zero(m[15]) &&
		zero(m[16]) &&
		zero(m[17]) &&
		Math.abs(m[18] - 1) < 1e-6 &&
		zero(m[19])
	);
}

// "preserve-hue" needs the matrix's unclamped output, which a Skia color filter
// never exposes — so the matrix moves onto the shader pass with it. A matrix with
// alpha terms stays on the color filter and the mode reports unsupported.
function shaderSideMatrix(a: DrawCommand["adjust"]): boolean {
	return (
		!!a &&
		a.gamut === "preserve-hue" &&
		!!a.colorMatrix &&
		matrixIsRgbOnly(a.colorMatrix)
	);
}

// True when an adjust carries components the layer-paint color filter can't do —
// the per-channel LUT (nonlinear), sharpen (spatial), or a matrix that has to be
// gamut-mapped per pixel. These take the offscreen shader path; a matrix that does
// not need mapping rides along inside that offscreen render as a color filter.
function needsShaderAdjust(cmd: DrawCommand): boolean {
	const a = cmd.adjust;
	if (!a) return false;
	if (a.lut || a.lut3d) return true;
	if (typeof a.sharpen === "number" && a.sharpen > 0) return true;
	return shaderSideMatrix(a);
}

// A 256×1 lookup image encoding a per-channel LUT (x = input 0..255, texel =
// output). Sampled Nearest/Clamp by the adjust shader.
function lutImage(
	ck: CanvasKit,
	bin: Bin,
	lut: NonNullable<DrawCommand["adjust"]>["lut"],
): Image | null {
	if (!lut) throw new Error("lutImage: no lut");
	return cachedLutImage(bin.luts, 1, [lut.r, lut.g, lut.b], () =>
		buildLutImage(ck, lut),
	);
}

function buildLutImage(
	ck: CanvasKit,
	lut: NonNullable<NonNullable<DrawCommand["adjust"]>["lut"]>,
): Image | null {
	const px = new Uint8Array(256 * 4);
	for (let i = 0; i < 256; i++) {
		px[i * 4] = lut.r[i];
		px[i * 4 + 1] = lut.g[i];
		px[i * 4 + 2] = lut.b[i];
		px[i * 4 + 3] = 255;
	}
	return makeImageFromPixels(ck, "pixels", 256, 1, px);
}

type Lut3d = NonNullable<NonNullable<DrawCommand["adjust"]>["lut3d"]>;

// A type guard, not a bare boolean, so `lut3dImage` can read `lut.size`/`lut.data`
// without re-checking after the throw.
function validLut3d(lut: Lut3d | undefined): lut is Lut3d {
	return (
		!!lut &&
		Number.isInteger(lut.size) &&
		lut.size >= 2 &&
		lut.data.length === lut.size ** 3 * 3
	);
}

// A 3D cube packed into a 2D atlas. Columns are red within blue slices and rows
// are green: atlas(x = b * size + r, y = g) = cube(r, g, b).
function lut3dImage(
	ck: CanvasKit,
	bin: Bin,
	lut: NonNullable<DrawCommand["adjust"]>["lut3d"],
): Image | null {
	if (!validLut3d(lut)) throw new Error("lut3dImage: invalid LUT");
	return cachedLutImage(bin.luts, lut.size, [lut.data], () =>
		buildLut3dImage(ck, lut),
	);
}

function buildLut3dImage(ck: CanvasKit, lut: Lut3d): Image | null {
	const width = lut.size * lut.size;
	const px = new Uint8Array(width * lut.size * 4);
	for (let b = 0; b < lut.size; b++) {
		for (let g = 0; g < lut.size; g++) {
			for (let r = 0; r < lut.size; r++) {
				const source = ((b * lut.size + g) * lut.size + r) * 3;
				const target = (g * width + b * lut.size + r) * 4;
				px[target] = lut.data[source];
				px[target + 1] = lut.data[source + 1];
				px[target + 2] = lut.data[source + 2];
				px[target + 3] = 255;
			}
		}
	}
	return makeImageFromPixels(ck, "pixels", width, lut.size, px);
}

// SkSL for the adjust post-pass, generated per feature combination. The source
// layer arrives as `src`; 1D curves and 3D cubes are child shaders when present.
// Colors are unpremultiplied before the matrix / LUT / cube / unsharp and
// re-premultiplied on the way out. Sharpen is a 3×3 unsharp mask
// (box-blur radius 1), matching the straight-alpha unsharp used elsewhere.
//
// Per-pixel order is matrix → gamut → 1D curve → 3D cube → sharpen. The gamut step
// sits after the matrix: it can leave [0,1], while both LUTs need in-range input.
function adjustShaderSksl(
	hasMatrix: boolean,
	preserveHue: boolean,
	hasLut: boolean,
	hasLut3d: boolean,
	hasSharpen: boolean,
): string {
	// Rows of the 4×5 color matrix as float4(r, g, b, bias). Declared first, so the
	// flat uniform array the caller builds starts with them.
	const matrixFn = hasMatrix
		? `uniform float4 cmR; uniform float4 cmG; uniform float4 cmB;
		   half3 mtx(half3 c){ return half3(
		     dot(c, half3(cmR.rgb)) + half(cmR.w),
		     dot(c, half3(cmG.rgb)) + half(cmG.w),
		     dot(c, half3(cmB.rgb)) + half(cmB.w)); }`
		: `half3 mtx(half3 c){ return c; }`;
	// Scale chroma toward the color's own luma until every channel fits [0,1] — the
	// largest t in [0,1] with l + t·(c−l) in range, applied to all three channels.
	// Hue direction and luma survive; saturation absorbs the difference. The
	// divisions stay under 1 (a channel above 1 has v−l > 1−l), so half precision
	// holds.
	const gamutFn = preserveHue
		? `half fitScale(half v, half l){
		     half d = v - l;
		     if (v > 1.0 && d > 0.0) return (1.0 - l) / d;
		     if (v < 0.0 && d < 0.0) return -l / d;
		     return 1.0; }
		   half3 gamut(half3 c){
		     half l = clamp(dot(c, half3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
		     half t = min(min(fitScale(c.r, l), fitScale(c.g, l)), fitScale(c.b, l));
		     return clamp(l + (c - l) * t, 0.0, 1.0); }`
		: `half3 gamut(half3 c){ return clamp(c, 0.0, 1.0); }`;
	const lutFn = hasLut
		? `uniform shader lut;
		   half3 curve(half3 c){ return half3(
		     lut.eval(float2(c.r*255.0+0.5, 0.5)).r,
		     lut.eval(float2(c.g*255.0+0.5, 0.5)).g,
		     lut.eval(float2(c.b*255.0+0.5, 0.5)).b); }`
		: `half3 curve(half3 c){ return c; }`;
	const lut3dFn = hasLut3d
		? `uniform float cubeSize;
		   uniform shader cube;
		   half3 cubeAt(float r, float g, float b){
		     return cube.eval(float2(b*cubeSize+r+0.5, g+0.5)).rgb; }
		   half3 cubeCurve(half3 c){
		     float top = cubeSize - 1.0;
		     float rf = clamp(float(c.r), 0.0, 1.0) * top;
		     float gf = clamp(float(c.g), 0.0, 1.0) * top;
		     float bf = clamp(float(c.b), 0.0, 1.0) * top;
		     float r0 = floor(rf); float g0 = floor(gf); float b0 = floor(bf);
		     float r1 = min(r0 + 1.0, top); float g1 = min(g0 + 1.0, top); float b1 = min(b0 + 1.0, top);
		     half fr = half(rf-r0); half fg = half(gf-g0); half fb = half(bf-b0);
		     half3 c00 = mix(cubeAt(r0,g0,b0), cubeAt(r1,g0,b0), fr);
		     half3 c10 = mix(cubeAt(r0,g1,b0), cubeAt(r1,g1,b0), fr);
		     half3 c01 = mix(cubeAt(r0,g0,b1), cubeAt(r1,g0,b1), fr);
		     half3 c11 = mix(cubeAt(r0,g1,b1), cubeAt(r1,g1,b1), fr);
		     return mix(mix(c00,c10,fg), mix(c01,c11,fg), fb); }`
		: `half3 cubeCurve(half3 c){ return c; }`;
	const sharpenUniform = hasSharpen ? "uniform float amount;" : "";
	// samp() returns the corrected, unpremultiplied colour at a pixel.
	const common = `uniform shader src;
		${matrixFn}
		${gamutFn}
		${lutFn}
		${lut3dFn}
		${sharpenUniform}
		half3 samp(float2 p){ half4 s = src.eval(p); half3 c = s.a > 0.0 ? s.rgb/s.a : s.rgb; return cubeCurve(curve(gamut(mtx(c)))); }`;
	const body = hasSharpen
		? `half4 s0 = src.eval(xy);
		   half3 c = samp(xy);
		   half3 sum = samp(xy+float2(-1,-1))+samp(xy+float2(0,-1))+samp(xy+float2(1,-1))
		             + samp(xy+float2(-1, 0))+c                    +samp(xy+float2(1, 0))
		             + samp(xy+float2(-1, 1))+samp(xy+float2(0, 1))+samp(xy+float2(1, 1));
		   half3 outc = clamp(c + amount*(c - sum/9.0), 0.0, 1.0);
		   return half4(outc*s0.a, s0.a);`
		: `half4 s0 = src.eval(xy);
		   half3 outc = clamp(samp(xy), 0.0, 1.0);
		   return half4(outc*s0.a, s0.a);`;
	return `${common}
		half4 main(float2 xy){ ${body} }`;
}

// RuntimeEffect is compiled per (ck, variant) and reused — Make() parses SkSL, so
// caching keeps the hot path free of recompiles. Keyed by ck so distinct CanvasKit
// instances (e.g. across tests) never share an effect.
const effectCache = new WeakMap<object, Map<string, RuntimeEffect | null>>();
function cachedEffect(
	ck: CanvasKit,
	key: string,
	make: () => RuntimeEffect | null | undefined,
): RuntimeEffect | null {
	let byVariant = effectCache.get(ck);
	if (!byVariant) {
		byVariant = new Map();
		effectCache.set(ck, byVariant);
	}
	let eff = byVariant.get(key);
	if (eff === undefined) {
		eff = make() ?? null;
		byVariant.set(key, eff);
	}
	return eff;
}

function adjustEffect(
	ck: CanvasKit,
	hasMatrix: boolean,
	preserveHue: boolean,
	hasLut: boolean,
	hasLut3d: boolean,
	hasSharpen: boolean,
): RuntimeEffect | null {
	const bit = (b: boolean) => (b ? 1 : 0);
	const key = `${bit(hasMatrix)}${bit(preserveHue)}${bit(hasLut)}${bit(hasLut3d)}${bit(hasSharpen)}`;
	return cachedEffect(ck, key, () =>
		ck.RuntimeEffect.Make(
			adjustShaderSksl(hasMatrix, preserveHue, hasLut, hasLut3d, hasSharpen),
		),
	);
}

// Recording canvases that adjustedDeviceRect is measuring. An adjusted
// descendant met while measuring paints its geometry directly instead of opening
// a nested offscreen, which a recording canvas can't provide.
const measuring = new WeakSet<object>();

type Bounds = [number, number, number, number];

// An affine SkMatrix as [scaleX, skewX, transX, skewY, scaleY, transY].
type Affine = [number, number, number, number, number, number];

// One save on the recorder's stack: the matrix it was made under and, for a
// layer, how its paint grows what is drawn inside it. A plain save reaches the
// recorder only once the matrix or clip changes under it, so only rotated
// drawables push one here.
type RecordedSave = { ctm: Affine; grow?: (b: Bounds) => Bounds };

const f32 = Math.fround;

// The cull a recording of the inner drawable would report, worked out from the
// commands instead, following SkRecordFillBounds in Skia's float arithmetic:
// each op's rect grown by its paint, passed through every enclosing save's
// matrix and paint, mapped to the device and cut to it. Clips record no bounds,
// so they cut nothing. Matching it keeps the offscreen's origin, and so every
// pixel, as before. Where an op's exact bounds are not known (glyphs), the
// estimate only ever errs larger. Null for content that is not modelled here
// (SVG images, inner shadows, blenders). With `uncut`, nothing is cut to the
// device, no line is culled, and saves grow the device rect instead.
function predictedBounds(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	bin: Bin,
	images: Map<string, Image | SvgPicture>,
	inner: DrawCommand,
	frame: Frame,
	device: Size,
	matrix: number[],
	uncut = false,
): Bounds | null {
	if (matrix.length !== 9 || matrix[6] !== 0 || matrix[7] !== 0) return null;
	if (matrix[8] !== 1) return null;
	const cull: Bounds = uncut
		? [
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				Number.POSITIVE_INFINITY,
				Number.POSITIVE_INFINITY,
			]
		: [0, 0, f32(device.width), f32(device.height)];
	let out: Bounds | null = null;
	let singular = false;
	const throughSaves = (b: Bounds, saves: RecordedSave[]): Bounds | null => {
		for (let i = saves.length - 1; i >= 0; i--) {
			const save = saves[i] as RecordedSave;
			const inverse = invertAffine(save.ctm);
			if (!inverse) return null;
			b = mapAffine(inverse, b);
			if (save.grow) b = save.grow(b);
			b = mapAffine(save.ctm, b);
		}
		return b;
	};
	const include = (b: Bounds) => {
		const cut = uncut ? b : intersectBounds(b, cull);
		if (cut) out = out ? unionBounds(out, cut) : cut;
	};
	const add = (local: Bounds, ctm: Affine, saves: RecordedSave[]) => {
		// SkRecord grows the local rect through the saves before mapping it; a
		// layer's real extent needs the mapped rect grown.
		const b = uncut
			? throughSaves(mapAffine(ctm, sortBounds(local)), saves)
			: throughSaves(sortBounds(local), saves);
		if (!b) {
			singular = true;
			return;
		}
		include(uncut ? b : mapAffine(ctm, b));
	};
	// A layer whose paint changes transparent black covers the whole cull.
	let full = false;
	const visit = (
		cmd: DrawCommand,
		ctm: Affine,
		saves: RecordedSave[],
	): boolean => {
		const c: DrawCommand =
			cmd.adjust && needsShaderAdjust(cmd)
				? ({
						...cmd,
						adjust: cmd.adjust.colorMatrix
							? { colorMatrix: cmd.adjust.colorMatrix }
							: undefined,
					} as DrawCommand)
				: cmd;
		const outer = c.rotation ? [...saves, { ctm }] : saves;
		let m = ctm;
		if (c.rotation) {
			const cx = c.pos.x + c.size.width / 2;
			const cy = c.pos.y + c.size.height / 2;
			m = translateAffine(m, cx, cy);
			m = concatAffine(m, rotationAffine(c.rotation));
			m = translateAffine(m, -cx, -cy);
		}
		if (hasBackdrop(c)) full = true;
		let within: RecordedSave[] = outer;
		const layered = hasLayerPaint(c);
		if (layered) {
			const grow = layerGrow(c);
			if (!grow) return false;
			within = [...outer, { ctm: m, grow }];
			const cm = c.adjust?.colorMatrix;
			if (cm && !shaderSideMatrix(c.adjust) && matrixTouchesTransparent(cm))
				full = true;
		}
		// The clip makes paintDrawable's plain save real.
		if (c.clip && c.op !== "drawImage" && !c.rotation && !layered)
			within = [...within, { ctm: m }];
		return visitShape(c, m, within);
	};
	const addStroke = (
		shape: ShapeMask,
		stroke: Stroke,
		x: number,
		y: number,
		w: number,
		h: number,
		m: Affine,
		within: RecordedSave[],
	) => {
		const o = outlineOf(ck, bin, shape, x, y, w, h, strokeInset(stroke));
		if (o) {
			add(
				strokeBounds(sortBounds(outlineBounds(o)), stroke),
				outlineMatrix(o, m),
				within,
			);
			return;
		}
		const whole = outlineOf(ck, bin, shape, x, y, w, h) as Outline;
		const doubled = { ...stroke, width: stroke.width * 2 };
		add(
			strokeBounds(outlineBounds(whole), doubled),
			outlineMatrix(whole, m),
			[...within, { ctm: m }],
		);
	};
	const visitShape = (
		c: DrawCommand,
		m: Affine,
		within: RecordedSave[],
	): boolean => {
		const { x, y } = c.pos;
		const { width: w, height: h } = c.size;
		const box: Bounds = [x, y, x + w, y + h].map(f32) as Bounds;
		if (c.op === "drawRect") {
			const shape = rectShape(c.cornerRadius, c.cornerSmoothing);
			if (c.fills?.length) {
				const fill = outlineOf(ck, bin, shape, x, y, w, h) as Outline;
				add(outlineBounds(fill), outlineMatrix(fill, m), within);
			}
			if (c.stroke) addStroke(shape, c.stroke, x, y, w, h, m, within);
			return true;
		}
		if (c.op === "drawText") {
			const rows = uncut ? null : device;
			const glyphs = textBounds(ck, provider, bin, c, m, rows);
			if (!glyphs) return false;
			for (const b of glyphs) add(b, m, within);
			return true;
		}
		if (c.op === "drawPath") {
			const path = bin.path(ck, c.d, c.fillRule === "evenodd");
			if (!path) return true;
			// drawPath's save is real once it moves the matrix.
			let pm = translateAffine(m, c.pos.x, c.pos.y);
			const vb = c.viewBox;
			if (vb && vb.width > 0 && vb.height > 0) {
				pm = scaleAffine(pm, w / vb.width, h / vb.height);
				pm = translateAffine(pm, -(vb.x ?? 0), -(vb.y ?? 0));
			}
			const inPath = pm === m ? within : [...within, { ctm: m }];
			const [l, t, r, b] = path.getBounds();
			const bounds: Bounds = [l, t, r, b] as Bounds;
			if (c.fills?.length) add(bounds, pm, inPath);
			if (c.stroke) {
				const outline = c.strokeD ? bin.path(ck, c.strokeD) : null;
				if (outline) {
					const [ol, ot, or, ob] = outline.getBounds();
					add(strokeBounds([ol, ot, or, ob] as Bounds, c.stroke), pm, inPath);
				} else if (strokeInset(c.stroke) !== 0) {
					const stroke = { ...c.stroke, width: c.stroke.width * 2 };
					add(strokeBounds(bounds, stroke), pm, [...inPath, { ctm: pm }]);
				} else add(strokeBounds(bounds, c.stroke), pm, inPath);
			}
			return true;
		}
		if (c.op === "drawImage") {
			const img = images.get(c.src);
			if (img && isSvgPicture(img)) return false;
			// drawImage clips inside its own save.
			const inImage = c.clip ? [...within, { ctm: m }] : within;
			if (!img || c.fit === "tile") {
				add(box, m, inImage);
			} else {
				const r = fitRect(img.width(), img.height(), x, y, w, h, c.fit, c);
				if (r.dw > 0 && r.dh > 0)
					add(
						[r.dx, r.dy, r.dx + r.dw, r.dy + r.dh].map(f32) as Bounds,
						m,
						inImage,
					);
			}
			if (c.stroke)
				addStroke(c.clip ?? { kind: "rect" }, c.stroke, x, y, w, h, m, within);
			return true;
		}
		if (c.op === "drawBitmap") {
			if (!(c.pixelWidth > 0 && c.pixelHeight > 0)) return true;
			const snapped =
				c.role === "barcode" ? snapBarcodeAffine(m, c, frame.grid ?? 1) : null;
			// drawBitmap's save is real once it clips or moves the matrix.
			const inBitmap = c.clip || snapped ? [...within, { ctm: m }] : within;
			if (snapped) {
				const inverse = invertAffine(m);
				if (!inverse) return false;
				add(
					[
						snapped.x,
						snapped.y,
						snapped.x + snapped.width,
						snapped.y + snapped.height,
					].map(f32) as Bounds,
					concatAffine(m, inverse),
					inBitmap,
				);
			} else if (w > 0 && h > 0) add(box, m, inBitmap);
			return true;
		}
		if (c.op === "drawQr") {
			if ((c.margin ?? 0) < 0) return false;
			add(box, m, within);
			return true;
		}
		if (c.op === "drawGroup") {
			for (const child of c.children) if (!visit(child, m, within)) return false;
			return true;
		}
		if (c.op === "drawMasked") {
			// The content layer, then the mask composited into it. DstIn changes
			// transparent black, so that layer covers the whole cull; DstOut keeps
			// the content's own bounds.
			if (!c.invert) {
				full = true;
				return true;
			}
			const content = [...within, { ctm: m }];
			for (const child of c.children)
				if (!visit(child, m, content)) return false;
			return visit(c.mask, m, [...content, { ctm: m }]);
		}
		return false;
	};
	const ctm = [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]]
		.map(f32) as Affine;
	if (!visit(inner, ctm, []) || singular) return null;
	if (full) return cull;
	return out ?? [0, 0, 0, 0];
}

// The local rects a drawText's glyphs and decorations can cover: the span of
// each line's shaped glyph origins padded by the font box of every family it
// may draw from. SkTextBlob bounds a positioned run by that box, so this holds
// the recorded bounds even when letter or word spacing moves glyphs past the
// line's advance. Lines drawText culls against the clip are skipped here too.
// Null when a family's box is unknown.
function textBounds(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	bin: Bin,
	cmd: DrawTextCommand,
	ctm: Affine,
	device: Size | null,
): Bounds[] | null {
	const fallback = (provider as { __families?: string[] }).__families ?? [];
	const families = new Set(fallback);
	for (const line of cmd.layout.lines)
		for (const span of line.spans) families.add(span.font.family);
	let em: Bounds | null = null;
	for (const family of families) {
		const box = familyBox(ck, provider, family);
		if (box === null) return null;
		if (box) em = em ? unionBounds(em, box) : box;
	}
	if (cmd.arc)
		return em
			? arcTextBounds(ck, provider, bin, cmd, cmd.arc, fallback, em)
			: [];
	const rows =
		device && ctm[1] === 0 && ctm[3] === 0 && ctm[4] > 0
			? {
					top: -ctm[5] / ctm[4],
					bottom: (Math.ceil(device.height) - ctm[5]) / ctm[4],
				}
			: null;
	const cache = shapedLines.get(provider);
	const out: Bounds[] = [];
	for (const line of cmd.layout.lines) {
		const first = line.spans[0];
		if (!first) continue;
		const baseline = line.baseline ?? line.y;
		const size = Math.max(...line.spans.map((s) => s.font.size));
		if (rows) {
			const reach = 2 * size;
			if (baseline + reach < rows.top || baseline - reach > rows.bottom)
				continue;
		}
		for (const span of line.spans) {
			if (!span.font.decoration) continue;
			const { top, thickness } = decorationLine(
				span.font.size,
				span.font.decoration,
				baseline,
			);
			out.push([span.x, top, span.x + span.width, top + thickness]);
		}
		if (!em) continue;
		const shape = () =>
			shapeLine(ck, provider, cmd, line, fallback, null, null);
		let shaped: ShapedLine;
		if (cache)
			shaped = cachedLine(cache, lineKey(line, cmd.color, fallback), shape);
		else {
			shaped = shape();
			bin.track(shaped.para);
		}
		const left =
			line.direction === "rtl"
				? Math.min(...line.spans.map((s) => s.x))
				: first.x;
		// Glyph runs carry no fake-italic flag, so any italic span may be synthetic.
		const italic = line.spans.some((s) => s.font.style === "italic");
		let x0 = Number.POSITIVE_INFINITY;
		let x1 = Number.NEGATIVE_INFINITY;
		for (const run of shaped.para.getShapedLines()[0]?.runs ?? []) {
			const skew = italic
				? FAKE_ITALIC_SKEW * Math.max(-em[1], em[3], 0) * run.size
				: 0;
			const pos = run.positions as Float32Array;
			for (let i = 0; i < pos.length; i += 2) {
				const x = pos[i] as number;
				x0 = Math.min(x0, x + Math.min(0, em[0]) * run.size - skew);
				x1 = Math.max(x1, x + Math.max(0, em[2]) * run.size + skew);
			}
		}
		if (!(x0 <= x1)) x0 = x1 = 0;
		const slack = size / 8;
		out.push([
			left + x0 - slack,
			baseline + Math.min(0, em[1]) * size - slack,
			left + x1 + slack,
			baseline + Math.max(0, em[3]) * size + slack,
		]);
	}
	return out;
}

const familyBoxes = new WeakMap<
	TypefaceFontProvider,
	Map<string, Bounds | null | undefined>
>();

// A family's font box per unit of size, over every face registered for it:
// the box SkFontPriv::GetFontBounds scales. Undefined for a family the
// provider lacks, null when a face reports no box (a variable font).
function familyBox(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	family: string,
): Bounds | null | undefined {
	let byFamily = familyBoxes.get(provider);
	if (!byFamily) {
		byFamily = new Map();
		familyBoxes.set(provider, byFamily);
	}
	if (byFamily.has(family)) return byFamily.get(family);
	let box: Bounds | null | undefined;
	for (const slant of [ck.FontSlant.Upright, ck.FontSlant.Italic]) {
		for (let weight = 100; weight <= 900; weight += 100) {
			const typeface = provider.matchFamilyStyle(family, {
				weight: ck.FontWeight[WEIGHTS[weight]],
				width: ck.FontWidth.Normal,
				slant,
			});
			if (!typeface) continue;
			const font = new ck.Font(typeface, FONT_BOX_SIZE);
			const b = font.getMetrics().bounds;
			font.delete();
			typeface.delete();
			if (!b) {
				box = null;
				break;
			}
			const face: Bounds = [
				b[0] / FONT_BOX_SIZE,
				b[1] / FONT_BOX_SIZE,
				b[2] / FONT_BOX_SIZE,
				b[3] / FONT_BOX_SIZE,
			];
			box = box ? unionBounds(box, face) : face;
		}
		if (box === null) break;
	}
	byFamily.set(family, box);
	return box;
}

// SkFont's synthetic oblique.
const FAKE_ITALIC_SKEW = 1 / 4;

// SkTypeface::getBounds measures at this size.
const FONT_BOX_SIZE = 2048;

// snapBarcode under the affine `m`.
function snapBarcodeAffine(
	m: Affine,
	cmd: DrawBitmapCommand,
	grid: number,
): { x: number; y: number; width: number; height: number } | null {
	return snapBarcode(
		{ getTotalMatrix: () => [m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1] },
		cmd,
		grid,
	);
}

// Whether paintDrawable gives this drawable a layer: an isolated group, or one
// layerPaint builds a paint for.
function hasLayerPaint(cmd: DrawCommand): boolean {
	return (
		isolates(cmd) ||
		(!!cmd.blendMode && cmd.blendMode !== "normal") ||
		(cmd.opacity !== undefined && cmd.opacity < 1) ||
		(typeof cmd.blur === "number" && cmd.blur > 0) ||
		!!cmd.shadow ||
		(!!cmd.adjust?.colorMatrix && !shaderSideMatrix(cmd.adjust))
	);
}

// The layer paint's image filter grown as Skia's computeFastBounds grows it,
// or null for a paint that is not modelled.
function layerGrow(cmd: DrawCommand): ((b: Bounds) => Bounds) | null {
	if (cmd.blendMode === "linear-burn") return null;
	const list = shadowList(cmd.shadow);
	if (list.some((s) => s.inset)) return null;
	const blur =
		typeof cmd.blur === "number" && cmd.blur > 0
			? f32(3 * f32(LAYER_BLUR_SIGMA(cmd.blur)))
			: 0;
	return (b) => {
		const src = blur ? outsetBounds(b, blur) : b;
		let out = src;
		for (const s of list) {
			const spread = f32(s.spread ?? 0);
			const base = spread ? outsetBounds(src, spread) : src;
			const sigma = f32(3 * f32(SHADOW_SIGMA(s.blur)));
			const blurred = sigma > 0 ? outsetBounds(base, sigma) : base;
			const dx = f32(s.dx);
			const dy = f32(s.dy);
			out = unionBounds(out, [
				f32(blurred[0] + dx),
				f32(blurred[1] + dy),
				f32(blurred[2] + dx),
				f32(blurred[3] + dy),
			]);
		}
		return out;
	};
}

// SkColorFilter::affectsTransparentBlack for a matrix filter: whether
// transparent black comes out as a nonzero 8-bit color.
function matrixTouchesTransparent(m: number[]): boolean {
	for (let row = 0; row < 4; row++) {
		const v = m[row * 5 + 4] ?? 0;
		if (Math.floor((v < 0 ? 0 : v > 1 ? 1 : v) * 255 + 0.5) !== 0) return true;
	}
	return false;
}

// SkPaint::computeFastBounds for strokePaint's paint.
function strokeBounds(b: Bounds, stroke: Stroke): Bounds {
	const width = f32(stroke.width);
	if (width < 0) return b;
	let radius = 1;
	if (width > 0) {
		let multiplier = 1;
		if ((stroke.join ?? "miter") === "miter") multiplier = 4;
		if (stroke.cap === "square") multiplier = Math.max(multiplier, f32(Math.SQRT2));
		radius = f32((width / 2) * multiplier);
	}
	return outsetBounds(b, radius);
}

function sortBounds(b: Bounds): Bounds {
	return [
		Math.min(b[0], b[2]),
		Math.min(b[1], b[3]),
		Math.max(b[0], b[2]),
		Math.max(b[1], b[3]),
	];
}

function outsetBounds(b: Bounds, d: number): Bounds {
	return [f32(b[0] - d), f32(b[1] - d), f32(b[2] + d), f32(b[3] + d)];
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
	const l = Math.max(a[0], b[0]);
	const t = Math.max(a[1], b[1]);
	const r = Math.min(a[2], b[2]);
	const btm = Math.min(a[3], b[3]);
	return l < r && t < btm ? [l, t, r, btm] : null;
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
	return [
		Math.min(a[0], b[0]),
		Math.min(a[1], b[1]),
		Math.max(a[2], b[2]),
		Math.max(a[3], b[3]),
	];
}

// SkMatrix's type mask: 0 identity, 1 translate, 2 scale, 3 affine.
function affineKind(m: Affine): number {
	if (m[1] !== 0 || m[3] !== 0) return 3;
	if (m[0] !== 1 || m[4] !== 1) return 2;
	return m[2] !== 0 || m[5] !== 0 ? 1 : 0;
}

// SkMatrix::mapRect.
function mapAffine(m: Affine, b: Bounds): Bounds {
	const kind = affineKind(m);
	if (kind <= 1)
		return sortBounds([f32(b[0] + m[2]), f32(b[1] + m[5]), f32(b[2] + m[2]), f32(b[3] + m[5])]);
	if (kind === 2)
		return sortBounds([
			f32(f32(b[0] * m[0]) + m[2]),
			f32(f32(b[1] * m[4]) + m[5]),
			f32(f32(b[2] * m[0]) + m[2]),
			f32(f32(b[3] * m[4]) + m[5]),
		]);
	const xs: number[] = [];
	const ys: number[] = [];
	for (const [x, y] of [
		[b[0], b[1]],
		[b[2], b[1]],
		[b[2], b[3]],
		[b[0], b[3]],
	] as const) {
		xs.push(f32(f32(f32(x * m[0]) + f32(y * m[1])) + m[2]));
		ys.push(f32(f32(f32(x * m[3]) + f32(y * m[4])) + m[5]));
	}
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// SkMatrix::invert.
function invertAffine(m: Affine): Affine | null {
	const kind = affineKind(m);
	if (kind === 0) return m;
	if (kind === 1) return [1, 0, -m[2], 0, 1, -m[5]];
	if (kind === 2) {
		const ix = f32(1 / m[0]);
		const iy = f32(1 / m[4]);
		if (!Number.isFinite(ix) || !Number.isFinite(iy)) return null;
		return [ix, 0, f32(-m[2] * ix), 0, iy, f32(-m[5] * iy)];
	}
	const det = m[0] * m[4] - m[1] * m[3];
	if (Math.abs(f32(det)) <= (1 / 4096) ** 3) return null;
	const inv = 1 / det;
	return [
		f32(m[4] * inv),
		f32(-m[1] * inv),
		f32((m[1] * m[5] - m[4] * m[2]) * inv),
		f32(-m[3] * inv),
		f32(m[0] * inv),
		f32((m[3] * m[2] - m[0] * m[5]) * inv),
	];
}

// SkMatrix::setConcat(a, b), so b applies first.
function concatAffine(a: Affine, b: Affine): Affine {
	const ka = affineKind(a);
	const kb = affineKind(b);
	if (ka === 0) return b;
	if (kb === 0) return a;
	if (ka <= 2 && kb <= 2)
		return [
			f32(a[0] * b[0]),
			0,
			f32(f32(a[0] * b[2]) + a[2]),
			0,
			f32(a[4] * b[4]),
			f32(f32(a[4] * b[5]) + a[5]),
		];
	const mam = (p: number, q: number, r: number, t: number) => f32(p * q + r * t);
	return [
		mam(a[0], b[0], a[1], b[3]),
		mam(a[0], b[1], a[1], b[4]),
		f32(mam(a[0], b[2], a[1], b[5]) + a[2]),
		mam(a[3], b[0], a[4], b[3]),
		mam(a[3], b[1], a[4], b[4]),
		f32(mam(a[3], b[2], a[4], b[5]) + a[5]),
	];
}

// SkMatrix::preTranslate.
function translateAffine(m: Affine, dx: number, dy: number): Affine {
	const x = f32(dx);
	const y = f32(dy);
	if (x === 0 && y === 0) return m;
	if (affineKind(m) <= 1) return [m[0], m[1], f32(m[2] + x), m[3], m[4], f32(m[5] + y)];
	return [
		m[0],
		m[1],
		f32(m[2] + f32(f32(m[0] * x) + f32(m[1] * y))),
		m[3],
		m[4],
		f32(m[5] + f32(f32(m[3] * x) + f32(m[4] * y))),
	];
}

// SkMatrix::preScale.
function scaleAffine(m: Affine, sx: number, sy: number): Affine {
	const x = f32(sx);
	const y = f32(sy);
	if (x === 1 && y === 1) return m;
	return [f32(m[0] * x), f32(m[1] * y), m[2], f32(m[3] * x), f32(m[4] * y), m[5]];
}

// SkMatrix::setRotate about the origin.
function rotationAffine(degrees: number): Affine {
	const rad = f32(f32(degrees) * f32(f32(Math.PI) / 180));
	const snap = (v: number) => {
		const s = f32(v);
		return Math.abs(s) <= 1 / 4096 ? 0 : s;
	};
	const sin = snap(Math.sin(rad));
	const cos = snap(Math.cos(rad));
	return [cos, -sin, 0, sin, cos, 0];
}

// Skia's bounds of a recording of the inner drawable under the main canvas's
// matrix, for content predictedBounds does not model.
function recordedBounds(
	ck: CanvasKit,
	provider: TypefaceFontProvider,
	images: Map<string, Image | SvgPicture>,
	bin: Bin,
	inner: DrawCommand,
	frame: Frame,
	device: Size,
	matrix: number[],
	reach = 0,
): Bounds {
	const recorder = new ck.PictureRecorder();
	let picture: SkPicture | null = null;
	try {
		const rc = recorder.beginRecording(
			ck.LTRBRect(-reach, -reach, device.width + reach, device.height + reach),
			true,
		);
		measuring.add(rc);
		rc.concat(matrix);
		const scratch: PaintIssues = {
			unhandled: [],
			missingImages: [],
			adjustUnsupported: new Map(),
		};
		paintDrawable(ck, rc, provider, images, bin, inner, scratch, frame);
		picture = recorder.finishRecordingAsPicture();
		const [l, t, r, b] = picture.cullRect();
		return [l, t, r, b];
	} finally {
		picture?.delete();
		recorder.delete();
	}
}

// Test hook: sees every adjusted layer's predicted bounds beside the ones a
// recording reports.
let boundsAudit:
	| ((predicted: Bounds | null, recorded: Bounds) => void)
	| undefined;

export function auditAdjustedBounds(
	audit: ((predicted: Bounds | null, recorded: Bounds) => void) | undefined,
): void {
	boundsAudit = audit;
}

// The device pixels an adjusted layer's content can touch: Skia's bounds of a
// recording of the inner drawable under the main canvas's matrix, so stroke and
// glyph outsets count exactly as the painter draws them. Predicted from the
// commands where possible, recorded otherwise. Rounded out with 1px spare for
// antialiasing, plus `spread` for a kernel that reads neighbours, then cut to
// the device clip (grown by `spread`, so a kernel at the clip edge still reads
// the real pixels beyond it) and the frame. `reach` grows both cuts by how far
// the layer's shadows and blur carry content into view. Null when nothing shows.
function adjustedDeviceRect(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	images: Map<string, Image | SvgPicture>,
	bin: Bin,
	inner: DrawCommand,
	frame: Frame,
	device: Size,
	matrix: number[],
	spread: number,
	reach: number,
): { x: number; y: number; width: number; height: number } | null {
	const predicted = predictedBounds(
		ck,
		provider,
		bin,
		images,
		inner,
		frame,
		device,
		matrix,
		reach > 0,
	);
	const recorded = () =>
		recordedBounds(
			ck,
			provider,
			images,
			bin,
			inner,
			frame,
			device,
			matrix,
			reach,
		);
	boundsAudit?.(predicted, recorded());
	const [l, t, r, b] = predicted ?? recorded();
	const clip = canvas.getDeviceClipBounds();
	const pad = 1 + spread;
	const grow = spread + reach;
	const x0 = Math.max(Math.floor(l) - pad, clip[0] - grow, -reach);
	const y0 = Math.max(Math.floor(t) - pad, clip[1] - grow, -reach);
	const x1 = Math.min(Math.ceil(r) + pad, clip[2] + grow, device.width + reach);
	const y1 = Math.min(Math.ceil(b) + pad, clip[3] + grow, device.height + reach);
	if (!(x1 > x0 && y1 > y0)) return null;
	return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// Apply an adjust's LUTs/sharpen via an offscreen SkSL pass: render the
// drawable's content and clip (with only its color matrix) to an offscreen
// surface covering just its device rect, then draw it back through the adjust
// shader inside a layer carrying the drawable's shadows, blur, opacity and
// blend. The color matrix rides the inner render, so ordering is matrix → curve
// → cube → sharpen, and the shadows are cast from the adjusted result in their
// own color, as layerPaint orders them. The offscreen inherits the main canvas's
// full CTM, shifted by the rect's whole-pixel origin, and is composited back in
// device coordinates, so an adjusted descendant follows every parent transform
// exactly once. Falls back to a matrix-only render (+ an adjust_unsupported
// warning) if the surface or effect can't be created.
function paintAdjustedOffscreen(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	images: Map<string, Image | SvgPicture>,
	bin: Bin,
	cmd: DrawCommand,
	issues: PaintIssues,
	frame: Frame,
) {
	const adjust = cmd.adjust as NonNullable<DrawCommand["adjust"]>;
	if (measuring.has(canvas)) {
		const geometry = {
			...cmd,
			adjust: adjust.colorMatrix
				? { colorMatrix: adjust.colorMatrix }
				: undefined,
		} as DrawCommand;
		paintDrawable(ck, canvas, provider, images, bin, geometry, issues, frame);
		return;
	}
	const hasLut = !!adjust.lut;
	const hasLut3d = !!adjust.lut3d;
	const amount = adjust.sharpen ?? 0;
	const hasSharpen = amount > 0;
	// "preserve-hue" pulls the matrix into this pass; otherwise it rides the inner
	// render as a color filter, as before.
	const matrixInShader = shaderSideMatrix(adjust);
	if (adjust.gamut === "preserve-hue" && !matrixInShader) {
		reportAdjustUnsupported(issues, cmd, "gamut");
	}
	// The inner drawable: content, rotation and clip, with only the (cheap) color
	// matrix of the adjust. lut/sharpen are this pass's job, and the layer effects
	// come after it.
	const inner: DrawCommand = {
		...layerContent(cmd),
		...(cmd.rotation ? { rotation: cmd.rotation } : {}),
		...(adjust.colorMatrix && !matrixInShader
			? { adjust: { colorMatrix: adjust.colorMatrix } }
			: {}),
	} as DrawCommand;
	const effects = { ...cmd, adjust: undefined } as DrawCommand;
	const matrixOnly = {
		...cmd,
		adjust: adjust.colorMatrix ? { colorMatrix: adjust.colorMatrix } : undefined,
	} as DrawCommand;
	if (hasLut3d && !validLut3d(adjust.lut3d)) {
		reportAdjustUnsupported(issues, cmd, "lut3d");
		paintDrawable(ck, canvas, provider, images, bin, matrixOnly, issues, frame);
		return;
	}

	// The offscreen is in SURFACE pixels, not design units: at a 2× export the
	// layer must be rendered at 2× too, or it would be blitted back upscaled from
	// half-resolution pixels. The inner render draws in design units under the same
	// scaled matrix the main canvas carries. Only the layer's own device rect is
	// allocated, so N adjusted photos hold N photo-sized surfaces, not N frames.
	const device = exportPixelSize(frame, frame.scale);
	const matrix = canvas.getTotalMatrix();
	const reach = Math.ceil(layerReach(effects) * matrixStretch(matrix));
	const rect = adjustedDeviceRect(
		ck,
		canvas,
		provider,
		images,
		bin,
		inner,
		frame,
		device,
		matrix,
		hasSharpen ? 1 : 0,
		reach,
	);
	if (!rect) return;
	const surface = makeLayerSurface(
		ck,
		canvas,
		rect.width,
		rect.height,
		frame.precision,
	);
	const effect = surface
		? adjustEffect(
				ck,
				matrixInShader,
				matrixInShader,
				hasLut,
				hasLut3d,
				hasSharpen,
			)
		: null;
	if (!surface || !effect) {
		// Couldn't build the offscreen path — render matrix-only and flag what was
		// dropped rather than pretending it applied. The matrix goes back on the
		// color filter, so a "preserve-hue" layer still paints, clipped.
		if (hasLut) reportAdjustUnsupported(issues, cmd, "lut");
		if (hasLut3d) reportAdjustUnsupported(issues, cmd, "lut3d");
		if (hasSharpen) reportAdjustUnsupported(issues, cmd, "sharpen");
		if (matrixInShader) reportAdjustUnsupported(issues, cmd, "gamut");
		surface?.delete();
		paintDrawable(ck, canvas, provider, images, bin, matrixOnly, issues, frame);
		return;
	}

	const off = surface.getCanvas();
	off.clear(ck.TRANSPARENT);
	// The main canvas may already carry an export scale and arbitrary ancestor
	// transforms. Render the inner layer through that exact local→device matrix,
	// moved by the rect's whole-pixel origin, so each snapshot texel is the device
	// pixel it would be on the main surface.
	off.translate(-rect.x, -rect.y);
	off.concat(matrix);
	paintDrawable(ck, off, provider, images, bin, inner, issues, frame);
	// The snapshot is copy-on-write off this surface, and the shader samples it when
	// the MAIN surface flushes (later, on the GPU path) — so keep the offscreen alive
	// until bin.free() runs (after that flush), disposing (not delete()ing, which
	// would leak the pixel buffer) it then.
	const img = bin.track(surface.makeImageSnapshot());
	bin.track({ delete: () => surface.dispose() });

	const srcSh = bin.track(
		img.makeShaderOptions(
			ck.TileMode.Clamp,
			ck.TileMode.Clamp,
			ck.FilterMode.Nearest,
			ck.MipmapMode.None,
			ck.Matrix.translated(rect.x, rect.y),
		),
	);
	const children: Shader[] = [srcSh];
	if (hasLut) {
		const lutImg = lutImage(ck, bin, adjust.lut) as Image;
		children.push(
			bin.track(
				lutImg.makeShaderOptions(
					ck.TileMode.Clamp,
					ck.TileMode.Clamp,
					ck.FilterMode.Nearest,
					ck.MipmapMode.None,
				),
			),
		);
	}
	if (hasLut3d) {
		const cubeImg = lut3dImage(ck, bin, adjust.lut3d) as Image;
		children.push(
			bin.track(
				cubeImg.makeShaderOptions(
					ck.TileMode.Clamp,
					ck.TileMode.Clamp,
					ck.FilterMode.Nearest,
					ck.MipmapMode.None,
				),
			),
		);
	}
	// Uniforms go in declaration order (see adjustShaderSksl): the three matrix rows
	// as float4(r, g, b, bias), then cube size, then the sharpen amount.
	const uniforms: number[] = [];
	if (matrixInShader) {
		const m = adjust.colorMatrix as number[];
		uniforms.push(m[0], m[1], m[2], m[4]);
		uniforms.push(m[5], m[6], m[7], m[9]);
		uniforms.push(m[10], m[11], m[12], m[14]);
	}
	if (hasLut3d) uniforms.push(adjust.lut3d?.size ?? 0);
	if (hasSharpen) uniforms.push(amount);
	const shader = bin.track(effect.makeShaderWithChildren(uniforms, children));
	const paint = bin.track(new ck.Paint());
	paint.setShader(shader);
	// The layer opens under the drawable's own rotated matrix, so its filters
	// work in local units exactly as paintDrawable's would. Inside it, blit in
	// DEVICE pixels: undo the complete CTM, not merely the export scale. The
	// snapshot already includes parent rotations/transforms; a second application
	// here would move it. The main clip remains in device space, so clipping
	// semantics are unchanged.
	canvas.save();
	if (cmd.rotation) {
		const cx = cmd.pos.x + cmd.size.width / 2;
		const cy = cmd.pos.y + cmd.size.height / 2;
		canvas.translate(cx, cy);
		canvas.rotate(cmd.rotation, 0, 0);
		canvas.translate(-cx, -cy);
	}
	const local = canvas.getTotalMatrix();
	const inverse = ck.Matrix.invert(local);
	if (!inverse) throw new Error("adjust: non-invertible canvas transform");
	const lp = layerPaint(ck, bin, effects, frame.precision);
	if (lp) {
		const back = layerPaintBoundable(effects)
			? invertAffine(local.slice(0, 6).map(f32) as Affine)
			: null;
		const affine = local[6] === 0 && local[7] === 0 && local[8] === 1;
		const bounds =
			back && affine
				? mapAffine(back, [
						rect.x,
						rect.y,
						rect.x + rect.width,
						rect.y + rect.height,
					])
				: null;
		canvas.saveLayer(lp, bounds ? ck.LTRBRect(...bounds) : null);
	}
	canvas.concat(inverse);
	canvas.drawRect(
		ck.XYWHRect(rect.x, rect.y, rect.width, rect.height),
		paint,
	);
	if (lp) canvas.restore();
	canvas.restore();
}

// How far, in local units, a layer's blur and shadows can carry its content.
function layerReach(cmd: DrawCommand): number {
	const blur =
		typeof cmd.blur === "number" && cmd.blur > 0
			? 3 * LAYER_BLUR_SIGMA(cmd.blur)
			: 0;
	let shadows = 0;
	for (const s of shadowList(cmd.shadow))
		shadows = Math.max(
			shadows,
			Math.abs(s.dx) +
				Math.abs(s.dy) +
				Math.abs(s.spread ?? 0) +
				3 * SHADOW_SIGMA(s.blur),
		);
	return blur + shadows;
}

// The most a matrix lengthens a unit vector, bounded above by its row sums.
function matrixStretch(m: number[]): number {
	return Math.max(
		Math.abs(m[0]) + Math.abs(m[1]),
		Math.abs(m[3]) + Math.abs(m[4]),
	);
}

// Collapse the supersampled render into the output surface, so each output pixel
// carries the coverage of the supersample² samples under it — an edge that a
// same-size render can only approximate (two abutting shapes each blending their
// own coverage against the background, never summing back to the solid they
// tile) comes out with the coverage it actually had.
//
// Done as a chain of exact 2:1 halvings, NOT one resample down to the output
// size, because only at 2:1 does every sample reach the average. A bilinear tap
// halving an axis lands exactly on the boundary between two source pixels, so a
// step is precisely a 2×2 box average; a cubic filter run straight from 4× to 1×
// keeps its narrow support and reads a fraction of the samples instead —
// measurably no better than 2× — and mipmapped trilinear (drawImageRectHQ's
// choice below 0.5) samples between pyramid levels rather than the render.
//
// Every level is kept alive in `bin` until the OUTPUT surface flushes: on the GPU
// path the draws only sample them then. Surfaces are disposed rather than
// delete()d, which would strand their pixel buffers.
function reduceSupersampled(
	ck: CanvasKit,
	out: Surface,
	src: Surface,
	bin: Bin,
	design: Size,
	exportScale: number,
	supersample: number,
	precision: Precision,
) {
	const rect = (s: Size) => ck.XYWHRect(0, 0, s.width, s.height);
	const retire = (s: Surface) => bin.track({ delete: () => s.dispose() });

	let level = src;
	let levelSize = exportPixelSize(design, exportScale * supersample);
	retire(src);

	if (supersample === 1) {
		const canvas = out.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		canvas.drawImage(
			bin.track(src.makeImageSnapshot()),
			0,
			0,
			bin.track(new ck.Paint()),
		);
		return;
	}

	for (let factor = supersample; factor > 1; factor /= 2) {
		const target = exportPixelSize(design, (exportScale * factor) / 2);
		const last = factor === 2;
		const dst = last
			? out
			: makeLayerSurface(
					ck,
					level.getCanvas(),
					target.width,
					target.height,
					precision,
				);
		const img = bin.track(level.makeImageSnapshot());
		const paint = bin.track(new ck.Paint());
		if (!dst) {
			// An intermediate the backend wouldn't give: finish what is left in one
			// cubic step rather than leaving the output blank. Softer than the halving
			// chain, still sharper than no supersampling.
			const canvas = out.getCanvas();
			canvas.clear(ck.TRANSPARENT);
			const final = exportPixelSize(design, exportScale);
			canvas.drawImageRectCubic(
				img,
				rect(levelSize),
				rect(final),
				MITCHELL,
				MITCHELL,
				paint,
			);
			return;
		}
		const canvas = dst.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		canvas.drawImageRectOptions(
			img,
			rect(levelSize),
			rect(target),
			ck.FilterMode.Linear,
			ck.MipmapMode.None,
			paint,
		);
		if (!last) retire(dst);
		level = dst;
		levelSize = target;
	}
}

// The dither noise of the finishing pass. It depends only on the pixel
// position, the seed and the mode.
const FINISH_HASH_SKSL = `uniform float ditherSeed;
	uniform float monochromeDither;
	half hash(float2 p){
		p += float2(ditherSeed * 0.1031, ditherSeed * 0.11369);
		return half(fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0);
	}
	half3 hash3(float2 p){
		return half3(hash(p + float2(19.19, 7.13)),
		             hash(p + float2(43.31, 31.71)),
		             hash(p + float2(67.67, 59.59)));
	}`;

// SkSL for the whole-frame finishing pass. Order mirrors the classic output
// pipeline: dither first (break banding), then black-extract, then white-clamp.
// Colors are unpremultiplied for the threshold tests and re-premultiplied out.
// Disabled ops are signalled by a sentinel threshold of -1 (dither 0).
const finishSksl = (curve: boolean) => `uniform shader src;
	${curve ? "uniform shader curve;" : ""}
	uniform float whiteT;
	uniform float blackT;
	uniform float dither;
	${FINISH_HASH_SKSL}
	half4 main(float2 xy){
		half4 s = src.eval(xy);
		half a = s.a;
		half3 c = a > 0.0 ? s.rgb/a : s.rgb;
		${
			curve
				? `c = half3(
			curve.eval(float2(c.r*255.0+0.5, 0.5)).r,
			curve.eval(float2(c.g*255.0+0.5, 0.5)).g,
			curve.eval(float2(c.b*255.0+0.5, 0.5)).b);`
				: ""
		}
		if (dither > 0.0) {
			half n = hash(xy);
			half3 noise = monochromeDither > 0.5 ? half3(n) : hash3(xy);
			c = clamp(c + noise * dither, 0.0, 1.0);
		}
		if (blackT >= 0.0 && c.r < blackT && c.g < blackT && c.b < blackT) c = half3(0.0);
		if (whiteT >= 0.0 && c.r > whiteT && c.g > whiteT && c.b > whiteT) c = half3(1.0);
		return half4(c*a, a);
	}`;

// The noise the finish shader adds, unscaled, for finishOnCpu to read back.
const FINISH_NOISE_SKSL = `${FINISH_HASH_SKSL}
	half4 main(float2 xy){
		half n = hash(xy);
		return half4(monochromeDither > 0.5 ? half3(n) : hash3(xy), 1.0);
	}`;

function finishEffect(
	ck: CanvasKit,
	variant: "finish" | "finish-curve" | "finish-noise",
): RuntimeEffect | null {
	return cachedEffect(ck, variant, () =>
		ck.RuntimeEffect.Make(
			variant === "finish-noise"
				? FINISH_NOISE_SKSL
				: finishSksl(variant === "finish-curve"),
		),
	);
}

function normalizeDither(dither: FrameFinish["dither"]) {
	if (typeof dither === "number") {
		return { amount: dither, seed: 0, monochrome: false };
	}
	const amount = dither?.amount ?? 0;
	const rawSeed = dither?.seed ?? 0;
	// RuntimeEffect uniforms are floats: bound the integer so every admissible seed
	// remains distinguishable in float precision and non-finite input is harmless.
	const seed = Number.isFinite(rawSeed) ? Math.trunc(rawSeed) % 1_000_000 : 0;
	return { amount, seed, monochrome: dither?.mode === "monochrome" };
}

type FinishUniforms = {
	curve?: AdjustLut;
	whiteT: number;
	blackT: number;
	dither: number;
	seed: number;
	monochrome: boolean;
};

// Thresholds normalized to [0,1]; -1 disables. Dither gets an amplitude, stable
// seed, and a scalar-vs-per-channel mode flag.
// The comparisons are integer strict >/< on 8-bit values (matching a 0–255
// pipeline), so the cutoff sits half a level past the threshold — robust to the
// float round-trip and exact at the boundary (a pixel == threshold stays put).
function finishUniforms(finish: FrameFinish): FinishUniforms {
	const ditherConfig = normalizeDither(finish.dither);
	return {
		...(finish.curve ? { curve: finish.curve } : {}),
		whiteT:
			finish.whiteClamp !== undefined ? (finish.whiteClamp + 0.5) / 255 : -1,
		blackT:
			finish.blackExtract !== undefined
				? (finish.blackExtract - 0.5) / 255
				: -1,
		dither: ditherConfig.amount > 0 ? ditherConfig.amount / 255 : 0,
		seed: ditherConfig.seed,
		monochrome: ditherConfig.monochrome,
	};
}

// Run the finishing pass on the composited surface. In memory it runs on the
// CPU when it can (see finishOnCpu); otherwise it snapshots the surface, clears
// it, then redraws the snapshot through the finish shader. A no-op finish never
// reaches here (compileScene only emits the command when something is set).
function applyFrameFinish(
	ck: CanvasKit,
	surface: Surface,
	bin: Bin,
	finish: FrameFinish,
	// The surface's own pixel size — this pass reads and rewrites the composited
	// pixels, so it works in device pixels whatever density the scene exported at.
	device: Size,
	cache: PaintCacheState | null,
) {
	const u = finishUniforms(finish);
	const effect = finishEffect(ck, u.curve ? "finish-curve" : "finish");
	if (!effect) return; // rt_effect unavailable — leave the frame as-is.
	if (
		cpuFinish &&
		!surface.reportBackendTypeIsGPU() &&
		finishOnCpu(ck, surface, bin, u, cache)
	)
		return;
	const snap = bin.track(surface.makeImageSnapshot());
	const canvas = surface.getCanvas();
	canvas.clear(ck.TRANSPARENT);
	const srcSh = bin.track(
		snap.makeShaderOptions(
			ck.TileMode.Clamp,
			ck.TileMode.Clamp,
			ck.FilterMode.Nearest,
			ck.MipmapMode.None,
		),
	);
	const children = [srcSh];
	if (u.curve) {
		const curve = lutImage(ck, bin, u.curve);
		if (!curve) return; // the table couldn't be uploaded; leave the frame as-is.
		children.push(
			bin.track(
				curve.makeShaderOptions(
					ck.TileMode.Clamp,
					ck.TileMode.Clamp,
					ck.FilterMode.Nearest,
					ck.MipmapMode.None,
				),
			),
		);
	}
	const shader = bin.track(
		effect.makeShaderWithChildren(
			[u.whiteT, u.blackT, u.dither, u.seed, u.monochrome ? 1 : 0],
			children,
		),
	);
	const paint = bin.track(new ck.Paint());
	paint.setShader(shader);
	canvas.drawRect(ck.XYWHRect(0, 0, device.width, device.height), paint);
}

const UNIT = f32(1 / 255);

// Test hook: run every finish through the shader.
let cpuFinish = true;

export function setCpuFinish(enabled: boolean): void {
	cpuFinish = enabled;
}

// The finish shader in float32 on the surface's own pixels, byte for byte what the
// shader writes in software, which runs runtime effects slowly. Exact only
// where alpha is 255 (unpremultiplying rounds otherwise), so a frame with any
// translucent pixel answers false and takes the shader. So does a dithered
// frame without a cache to keep its noise, which costs about what the shader
// does to render.
function finishOnCpu(
	ck: CanvasKit,
	surface: Surface,
	bin: Bin,
	u: FinishUniforms,
	cache: PaintCacheState | null,
): boolean {
	const info = surface.imageInfo();
	if (info.colorType !== ck.ColorType.RGBA_8888) return false;
	if (u.dither > 0 && !cache) return false;
	const canvas = surface.getCanvas();
	const px = canvas.readPixels(0, 0, info) as Uint8Array | null;
	if (!px) return false;
	for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) return false;
	let noise: Float32Array | null = null;
	if (u.dither > 0) {
		noise = cache && finishNoise(ck, surface, bin, cache, u);
		if (!noise) return false;
	}
	if (u.curve) {
		const { r, g, b } = u.curve;
		for (let i = 0; i < px.length; i += 4) {
			px[i] = r[px[i]];
			px[i + 1] = g[px[i + 1]];
			px[i + 2] = b[px[i + 2]];
		}
	}
	const unit = new Float32Array(256);
	for (let b = 0; b < 256; b++) unit[b] = f32(b * UNIT);
	const whiteT = f32(u.whiteT);
	const blackT = f32(u.blackT);
	if (noise) {
		const d = f32(u.dither);
		const step = u.monochrome ? 0 : 1;
		const toByte = (c: number) => Math.floor(f32(f32(c * 255) + 0.5));
		const dithered = (b: number, n: number) =>
			Math.min(Math.max(f32(unit[b] + f32(n * d)), 0), 1);
		for (let i = 0, j = 0; i < px.length; i += 4, j += 1 + 2 * step) {
			let r = dithered(px[i], noise[j]);
			let g = dithered(px[i + 1], noise[j + step]);
			let b = dithered(px[i + 2], noise[j + 2 * step]);
			if (blackT >= 0 && r < blackT && g < blackT && b < blackT) r = g = b = 0;
			if (whiteT >= 0 && r > whiteT && g > whiteT && b > whiteT) r = g = b = 1;
			px[i] = toByte(r);
			px[i + 1] = toByte(g);
			px[i + 2] = toByte(b);
		}
	} else {
		// Undithered, a byte that passes both thresholds comes back as itself.
		const black = new Uint8Array(256);
		const white = new Uint8Array(256);
		for (let b = 0; b < 256; b++) {
			black[b] = blackT >= 0 && unit[b] < blackT ? 1 : 0;
			white[b] = whiteT >= 0 && unit[b] > whiteT ? 1 : 0;
		}
		for (let i = 0; i < px.length; i += 4) {
			const r = px[i];
			const g = px[i + 1];
			const b = px[i + 2];
			if (black[r] && black[g] && black[b]) px[i] = px[i + 1] = px[i + 2] = 0;
			else if (white[r] && white[g] && white[b])
				px[i] = px[i + 1] = px[i + 2] = 255;
		}
	}
	return canvas.writePixels(
		px,
		info.width,
		info.height,
		0,
		0,
		info.alphaType,
		info.colorType,
		info.colorSpace,
	);
}

// The unscaled noise the finish shader would add at each pixel of `surface`, one
// value per pixel in monochrome and three otherwise, rendered by the same hash
// into a float surface and kept on the cache.
function finishNoise(
	ck: CanvasKit,
	surface: Surface,
	bin: Bin,
	cache: PaintCacheState,
	u: FinishUniforms,
): Float32Array | null {
	const info = surface.imageInfo();
	const key = `${info.width}x${info.height}:${u.seed}:${u.monochrome ? "mono" : "rgb"}`;
	if (cache.finishNoise?.key === key) return cache.finishNoise.noise;
	const effect = finishEffect(ck, "finish-noise");
	if (!effect) return null;
	const target = surface
		.getCanvas()
		.makeSurface(imageInfo(ck, "float", info.width, info.height));
	if (!target) return null;
	bin.track({ delete: () => target.dispose() });
	const shader = bin.track(effect.makeShader([u.seed, u.monochrome ? 1 : 0]));
	const paint = bin.track(new ck.Paint());
	paint.setShader(shader);
	const canvas = target.getCanvas();
	canvas.drawRect(ck.XYWHRect(0, 0, info.width, info.height), paint);
	// CanvasKit sizes its own F32 result in bytes rather than floats, so read
	// into a buffer of the right length instead.
	const size = info.width * info.height * 4;
	const dest = ck.Malloc(Float32Array, size);
	try {
		if (!canvas.readPixels(0, 0, target.imageInfo(), dest)) return null;
		const rgba = dest.toTypedArray() as Float32Array;
		const channels = u.monochrome ? 1 : 3;
		const noise = new Float32Array(info.width * info.height * channels);
		for (let i = 0, j = 0; i < size; i += 4)
			for (let k = 0; k < channels; k++) noise[j++] = rgba[i + k] as number;
		cacheFinishNoise(cache, { key, noise });
		return noise;
	} finally {
		ck.Free(dest);
	}
}

// Skia's name for each layer blend mode. Figma's linear dodge is Skia's Plus.
const SKIA_BLEND_MODE: Record<BlendMode, EnumKey<BlendModeEnumValues>> = {
	normal: "SrcOver",
	multiply: "Multiply",
	screen: "Screen",
	overlay: "Overlay",
	darken: "Darken",
	lighten: "Lighten",
	"color-dodge": "ColorDodge",
	"color-burn": "ColorBurn",
	"hard-light": "HardLight",
	"soft-light": "SoftLight",
	difference: "Difference",
	exclusion: "Exclusion",
	hue: "Hue",
	saturation: "Saturation",
	color: "Color",
	luminosity: "Luminosity",
	plus: "Plus",
	"linear-burn": "SrcOver",
};

// Linear burn, max(0, s + d - 1), in the separable-blend form on premultiplied
// color. Skia has no native mode for it.
const LINEAR_BURN_SKSL = `
	half4 main(half4 src, half4 dst) {
		half3 burn = max(src.rgb * dst.a + dst.rgb * src.a - src.a * dst.a, 0.0);
		return half4(
			src.rgb * (1.0 - dst.a) + dst.rgb * (1.0 - src.a) + burn,
			src.a + dst.a * (1.0 - src.a));
	}`;

function linearBurnBlender(ck: CanvasKit, bin: Bin): Blender | null {
	const eff = cachedEffect(ck, "linear-burn", () =>
		ck.RuntimeEffect.MakeForBlender?.(LINEAR_BURN_SKSL),
	);
	return eff ? bin.track(eff.makeBlender([])) : null;
}

// Test hook: paint every layer unbounded.
let boundLayers = true;

export function setLayerBounds(enabled: boolean): void {
	boundLayers = enabled;
}

// Conservative local bounds for a layer holding `inner`, so it is allocated and
// filtered over its content rather than the whole surface. Skia grows them for
// the layer paint's image filter itself. Padded by a device pixel. Null leaves
// the layer unbounded: content that is not modelled or not originInvariant, a
// matrix that is not a positive scale and translate, or a recording canvas.
function layerBounds(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	images: Map<string, Image | SvgPicture>,
	bin: Bin,
	inner: DrawCommand,
	frame: Frame,
): Rect | null {
	if (!boundLayers || measuring.has(canvas)) return null;
	const matrix = canvas.getTotalMatrix() as number[];
	if (matrix[1] !== 0 || matrix[3] !== 0) return null;
	if (!(matrix[0] > 0 && matrix[4] > 0)) return null;
	const ctm = matrix.slice(0, 6) as Affine;
	if (!originInvariant(inner, ctm)) return null;
	const device = exportPixelSize(frame, frame.scale);
	const b = predictedBounds(
		ck,
		provider,
		bin,
		images,
		inner,
		frame,
		device,
		matrix,
		true,
	);
	if (!b || !b.every(Number.isFinite)) return null;
	const inverse = invertAffine(ctm);
	if (!inverse) return null;
	const [l, t, r, btm] = mapAffine(inverse, [
		b[0] - 1,
		b[1] - 1,
		b[2] + 1,
		b[3] + 1,
	]);
	return ck.LTRBRect(l, t, r, btm);
}

function isolates(cmd: DrawCommand): boolean {
	return cmd.op === "drawGroup" && cmd.isolate === true;
}

// Whether a layer paint keeps the destination wherever its layer is transparent,
// so bounding the layer cannot change what lands outside it.
function layerPaintBoundable(cmd: DrawCommand): boolean {
	const cm = cmd.adjust?.colorMatrix;
	if (cm && !shaderSideMatrix(cmd.adjust) && matrixTouchesTransparent(cm))
		return false;
	return !shadowList(cmd.shadow).some((s) => s.inset);
}

// Whether `cmd` paints the same in a layer at another whole-pixel origin. Skia
// maps geometry through the layer's translation in float, so clips, paths,
// rotations, gradients and sampled images can shift by an edge pixel or a whole
// column. Rounded corners are accepted: their antialiased edge pixels can move
// by up to 1/8 coverage (32 levels), which a blur or shadow carries to nearby
// pixels. layer-bounds.test.ts holds them to that. `m` is the layer's scale and
// translate.
function originInvariant(cmd: DrawCommand, m: Affine): boolean {
	if (cmd.rotation || cmd.clip || needsShaderAdjust(cmd)) return false;
	if (shadowList(cmd.shadow).some((s) => s.inset)) return false;
	if (cmd.op === "drawRect")
		return (
			!outlineIsPath(rectShape(cmd.cornerRadius, cmd.cornerSmoothing)) &&
			(cmd.fills ?? []).every((f) => f.kind === "solid")
		);
	if (cmd.op === "drawText")
		return !cmd.arc && (!cmd.fill || cmd.fill.kind === "solid");
	if (cmd.op === "drawGroup")
		return cmd.children.every((c) => originInvariant(c, m));
	if (cmd.op === "drawBitmap") return nearestEdgesClear(cmd, m);
	return cmd.op === "drawQr";
}

// Whether every pixel edge of a nearest-sampled bitmap lands clear of device
// pixel centers, so float error in the layer's translation cannot flip a column.
function nearestEdgesClear(cmd: DrawBitmapCommand, m: Affine): boolean {
	if (cmd.role === "barcode") return false;
	const x = m[0] * cmd.pos.x + m[2];
	const y = m[4] * cmd.pos.y + m[5];
	const w = m[0] * cmd.size.width;
	const h = m[4] * cmd.size.height;
	const clear = (start: number, extent: number, n: number) => {
		for (let i = 0; i <= n; i++) {
			const edge = start + (extent * i) / n;
			if (Math.abs(edge - Math.floor(edge) - 0.5) < 1 / 256) return false;
		}
		return true;
	};
	return clear(x, w, cmd.pixelWidth) && clear(y, h, cmd.pixelHeight);
}

function setLayerBlend(
	ck: CanvasKit,
	bin: Bin,
	paint: Paint,
	blendMode: BlendMode | undefined,
) {
	if (!blendMode || blendMode === "normal") return;
	const blender =
		blendMode === "linear-burn" ? linearBurnBlender(ck, bin) : null;
	if (blender) paint.setBlender(blender);
	else
		paint.setBlendMode(
			ck.BlendMode[SKIA_BLEND_MODE[blendMode]] ?? ck.BlendMode.SrcOver,
		);
}

// A layer paint carrying opacity + blend + blur/shadow + adjust, so the element
// composites onto everything below it exactly like a Figma layer. The effects
// run in the order README.md's "Layer effect order" gives: the color matrix is
// the first image filter rather than the paint's color filter, which Skia would
// apply after the shadows and after the paint's alpha. Skia evaluates image
// filters in 8 bits, so under F16 a matrix with nothing to order against stays
// on the paint, where the result is the same at full precision.
function layerPaint(
	ck: CanvasKit,
	bin: Bin,
	cmd: DrawCommand,
	precision: Precision = "u8",
): Paint | null {
	const { blendMode, opacity, blur, shadow } = cmd;
	const hasBlend = blendMode && blendMode !== "normal";
	const hasOpacity = opacity !== undefined && opacity < 1;
	const hasBlur = typeof blur === "number" && blur > 0;
	const colorFilter = adjustColorFilter(ck, bin, cmd);
	if (!hasBlend && !hasOpacity && !hasBlur && !shadow && !colorFilter)
		return null;
	const paint = bin.track(new ck.Paint());
	if (hasOpacity) paint.setAlphaf(opacity);
	setLayerBlend(ck, bin, paint, blendMode);
	const onPaint =
		precision === "f16" && !hasOpacity && !hasBlur && !shadow;
	if (colorFilter && onPaint) paint.setColorFilter(colorFilter);
	let filter: ImageFilter | null =
		colorFilter && !onPaint
			? bin.track(ck.ImageFilter.MakeColorFilter(colorFilter, null))
			: null;
	if (typeof blur === "number" && blur > 0)
		filter = bin.track(
			ck.ImageFilter.MakeBlur(
				LAYER_BLUR_SIGMA(blur),
				LAYER_BLUR_SIGMA(blur),
				ck.TileMode.Decal,
				filter,
			),
		);
	const sh = shadowFilter(ck, bin, shadow);
	if (sh)
		filter = filter ? bin.track(ck.ImageFilter.MakeCompose(sh, filter)) : sh;
	if (filter) paint.setImageFilter(filter);
	return paint;
}

// Grow (or shrink) the silhouette a shadow is cast from. Figma's spread, and the
// third length of a CSS box-shadow.
function spreadSource(
	ck: CanvasKit,
	bin: Bin,
	spread: number,
	input: ImageFilter | null,
): ImageFilter | null {
	if (!spread) return input;
	const r = Math.abs(spread);
	return bin.track(
		spread > 0
			? ck.ImageFilter.MakeDilate(r, r, input)
			: ck.ImageFilter.MakeErode(r, r, input),
	);
}

// A colour filter that replaces every pixel with `color` at the INVERSE of the
// source's alpha: opaque where the drawable is empty, empty where it is solid.
// That inverted silhouette, offset and blurred, is what an inner shadow casts —
// the shape's own edges lighting inward.
function invertedSilhouette(
	ck: CanvasKit,
	bin: Bin,
	color: string,
): ImageFilter {
	const [r, g, b, a] = toColor(ck, color);
	// Skia colour matrix, row-major RGBA rows with a bias column: constant colour,
	// alpha = a·(1 − srcAlpha).
	const cf = bin.track(
		ck.ColorFilter.MakeMatrix([
			0,
			0,
			0,
			0,
			r,
			0,
			0,
			0,
			0,
			g,
			0,
			0,
			0,
			0,
			b,
			0,
			0,
			0,
			-a,
			a,
		]),
	);
	return bin.track(ck.ImageFilter.MakeColorFilter(cf, null));
}

// A drawable's visible shadows.
function shadowList(shadow: DrawCommand["shadow"]) {
	return (Array.isArray(shadow) ? shadow : shadow ? [shadow] : []).filter(
		(s) => s.color !== "transparent",
	);
}

// The image filter for a drawable's whole shadow stack, or null when it has
// none. A `null` input anywhere in the graph is the layer's own contents.
//
// Every shadow is cast from the ORIGINAL silhouette, not from the result of the
// one below it — stacking MakeDropShadow would blur each shadow into the next.
// So each is built on its own and blended: drop shadows under the contents,
// inner shadows over them, each list painted bottom-up.
function shadowFilter(
	ck: CanvasKit,
	bin: Bin,
	shadow: DrawCommand["shadow"],
): ImageFilter | null {
	const list = shadowList(shadow);
	if (list.length === 0) return null;

	let under: ImageFilter | null = null;
	let over: ImageFilter | null = null;
	for (const s of list) {
		const sigma = SHADOW_SIGMA(s.blur);
		if (s.inset) {
			// Offset + blur the inverted silhouette, then keep only the part that
			// lands on the drawable — an inner shadow never spills outside it.
			let f: ImageFilter | null = invertedSilhouette(ck, bin, s.color);
			f = spreadSource(ck, bin, s.spread ?? 0, f);
			if (s.dx || s.dy) f = bin.track(ck.ImageFilter.MakeOffset(s.dx, s.dy, f));
			if (sigma > 0)
				f = bin.track(
					ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Decal, f),
				);
			const clipped = bin.track(
				ck.ImageFilter.MakeBlend(ck.BlendMode.SrcIn, null, f),
			);
			over = over
				? bin.track(
						ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, over, clipped),
					)
				: clipped;
			continue;
		}
		const cast = bin.track(
			ck.ImageFilter.MakeDropShadowOnly(
				s.dx,
				s.dy,
				sigma,
				sigma,
				toColor(ck, s.color),
				spreadSource(ck, bin, s.spread ?? 0, null),
			),
		);
		under = under
			? bin.track(ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, under, cast))
			: cast;
	}

	// contents over the cast shadows, then the inner ones over that.
	let out: ImageFilter | null = under
		? bin.track(ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, under, null))
		: null;
	if (over)
		out = bin.track(ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, out, over));
	return out;
}

// What paintDrawable draws inside the layer: the drawable without its layer
// paint, its rotation already on the canvas.
function layerContent(cmd: DrawCommand): DrawCommand {
	const {
		rotation: _r,
		opacity: _o,
		blendMode: _b,
		blur: _l,
		backdropBlur: _bb,
		backdropClip: _bc,
		shadow: _s,
		adjust: _a,
		...rest
	} = cmd;
	if (rest.op === "drawGroup") {
		const { isolate: _i, ...group } = rest;
		return group as DrawCommand;
	}
	return rest as DrawCommand;
}

function hasBackdrop(cmd: DrawCommand): boolean {
	return typeof cmd.backdropBlur === "number" && cmd.backdropBlur > 0;
}

function withoutBackdrop(cmd: DrawCommand): DrawCommand {
	const { backdropBlur: _bb, backdropClip: _bc, ...rest } = cmd;
	return rest as DrawCommand;
}

// Replaces what the canvas holds beneath the drawable's shape with its blur,
// under the drawable's rotation and at its opacity.
function paintBackdrop(
	ck: CanvasKit,
	canvas: Canvas,
	bin: Bin,
	cmd: DrawCommand,
) {
	const sigma = LAYER_BLUR_SIGMA(cmd.backdropBlur as number);
	canvas.save();
	if (cmd.rotation) {
		const cx = cmd.pos.x + cmd.size.width / 2;
		const cy = cmd.pos.y + cmd.size.height / 2;
		canvas.translate(cx, cy);
		canvas.rotate(cmd.rotation, 0, 0);
		canvas.translate(-cx, -cy);
	}
	if (cmd.op === "drawPath") {
		const path = bin.path(ck, cmd.d, cmd.fillRule === "evenodd");
		if (path) {
			const vb = cmd.viewBox;
			let m = ck.Matrix.translated(cmd.pos.x, cmd.pos.y);
			if (vb && vb.width > 0 && vb.height > 0)
				m = ck.Matrix.multiply(
					m,
					ck.Matrix.scaled(
						cmd.size.width / vb.width,
						cmd.size.height / vb.height,
					),
					ck.Matrix.translated(-(vb.x ?? 0), -(vb.y ?? 0)),
				);
			const back = ck.Matrix.invert(m);
			if (back) {
				canvas.concat(m);
				canvas.clipPath(path, ck.ClipOp.Intersect, true);
				canvas.concat(back);
			}
		}
	} else {
		const own =
			cmd.backdropClip ??
			(cmd.op === "drawRect"
				? rectShape(cmd.cornerRadius, cmd.cornerSmoothing)
				: { kind: "rect" as const });
		clipShape(ck, canvas, bin, own, cmd.pos, cmd.size);
	}
	if (cmd.clip) clipShape(ck, canvas, bin, cmd.clip, cmd.pos, cmd.size);
	let paint: Paint | undefined;
	if (cmd.opacity !== undefined && cmd.opacity < 1) {
		paint = bin.track(new ck.Paint());
		paint.setAlphaf(cmd.opacity);
	}
	const blur = bin.track(
		ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Clamp, null),
	);
	canvas.saveLayer(paint, null, blur, 0, ck.TileMode.Clamp);
	canvas.restore();
	canvas.restore();
}

function paintDrawable(
	ck: CanvasKit,
	canvas: Canvas,
	provider: TypefaceFontProvider,
	images: Map<string, Image | SvgPicture>,
	bin: Bin,
	cmd: DrawCommand,
	issues: PaintIssues,
	frame: Frame,
) {
	if (hasBackdrop(cmd)) {
		paintBackdrop(ck, canvas, bin, cmd);
		cmd = withoutBackdrop(cmd);
	}
	// lut/sharpen can't be a color filter — route the whole drawable through an
	// offscreen SkSL pass (which re-enters here with a matrix-only adjust).
	if (needsShaderAdjust(cmd)) {
		paintAdjustedOffscreen(
			ck,
			canvas,
			provider,
			images,
			bin,
			cmd,
			issues,
			frame,
		);
		return;
	}
	// Past the offscreen path with "preserve-hue" still asked for: the matrix has
	// alpha terms the shader can't carry, so it runs through the clipping color
	// filter below and the mode is reported dropped rather than silently ignored.
	if (cmd.adjust?.gamut === "preserve-hue" && cmd.adjust.colorMatrix) {
		reportAdjustUnsupported(issues, cmd, "gamut");
	}
	canvas.save();
	if (cmd.rotation) {
		const cx = cmd.pos.x + cmd.size.width / 2;
		const cy = cmd.pos.y + cmd.size.height / 2;
		canvas.translate(cx, cy);
		canvas.rotate(cmd.rotation, 0, 0);
		canvas.translate(-cx, -cy);
	}
	const lp = layerPaint(ck, bin, cmd, frame.precision);
	// drawImage clips/strokes itself so its stroke isn't clipped.
	const clips = !!cmd.clip && cmd.op !== "drawImage";
	// Inside the clip, so the clip antialiases the composited children once
	// rather than each child that overlaps a partly covered edge.
	const isolated = isolates(cmd);
	const inner = isolated && clips;
	const outer = lp !== null || (isolated && !inner);
	const bounds =
		(outer || inner) && layerPaintBoundable(cmd)
			? layerBounds(
					ck,
					canvas,
					provider,
					images,
					bin,
					layerContent(cmd),
					frame,
				)
			: null;
	if (outer) canvas.saveLayer(lp ?? undefined, bounds);
	if (clips && cmd.clip)
		clipShape(ck, canvas, bin, cmd.clip, cmd.pos, cmd.size);
	if (inner) canvas.saveLayer(undefined, bounds);
	drawShape(ck, canvas, provider, images, bin, cmd, issues, frame);
	if (inner) canvas.restore();
	if (outer) canvas.restore();
	canvas.restore();
}

// The leading drawables whose pixels depend on nothing but the command and the
// frame, each as a structural key. Text and images also depend on fonts and
// decoded bytes the key would not cover, so the run stops at the first one. A
// group that paints straight onto the canvas is entered, keying each child
// with the group around it. `complete` is whether every drawable was keyed.
function backgroundKeys(
	drawables: DrawCommand[],
	outer = "",
): { keys: string[]; complete: boolean } {
	const keys: string[] = [];
	for (const cmd of drawables) {
		if (selfContained(cmd)) {
			keys.push(outer + JSON.stringify(cmd));
			continue;
		}
		if (cmd.op === "drawGroup" && passThrough(cmd)) {
			const { children, ...group } = cmd;
			const inner = backgroundKeys(
				children,
				`${outer + JSON.stringify(group)}>`,
			);
			keys.push(...inner.keys);
			if (inner.complete) continue;
		}
		return { keys, complete: false };
	}
	return { keys, complete: true };
}

// The first `count` keyed drawables and the rest. A pass-through group cut
// between its children becomes two groups with the same props, which paint the
// same pixels as the one. Only what backgroundKeys keys is counted.
function splitBackground(
	drawables: DrawCommand[],
	count: number,
): { head: DrawCommand[]; tail: DrawCommand[]; taken: number } {
	let taken = 0;
	for (let i = 0; i < drawables.length; i++) {
		const cmd = drawables[i] as DrawCommand;
		const split = () => ({
			head: drawables.slice(0, i),
			tail: drawables.slice(i),
			taken,
		});
		if (taken === count) return split();
		if (selfContained(cmd)) {
			taken++;
			continue;
		}
		if (cmd.op !== "drawGroup" || !passThrough(cmd)) return split();
		const inner = splitBackground(cmd.children, count - taken);
		taken += inner.taken;
		if (inner.tail.length === 0) continue;
		const head = drawables.slice(0, i);
		if (inner.head.length) head.push({ ...cmd, children: inner.head });
		return {
			head,
			tail: [{ ...cmd, children: inner.tail }, ...drawables.slice(i + 1)],
			taken,
		};
	}
	return { head: drawables, tail: [], taken };
}

function selfContained(cmd: DrawCommand): boolean {
	if (cmd.op === "drawRect" || cmd.op === "drawPath") return true;
	if (cmd.op === "drawGroup") return cmd.children.every(selfContained);
	if (cmd.op === "drawMasked")
		return selfContained(cmd.mask) && cmd.children.every(selfContained);
	return false;
}

// A group with no layer of its own: its children paint onto the canvas under
// its transform and clip alone.
function passThrough(cmd: DrawCommand): boolean {
	return (
		!isolates(cmd) &&
		!hasBackdrop(cmd) &&
		!cmd.adjust &&
		!cmd.shadow &&
		!(cmd.blur && cmd.blur > 0) &&
		!(cmd.opacity !== undefined && cmd.opacity < 1) &&
		(!cmd.blendMode || cmd.blendMode === "normal")
	);
}

function writeBackground(
	canvas: Canvas,
	pixels: Uint8Array,
	info: ImageInfo,
): boolean {
	return canvas.writePixels(
		pixels,
		info.width,
		info.height,
		0,
		0,
		info.alphaType,
		info.colorType,
		info.colorSpace,
	);
}

// Collect the unique font requests + image srcs a scene's commands declare.
function collectAssets(commands: Command[]): {
	fonts: FontRequest[];
	images: string[];
} {
	const fonts = new Map<string, FontRequest>();
	const images = new Set<string>();
	for (const cmd of commands) {
		if (cmd.op === "loadFonts")
			for (const r of cmd.requests) fonts.set(r.family, r);
		if (cmd.op === "loadImages") for (const s of cmd.srcs) images.add(s);
	}
	return { fonts: [...fonts.values()], images: [...images] };
}

function warnSvgFeatures(
	warnings: PaintWarning[],
	src: string,
	img: Image | SvgPicture,
) {
	if (isSvgPicture(img))
		for (const feature of img.features)
			warnings.push({ kind: "svg_unsupported", src, feature });
}

// The CanvasKit paint routine env.paint runs (CanvasKit is the only backend, so
// there is no painter-strategy indirection): one compiled scene -> a live surface
// + a PaintOutput. freshcoat paints a single scene here — a card's multiple sides
// are coatfile's concern, which calls paint() once per side. The font provider
// + decoded images are built from the runtime's bytes and freed before returning;
// the surface is bound to rt.canvas when present (displayable) else offscreen, and
// returned live (the env disposes). encode/dispose defer to the caller/env. With
// rt.cache, all three are kept by the cache instead and reused by the next paint.
export async function paintScene(
	canvasKit: unknown,
	commands: Command[],
	rt: PaintRuntime,
): Promise<PaintOutput> {
	const ck = canvasKit as CanvasKit;
	const cache = rt.cache ? paintCacheState(rt.cache) : null;
	if (cache) cache.stats.paints++;
	const { fonts, images } = collectAssets(commands);
	const requested = new Set(images);
	const warnings: PaintWarning[] = [];

	const loaded: LoadedFontBytes[] = [];
	for (const req of fonts) {
		try {
			// CanvasKit has no native font system, so it always materializes bytes
			// (from the env's pre-supplied resolution or the shared fetch).
			for (const bytes of await fontBytes(rt.resolveFont(req)))
				loaded.push({ family: req.family, bytes });
		} catch (e) {
			warnings.push({
				kind: "font_load_failed",
				family: req.family,
				error: String(e),
			});
		}
	}
	const registered =
		cache && rt.fonts ? withEnvFonts(loaded, rt.fonts) : loaded;
	const provider = cache
		? cachedFontProvider(cache, registered, () =>
				makeFontProvider(ck, registered),
			)
		: makeFontProvider(ck, loaded);
	if (cache) shapedLines.set(provider, cache);

	const imageMap = new Map<string, Image | SvgPicture>();
	// Images the runtime lent through loadImage: painted, never freed here.
	const borrowed = new Set<string>();
	for (const src of images) {
		if (rt.loadImage) {
			try {
				const img = await rt.loadImage(src, ck);
				if (img) {
					imageMap.set(src, img as Image);
					borrowed.add(src);
				} else
					warnings.push({
						kind: "image_load_failed",
						src,
						error: "decode failed",
					});
			} catch (e) {
				warnings.push({ kind: "image_load_failed", src, error: String(e) });
			}
			continue;
		}
		const hit = cache?.images.get(src)?.image;
		if (hit) {
			imageMap.set(src, hit);
			warnSvgFeatures(warnings, src, hit);
			continue;
		}
		try {
			const bytes = await rt.loadImageBytes(src);
			if (cache) cache.stats.imageDecodes++;
			const img = isSvg(bytes)
				? makeSvgPicture(ck, provider, bytes, await loadSvg())
				: ck.MakeImageFromEncoded(bytes);
			if (img) {
				imageMap.set(src, img);
				cache?.images.set(src, { image: img, mipped: null });
				warnSvgFeatures(warnings, src, img);
			} else
				warnings.push({
					kind: "image_load_failed",
					src,
					error: "decode failed",
				});
		} catch (e) {
			warnings.push({
				kind: "image_load_failed",
				src,
				error: String(e),
			});
		}
	}

	const bin = makeBin(cache);
	const create = commands.find((c) => c.op === "createCanvas") as
		| {
				op: "createCanvas";
				width: number;
				height: number;
				scale?: number;
				supersample?: number;
				precision?: Precision;
		  }
		| undefined;
	if (!create) throw new Error("canvaskit: scene has no createCanvas command");
	const design = { width: create.width, height: create.height };
	const exportScale = create.scale ?? 1;
	// The size the caller asked for. Everything the outside world sees — the
	// returned canvas, the encoded PNG, the finish pass — is this size.
	const device = exportPixelSize(design, exportScale);
	const { surface, canvas, loseContext } = cache
		? cachedSurface(
				cache,
				{ width: device.width, height: device.height, hosted: !!rt.canvas },
				() => makeSurface(ck, rt, device.width, device.height),
			)
		: makeSurface(ck, rt, device.width, device.height);

	// Supersampling renders denser than the export and reduces (see
	// ./export-scale). Only the RENDER density belongs on `frame`: every pass that
	// steps outside the scaled matrix — the adjust offscreen, a layer blur — has to
	// size itself to the surface being drawn on, which is the render surface.
	const supersample = resolveSupersample(
		create.supersample,
		design,
		exportScale,
	);
	const renderScale = exportScale * supersample;
	const render = exportPixelSize(design, renderScale);
	const precision = resolvePrecision(create.precision);
	const frame: Frame = {
		...design,
		scale: renderScale,
		grid: supersample,
		precision,
	};

	// A working surface apart from the output, when the render is denser than
	// the export or deeper than 8 bits. Derived from the output surface rather
	// than ck.MakeSurface so it stays on the same backend (GPU under WebGL). A
	// backend that won't give one degrades to rendering straight into the output
	// at the export size and 8 bits: softer than asked for, but a render.
	const superSurface =
		supersample > 1 || precision !== "u8"
			? makeLayerSurface(
					ck,
					surface.getCanvas(),
					render.width,
					render.height,
					precision,
				)
			: null;
	if (!superSurface) {
		frame.scale = exportScale;
		frame.grid = 1;
		frame.precision = "u8";
	}
	// Where the drawables actually land: the supersampled offscreen when there is
	// one, else the output surface directly (the pre-supersampling path, untouched).
	const target = superSurface ?? surface;
	const skCanvas = target.getCanvas();
	skCanvas.clear(ck.TRANSPARENT);

	const drawables = commands.filter(
		(cmd): cmd is DrawCommand =>
			cmd.op !== "createCanvas" &&
			cmd.op !== "loadFonts" &&
			cmd.op !== "loadImages" &&
			cmd.op !== "finishFrame", // handled as a post-pass, after the loop
	);
	// An offscreen paint whose leading drawables match a cached background's
	// writes its pixels instead of drawing them. One that shares only part of
	// the closest one's run keeps the shared part in its place; one that shares
	// none keeps its own beside the others. Nothing is read back that the cache
	// could not keep.
	const pixelInfo =
		cache && !rt.canvas && frame.precision === "u8" ? target.imageInfo() : null;
	const bgFrame = pixelInfo
		? `${pixelInfo.width}x${pixelInfo.height}@${frame.scale}/${frame.grid}`
		: "";
	const lead = pixelInfo ? backgroundKeys(drawables).keys : [];
	const closest =
		cache && pixelInfo ? closestBackground(cache, bgFrame, lead) : null;
	const held = closest?.held ?? null;
	const shared = closest?.shared ?? 0;
	let skip = 0;
	if (
		cache &&
		pixelInfo &&
		held &&
		shared === held.keys.length &&
		writeBackground(skCanvas, held.pixels, pixelInfo)
	) {
		skip = shared;
		touchBackground(cache, held);
		warnings.push(...held.warnings);
	}
	const snapAt =
		skip ||
		!cache ||
		!pixelInfo ||
		!backgroundFits(cache, pixelInfo.width * pixelInfo.height)
			? 0
			: shared || lead.length;
	const { head, tail } = splitBackground(drawables, skip || snapAt);
	const run = skip ? tail : [...head, ...tail];
	const snapAfter = snapAt ? head.length : 0;
	const warningsBefore = warnings.length;

	try {
		// Scoped to the drawable loop: the finishing pass below reads back the
		// composited pixels and belongs in device space.
		if (frame.scale !== 1) {
			skCanvas.save();
			skCanvas.scale(frame.scale, frame.scale);
		}
		// The families this scene loaded, in order, are the per-glyph fallback
		// chain its text styles append (drawText → textStyleOf). Without listing
		// them in fontFamilies, CanvasKit renders any glyph the span's font lacks
		// (emoji, CJK, …) as tofu even though a covering font is registered. A
		// cached provider can hold more families than this scene uses, so the
		// chain is set per paint, right before drawing.
		(provider as { __families?: string[] }).__families = [
			...new Set(loaded.map((f) => f.family)),
		];
		for (let i = 0; i < run.length; i++) {
			const cmd = run[i] as DrawCommand;
			const issues: PaintIssues = {
				unhandled: [],
				missingImages: [],
				adjustUnsupported: new Map(),
			};
			paintDrawable(
				ck,
				skCanvas,
				provider,
				imageMap,
				bin,
				cmd,
				issues,
				frame,
			);
			for (const op of issues.unhandled)
				warnings.push({ kind: "unhandled_op", op });
			for (const warning of issues.adjustUnsupported.values())
				warnings.push({ kind: "adjust_unsupported", ...warning });
			// Only srcs the loader never even attempted: a src it tried and failed
			// already pushed its own image_load_failed above, with the real error.
			for (const src of issues.missingImages) {
				if (!requested.has(src)) {
					warnings.push({
						kind: "image_load_failed",
						src,
						error: "no image was loaded for this src",
					});
				}
			}
			if (cache && pixelInfo && i + 1 === snapAfter) {
				const pixels = skCanvas.readPixels(0, 0, pixelInfo) as Uint8Array | null;
				if (pixels)
					cacheBackground(
						cache,
						{
							keys: lead.slice(0, snapAt),
							frame: bgFrame,
							pixels,
							warnings: warnings.slice(warningsBefore),
						},
						shared ? held : null,
					);
			}
		}
		// Whole-frame finishing runs on the composited result, so after every
		// drawable and before the flush — and in device pixels, off the scaled
		// matrix the drawables used.
		if (frame.scale !== 1) skCanvas.restore();
		// The reduction comes BEFORE the finish: dither, black-extract and
		// white-clamp are output-resolution ops (see applyFrameFinish), and running
		// them on the dense render would average the dither back out and re-admit
		// values either threshold had just pushed off.
		if (superSurface)
			reduceSupersampled(
				ck,
				surface,
				superSurface,
				bin,
				design,
				exportScale,
				supersample,
				precision,
			);
		const finishCmd = commands.find((c) => c.op === "finishFrame") as
			| { op: "finishFrame"; finish: FrameFinish }
			| undefined;
		if (finishCmd)
			applyFrameFinish(ck, surface, bin, finishCmd.finish, device, cache);
		// Flush before freeing the provider/images below: on the WebGL path the GPU
		// still references the decoded images until the surface is flushed.
		surface.flush();
	} finally {
		if (cache) {
			evictUnusedImages(cache, images);
			evictUnusedLines(cache);
			evictUnusedPaths(cache);
			evictUnusedLutImages(cache.luts);
		} else {
			deleteFontProvider(provider);
			for (const [src, img] of imageMap)
				if (!borrowed.has(src)) img.delete();
		}
	}
	bin.free();

	return {
		canvas,
		warnings,
		// Raw RGBA at the device size, unpremultiplied — the surface's pixels with
		// no encoder in the way. Conformance compares backends here rather than on
		// encoded bytes, which would be comparing PNG writers.
		readPixels: () => {
			const snap = surface.makeImageSnapshot();
			try {
				const w = snap.width();
				const h = snap.height();
				const data = snap.readPixels(
					0,
					0,
					imageInfo(ck, "pixels", w, h),
				) as Uint8Array | null;
				return data ? { data, width: w, height: h } : null;
			} finally {
				snap.delete();
			}
		},
		encode: async (encodeOpts) => {
			// Skia's own PNG writer is ~25-40% larger than the same pixels through
			// ./png (it keeps an alpha channel an opaque frame doesn't need, and
			// filters rows that compress better unfiltered), so read the pixels back
			// and encode them here. makeImageSnapshot() returns a WASM-backed Image
			// that must be freed; readPixels copies out, so delete right after.
			const snap = surface.makeImageSnapshot();
			const skiaPng = () => ({
				bytes: snap.encodeToBytes() as Uint8Array,
				format: "png" as const,
			});
			try {
				// WebP is Skia's own encoder and there is no hand-rolled alternative
				// the way there is for PNG: lossy WebP is a codec, not a deflate with
				// choices to make. A build compiled without it answers null, and PNG
				// — which every build has — is what comes back instead, said so in
				// `format` rather than passed off as the WebP that was asked for.
				if (encodeOpts?.format === "webp") {
					const webp = snap.encodeToBytes(
						ck.ImageFormat.WEBP,
						encodeOpts.quality ?? DEFAULT_WEBP_QUALITY,
					) as Uint8Array | null;
					if (webp) return { bytes: webp, format: "webp" as const };
				}
				// JPEG is Skia's too, and falls back to PNG the same way.
				if (encodeOpts?.format === "jpeg") {
					const jpeg = encodeJpeg(
						ck,
						snap,
						encodeOpts.quality ?? DEFAULT_JPEG_QUALITY,
					);
					if (jpeg) return { bytes: jpeg, format: "jpeg" as const };
				}

				const w = snap.width();
				const h = snap.height();
				// Without a destination CanvasKit copies the frame out to the JS heap.
				// encodePng copies the rows before it awaits, so a heap growth that
				// detaches this view cannot reach it.
				const dest = ck.Malloc(Uint8Array, w * h * 4);
				try {
					const pixels = snap.readPixels(
						0,
						0,
						imageInfo(ck, "pixels", w, h),
						dest,
					) as Uint8Array | null;
					// A surface that won't read back (a lost context) still has Skia's
					// encoder, which works off the snapshot rather than a pixel buffer —
					// as does a runtime without CompressionStream. Bigger bytes beat no
					// bytes, so both fall back to it rather than failing the render.
					if (!pixels) return skiaPng();
					try {
						return {
							bytes: await encodePng(pixels, w, h, encodeOpts),
							format: "png" as const,
						};
					} catch {
						return skiaPng();
					}
				} finally {
					ck.Free(dest);
				}
			} finally {
				snap.delete();
			}
		},
		// Surface is freed with dispose(), not delete() — delete() leaves the
		// backing pixel buffer allocated (a ~w·h·4 leak per frame). On the WebGL
		// path this also drops the DOM canvas's GL context (releaseGL) so a full
		// release means dispose(); no consumer has to reach into result.canvas.
		// A cached surface is the cache's to free (clear/dispose), not the result's.
		dispose: cache
			? () => {}
			: () => {
					surface.dispose();
					loseContext();
				},
	};
}

// Bind to rt.canvas when present (WebGL, then SW) -> displayable; otherwise an
// offscreen raster surface. MakeWebGLCanvasSurface throws when the host canvas
// can't back WebGL (context creation fails, or MakeOnScreenGLSurface fails and its
// DOM-node swap throws on an OffscreenCanvas), so a failed WebGL attempt is caught
// on its own and still falls back to SW. A throw may leave a WebGL context on the
// element, which locks it out of the 2D context SW presents through, so SW gets a
// fresh element and the old one's context is released.
// `loseContext` drops the DOM canvas's WebGL context on dispose (see releaseGL); it
// is a no-op for the SW/offscreen paths, which hold no such context.
function makeSurface(
	ck: CanvasKit,
	rt: PaintRuntime,
	w: number,
	h: number,
): { surface: Surface; canvas: CanvasLike; loseContext: () => void } {
	const noop = () => {};
	const host = rt.canvas;
	if (host) {
		const create = (): CanvasLike | undefined => {
			try {
				return host.createCanvas(w, h);
			} catch {
				return undefined;
			}
		};
		// Typed for DOM canvases only; any canvas the host makes is accepted.
		const asTarget = (el: CanvasLike) => el as unknown as HTMLCanvasElement;
		let el = create();
		if (el) {
			const canvas = el;
			try {
				const gl = ck.MakeWebGLCanvasSurface(asTarget(canvas));
				if (gl)
					return { surface: gl, canvas, loseContext: () => releaseGL(canvas) };
			} catch {
				releaseGL(canvas);
				el = create();
			}
		}
		if (el) {
			try {
				const sw = ck.MakeSWCanvasSurface(asTarget(el));
				if (sw) return { surface: sw, canvas: el, loseContext: noop };
			} catch {}
		}
	}
	const surface = ck.MakeSurface(w, h) as Surface;
	return {
		surface,
		canvas: { width: w, height: h, getContext: () => null },
		loseContext: noop,
	};
}

// Free the WebGL context MakeWebGLCanvasSurface grabbed on this canvas so it stops
// counting against the browser's live-context cap (~16 in Chrome). surface.dispose()
// frees Skia's GPU resources but leaves the DOM canvas's context alive until GC —
// under repeated repaints that races the cap and the browser force-drops the oldest
// live context. getContext returns the SAME context Skia bound (a canvas is locked
// to one context type), so this loses exactly that one and never allocates a new one.
function releaseGL(canvas: CanvasLike): void {
	const c = canvas as unknown as {
		getContext?(id: string): {
			getExtension(name: string): { loseContext(): void } | null;
		} | null;
	};
	const gl = c.getContext?.("webgl2") ?? c.getContext?.("webgl");
	gl?.getExtension("WEBGL_lose_context")?.loseContext();
}

// The snapshot as a JPEG, flattened over white first because JPEG keeps no
// alpha. Reads the pixels back rather than drawing the snapshot onto a second
// surface, which works the same whether the frame is on the GPU or in memory.
// null when the pixels will not read back or the build has no JPEG encoder.
function encodeJpeg(
	ck: CanvasKit,
	snap: Image,
	quality: number,
): Uint8Array | null {
	const width = snap.width();
	const height = snap.height();
	const pixels = snap.readPixels(
		0,
		0,
		imageInfo(ck, "pixels", width, height),
	) as Uint8Array | null;
	if (!pixels) return null;
	const flat = makeImageFromPixels(
		ck,
		"opaque",
		width,
		height,
		flattenOverWhite(pixels),
	);
	if (!flat) return null;
	try {
		return (flat.encodeToBytes(ck.ImageFormat.JPEG, quality) ??
			null) as Uint8Array | null;
	} finally {
		flat.delete();
	}
}
