// CanvasKit (WASM Skia) render backend. Consumes the backend-agnostic Command
// IR (one scene's `Command[]` from compileScene) and paints via the full Skia
// API: Canvas/Paint/Shader for fills, ParagraphBuilder (HarfBuzz shaping →
// Figma-matching kerning) for text, the ImageFilter graph for blur/shadow, and
// drawImageRect/image shaders for images.
//
// The caller supplies an initialized CanvasKit instance (this module does not
// import `canvaskit-wasm`, so it stays runtime-agnostic), the font bytes, and
// any image bytes keyed by src. Text is drawn at the compile-baked baseline
// (`line.baseline`).
import { compileScene } from "./compile-scene";
import { exportPixelSize, resolveSupersample } from "./export-scale";
import { dataUrlToBytes, fontBytes } from "./font-bytes";
import {
	cachedFontProvider,
	cachedLine,
	cachedSurface,
	evictUnusedImages,
	evictUnusedLines,
	type PaintCacheState,
	paintCacheState,
	type ShapedLine,
} from "./paint-cache";
import {
	decorationLine,
	fitRect,
	fontFeatureList,
	fontVariationList,
	insetCorner,
	strokeInset,
} from "./paint-helpers";
import { flattenOverWhite } from "./jpeg";
import {
	DEFAULT_JPEG_QUALITY,
	DEFAULT_WEBP_QUALITY,
	encodePng,
} from "./png";
import { squircleSvg } from "./squircle";
import { isSvg, parseSvg, type SvgItem, svgToNode } from "./svg/index";
import type {
	BlendMode,
	CanvasLike,
	Command,
	CornerRadius,
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
} from "./types";

// The CanvasKit ambient API isn't typed here; the caller passes the instance.
// biome-ignore lint/suspicious/noExplicitAny: external WASM API, untyped
type CK = any;

type LoadedFontBytes = { family: string; bytes: Uint8Array };

// The scene box every drawable is positioned in: the DESIGN size (the units the
// commands carry) plus the export density the surface was allocated at. Only the
// passes that step outside the scaled canvas matrix — the adjust offscreen, the
// frame finish — need the scale; everything else draws in design units and lets
// the canvas matrix do the work.
// `grid` is how many device pixels make one output pixel: the supersample
// factor, 1 when the scene is drawn at its export size.
type Frame = { width: number; height: number; scale: number; grid?: number };

// Canvas2D shadowBlur ≈ 2·sigma. Figma's layer-blur value is ~2.27× the
// Gaussian sigma (bjango blur-radius comparison), so a value of N → sigma N/2.27.
const SHADOW_SIGMA = (blur: number) => blur / 2;
const LAYER_BLUR_SIGMA = (blur: number) => blur / 2.2727;

const WEIGHTS: Record<number, string> = {
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
	// LUT textures are immutable during a paint. Reusing an equal table keeps a
	// photo-heavy scene from allocating and uploading the same 256×1 texture for
	// every adjusted layer; `free` still owns every cached native image.
	lutImages: Map<string, CK>;
	// 3D cubes use a 2D atlas texture; cache them by value for the same reason as
	// the 1D curves above.
	lut3dImages: Map<string, CK>;
};
function makeBin(): Bin {
	const items: { delete(): void }[] = [];
	return {
		track: (o) => {
			if (o && typeof (o as { delete?: unknown }).delete === "function")
				items.push(o as unknown as { delete(): void });
			return o;
		},
		free: () => {
			for (const o of items) {
				try {
					o.delete();
				} catch {}
			}
		},
		lutImages: new Map(),
		lut3dImages: new Map(),
	};
}

function toColor(ck: CK, input: string) {
	const s = input.trim();
	// CanvasKit's parseColorString("transparent") wrongly returns opaque black,
	// which would fill e.g. a QR's transparent background solid black.
	if (s.toLowerCase() === "transparent") return ck.TRANSPARENT;
	if (s.startsWith("#")) {
		let h = s.slice(1);
		if (h.length === 3)
			h = h
				.split("")
				.map((c) => c + c)
				.join("");
		const r = parseInt(h.slice(0, 2), 16);
		const g = parseInt(h.slice(2, 4), 16);
		const b = parseInt(h.slice(4, 6), 16);
		const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
		return ck.Color(r, g, b, a);
	}
	const m = /rgba?\(([^)]+)\)/i.exec(s);
	if (m) {
		const [r, g, b, a] = m[1].split(",").map((v) => parseFloat(v.trim()));
		return ck.Color(r, g, b, a ?? 1);
	}
	// Named colors / hsl() etc. — CanvasKit parses these; fall back to black.
	try {
		const c = ck.parseColorString(s);
		if (c) return c;
	} catch {}
	return ck.BLACK;
}

function shaderFor(
	ck: CK,
	bin: Bin,
	fill: Exclude<ResolvedFill, { kind: "solid" }>,
	x: number,
	y: number,
	w: number,
	h: number,
): CK {
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
function makeFontProvider(ck: CK, fonts: LoadedFontBytes[]): CK {
	const provider = ck.TypefaceFontProvider.Make();
	for (const f of fonts) {
		const buf = f.bytes.buffer.slice(
			f.bytes.byteOffset,
			f.bytes.byteOffset + f.bytes.byteLength,
		);
		provider.registerFont(buf, f.family);
	}
	// Stash the registered families on the provider so text styles can append them
	// as a per-glyph fallback chain (drawText → textStyleOf). Without listing them
	// in fontFamilies, CanvasKit renders any glyph the span's font lacks (emoji,
	// CJK, …) as tofu even though a covering font is registered here.
	(provider as { __families?: string[] }).__families = [
		...new Set(fonts.map((f) => f.family)),
	];
	return provider;
}

const STROKE_CAP: Record<string, string> = {
	butt: "Butt",
	round: "Round",
	square: "Square",
};
const STROKE_JOIN: Record<string, string> = {
	miter: "Miter",
	round: "Round",
	bevel: "Bevel",
};

// Build a Skia RRect from a uniform or per-corner radius. CanvasKit's RRect is
// [l,t,r,b, ulX,ulY, urX,urY, lrX,lrY, llX,llY]; our CornerRadius is
// [topLeft, topRight, bottomRight, bottomLeft] = ul, ur, lr, ll.
function rrectFor(ck: CK, rect: CK, cr: CornerRadius): CK {
	if (typeof cr === "number") return ck.RRectXY(rect, cr, cr);
	const [tl, tr, br, bl] = cr;
	return Float32Array.of(
		rect[0],
		rect[1],
		rect[2],
		rect[3],
		tl,
		tl,
		tr,
		tr,
		br,
		br,
		bl,
		bl,
	);
}

function strokePaint(ck: CK, bin: Bin, stroke: Stroke): CK {
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

// SVG path string for a clip/stroke shape.
// This build of CanvasKit exposes no imperative Path builders — only
// Path.MakeFromSVGString — so we describe shapes as SVG.
function maskSvg(
	clip: ShapeMask,
	x: number,
	y: number,
	w: number,
	h: number,
): string {
	switch (clip.kind) {
		case "rect": {
			// Outset lets text fit:"clip" keep glyph overshoot whole (see ClipOutset).
			const top = clip.outset?.top ?? 0;
			const bottom = clip.outset?.bottom ?? 0;
			const y0 = y - top;
			const y1 = y + h + bottom;
			return `M ${x} ${y0} H ${x + w} V ${y1} H ${x} Z`;
		}
		case "rounded-rect": {
			if (Array.isArray(clip.radius))
				return perCornerRectSvg(clip.radius, x, y, w, h);
			const r = Math.min(clip.radius, Math.min(w, h) / 2);
			return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
		}
		case "circle": {
			const rr = Math.min(w, h) / 2;
			const cx = x + w / 2;
			const cy = y + h / 2;
			return `M ${cx - rr} ${cy} A ${rr} ${rr} 0 1 0 ${cx + rr} ${cy} A ${rr} ${rr} 0 1 0 ${cx - rr} ${cy} Z`;
		}
		case "ellipse": {
			const rx = w / 2;
			const ry = h / 2;
			const cy = y + h / 2;
			return `M ${x} ${cy} A ${rx} ${ry} 0 1 0 ${x + w} ${cy} A ${rx} ${ry} 0 1 0 ${x} ${cy} Z`;
		}
		case "polygon": {
			const cx = x + w / 2;
			const cy = y + h / 2;
			const rx = w / 2;
			const ry = h / 2;
			const rot = ((clip.rotation ?? 0) * Math.PI) / 180;
			let d = "";
			for (let i = 0; i < clip.sides; i++) {
				const a = -Math.PI / 2 + (i * 2 * Math.PI) / clip.sides + rot;
				d += `${i === 0 ? "M" : "L"} ${cx + rx * Math.cos(a)} ${cy + ry * Math.sin(a)} `;
			}
			return `${d}Z`;
		}
		case "squircle": {
			const max = Math.min(w, h) / 2;
			const r = Math.min(clip.radius, max);
			const p = Math.min(r * 1.5, max);
			const k = p * 0.4;
			return `M ${x + p} ${y} L ${x + w - p} ${y} C ${x + w - k} ${y} ${x + w} ${y + k} ${x + w} ${y + p} L ${x + w} ${y + h - p} C ${x + w} ${y + h - k} ${x + w - k} ${y + h} ${x + w - p} ${y + h} L ${x + p} ${y + h} C ${x + k} ${y + h} ${x} ${y + h - k} ${x} ${y + h - p} L ${x} ${y + p} C ${x} ${y + k} ${x + k} ${y} ${x + p} ${y} Z`;
		}
		default:
			return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
	}
}

// Radii that overflow a side scale down together, as Skia's RRect does.
function perCornerRectSvg(
	radius: [number, number, number, number],
	x: number,
	y: number,
	w: number,
	h: number,
): string {
	const [a, b, c, d] = radius.map((r) => Math.max(0, r));
	const k = Math.min(
		1,
		a + b > 0 ? w / (a + b) : 1,
		d + c > 0 ? w / (d + c) : 1,
		a + d > 0 ? h / (a + d) : 1,
		b + c > 0 ? h / (b + c) : 1,
	);
	const [tl, tr, br, bl] = [a * k, b * k, c * k, d * k];
	return `M ${x + tl} ${y} H ${x + w - tr} A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr} V ${y + h - br} A ${br} ${br} 0 0 1 ${x + w - br} ${y + h} H ${x + bl} A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl} V ${y + tl} A ${tl} ${tl} 0 0 1 ${x + tl} ${y} Z`;
}

// The mask shape an inside/outside stroke follows once the box is inset, or
// null when insetting the box is not an offset of the outline (a polygon).
function insetMask(clip: ShapeMask, inset: number): ShapeMask | null {
	switch (clip.kind) {
		case "rect":
			return clip.outset ? null : clip;
		case "rounded-rect":
			return { kind: "rounded-rect", radius: insetCorner(clip.radius, inset) };
		case "squircle":
			return { kind: "squircle", radius: Math.max(0, clip.radius - inset) };
		case "circle":
		case "ellipse":
			return clip;
		default:
			return null;
	}
}

// An inside/outside stroke along an arbitrary outline: twice the width,
// clipped to the path's interior (inside) or its exterior (outside). The
// path's fill type decides what the interior is.
function drawClippedStroke(
	ck: CK,
	canvas: CK,
	bin: Bin,
	path: CK,
	stroke: Stroke,
) {
	canvas.save();
	canvas.clipPath(
		path,
		stroke.align === "inside" ? ck.ClipOp.Intersect : ck.ClipOp.Difference,
		true,
	);
	canvas.drawPath(
		path,
		strokePaint(ck, bin, { ...stroke, width: stroke.width * 2 }),
	);
	canvas.restore();
}

function maskPath(
	ck: CK,
	bin: Bin,
	clip: ShapeMask,
	x: number,
	y: number,
	w: number,
	h: number,
): CK {
	return bin.track(ck.Path.MakeFromSVGString(maskSvg(clip, x, y, w, h)));
}

function textStyleOf(
	ck: CK,
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
		fontStyle: { weight: ck.FontWeight[weight] },
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
const shapedLines = new WeakMap<CK, PaintCacheState>();

function drawText(
	ck: CK,
	canvas: CK,
	provider: CK,
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
				)
			: null;
	let fgPaint: CK = null;
	let bgPaint: CK = null;
	if (fillShader) {
		fgPaint = bin.track(new ck.Paint());
		fgPaint.setAntiAlias(true);
		fgPaint.setShader(fillShader);
		bgPaint = bin.track(new ck.Paint());
		bgPaint.setColor(ck.TRANSPARENT);
	}
	const fallback = (provider as { __families?: string[] }).__families ?? [];
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
		const shape = (): ShapedLine => {
			const style = new ck.ParagraphStyle({
				textStyle: textStyleOf(ck, first, cmd, fallback, line.wordSpacing),
				...(line.direction === "rtl"
					? {
							textDirection: ck.TextDirection.RTL,
							textAlign: ck.TextAlign.Left,
						}
					: {}),
			});
			const builder = ck.ParagraphBuilder.MakeFromFontProvider(
				style,
				provider,
			);
			for (const span of line.spans) {
				const ts = ck.TextStyle(
					textStyleOf(ck, span, cmd, fallback, line.wordSpacing),
				);
				if (fgPaint) builder.pushPaintStyle(ts, fgPaint, bgPaint);
				else builder.pushStyle(ts);
				builder.addText(span.text);
				builder.pop();
			}
			const para = builder.build();
			builder.delete();
			para.layout(1e6); // single pre-wrapped line; no re-wrapping
			const lm = para.getLineMetrics();
			return { para, ascent: lm.length ? lm[0].ascent : 0 };
		};
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
	ck: CK,
	canvas: CK,
	bin: Bin,
	img: CK,
	src: CK,
	dest: CK,
	paint: CK,
	scale: number,
) {
	// Below this ratio, cubic sampling of the full-res image starts to alias;
	// mipmaps (each level pre-filtered) keep the shrink clean. Above it, cubic
	// is both sharper and cheaper (no mip pyramid to build).
	if (scale > 0 && scale < 0.5) {
		const mipped = bin.track(img.makeCopyWithDefaultMipmaps());
		canvas.drawImageRectOptions(
			mipped,
			src,
			dest,
			ck.FilterMode.Linear,
			ck.MipmapMode.Linear,
			paint,
		);
	} else {
		canvas.drawImageRectCubic(img, src, dest, MITCHELL, MITCHELL, paint);
	}
}

// A light-gray field + a centered photo glyph (frame + sun + mountains) for an unresolved image.
function drawImagePlaceholder(
	ck: CK,
	canvas: CK,
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
	// This CanvasKit build only exposes Path.MakeFromSVGString (see maskSvg), so
	// draw the sun as an SVG circle path rather than canvas.drawCircle.
	const sr = icon * 0.1;
	const scx = x + icon * 0.32;
	const scy = y + icon * 0.3;
	const sun = `M ${scx - sr} ${scy} A ${sr} ${sr} 0 1 0 ${scx + sr} ${scy} A ${sr} ${sr} 0 1 0 ${scx - sr} ${scy} Z`;
	canvas.drawPath(bin.track(ck.Path.MakeFromSVGString(sun)), fill);
	const mtn = `M ${x + icon * 0.08} ${y + icon * 0.85} L ${x + icon * 0.42} ${
		y + icon * 0.5
	} L ${x + icon * 0.62} ${y + icon * 0.68} L ${x + icon * 0.8} ${
		y + icon * 0.45
	} L ${x + icon * 0.92} ${y + icon * 0.85} Z`;
	canvas.drawPath(bin.track(ck.Path.MakeFromSVGString(mtn)), fill);
}

// The node's outline stroke, drawn along its mask (or its box when unmasked).
// Shared by the painted-image and placeholder paths so both get the same border.
function drawImageStroke(ck: CK, canvas: CK, bin: Bin, cmd: DrawImageCommand) {
	if (!cmd.stroke) return;
	const { pos, size } = cmd;
	const clip = cmd.clip ?? { kind: "rect" };
	const inset = strokeInset(cmd.stroke);
	const shape = inset === 0 ? clip : insetMask(clip, inset);
	if (!shape) {
		const path = maskPath(ck, bin, clip, pos.x, pos.y, size.width, size.height);
		drawClippedStroke(ck, canvas, bin, path, cmd.stroke);
		return;
	}
	const path = maskPath(
		ck,
		bin,
		shape,
		pos.x + inset,
		pos.y + inset,
		Math.max(0, size.width - 2 * inset),
		Math.max(0, size.height - 2 * inset),
	);
	canvas.drawPath(path, strokePaint(ck, bin, cmd.stroke));
}

function drawImage(
	ck: CK,
	canvas: CK,
	bin: Bin,
	images: Map<string, CK>,
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
		if (cmd.clip)
			canvas.clipPath(
				maskPath(ck, bin, cmd.clip, pos.x, pos.y, size.width, size.height),
				ck.ClipOp.Intersect,
				true,
			);
		drawImagePlaceholder(ck, canvas, bin, pos, size);
		canvas.restore();
		drawImageStroke(ck, canvas, bin, cmd);
		return;
	}
	canvas.save();
	if (cmd.clip)
		canvas.clipPath(
			maskPath(ck, bin, cmd.clip, pos.x, pos.y, size.width, size.height),
			ck.ClipOp.Intersect,
			true,
		);
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
	canvas: CK,
	cmd: DrawBitmapCommand,
	grid: number,
): { x: number; y: number; width: number; height: number } | null {
	const m = canvas.getTotalMatrix() as number[];
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
	ck: CK,
	canvas: CK,
	bin: Bin,
	cmd: DrawBitmapCommand,
	frame: Frame,
) {
	const { pos, size, pixels, pixelWidth, pixelHeight } = cmd;
	if (pixelWidth <= 0 || pixelHeight <= 0) return;
	const img = ck.MakeImage(
		{
			width: pixelWidth,
			height: pixelHeight,
			colorType: ck.ColorType.RGBA_8888,
			alphaType: ck.AlphaType.Unpremul,
			colorSpace: ck.ColorSpace.SRGB,
		},
		pixels,
		pixelWidth * 4,
	);
	if (!img) return;
	canvas.save();
	if (cmd.clip)
		canvas.clipPath(
			maskPath(ck, bin, cmd.clip, pos.x, pos.y, size.width, size.height),
			ck.ClipOp.Intersect,
			true,
		);
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

type SvgPicture = {
	svgPicture: CK;
	width: number;
	height: number;
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

// Recorded at the drawing's own size and scaled when drawn, so it stays
// vector at every density.
function makeSvgPicture(
	ck: CK,
	provider: CK,
	bytes: Uint8Array,
	nesting = 0,
): SvgPicture {
	const drawing = parseSvg(new TextDecoder().decode(bytes));
	const { width, height } = drawing;
	const contents = svgContents(drawing.children, {
		images: new Set(),
		text: false,
	});
	const features = drawing.warnings.map((w) => w.feature);
	if (contents.text) features.push("text");
	const images = new Map<string, CK>();
	for (const src of contents.images) {
		try {
			const data = dataUrlToBytes(src);
			const img = isSvg(data)
				? nesting < MAX_SVG_NESTING
					? makeSvgPicture(ck, provider, data, nesting + 1)
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
		return {
			svgPicture: picture,
			width,
			height,
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
	ck: CK,
	canvas: CK,
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
					null,
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

function drawPath(ck: CK, canvas: CK, bin: Bin, cmd: DrawPathCommand) {
	const path = bin.track(ck.Path.MakeFromSVGString(cmd.d));
	if (!path) return;
	if (cmd.fillRule === "evenodd") path.setFillType(ck.FillType.EvenOdd);
	canvas.save();
	canvas.translate(cmd.pos.x, cmd.pos.y); // path coords are origin-relative
	// A viewBox scales the authored path into the node's size box (SVG viewBox →
	// viewport). Fills then span the viewBox, so they map onto the full box.
	const vb = cmd.viewBox;
	let boxW = cmd.size.width;
	let boxH = cmd.size.height;
	if (vb && vb.width > 0 && vb.height > 0) {
		canvas.scale(cmd.size.width / vb.width, cmd.size.height / vb.height);
		if (vb.x || vb.y) canvas.translate(-(vb.x ?? 0), -(vb.y ?? 0));
		boxW = vb.width;
		boxH = vb.height;
	}
	for (const fill of cmd.fills ?? []) {
		const paint = bin.track(new ck.Paint());
		paint.setAntiAlias(true);
		if (fill.kind === "solid") paint.setColor(toColor(ck, fill.color));
		else paint.setShader(shaderFor(ck, bin, fill, 0, 0, boxW, boxH));
		canvas.drawPath(path, paint);
	}
	if (cmd.stroke) {
		const outline = cmd.strokeD
			? bin.track(ck.Path.MakeFromSVGString(cmd.strokeD))
			: null;
		if (outline) canvas.drawPath(outline, strokePaint(ck, bin, cmd.stroke));
		else if (strokeInset(cmd.stroke) !== 0)
			drawClippedStroke(ck, canvas, bin, path, cmd.stroke);
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
function visibleRows(canvas: CK): { top: number; bottom: number } | null {
	const [, b, , d, e, f, g, h, i] = canvas.getTotalMatrix() as number[];
	if (b !== 0 || d !== 0 || g !== 0 || h !== 0 || i !== 1 || !(e > 0))
		return null;
	const clip = canvas.getDeviceClipBounds() as Int32Array;
	return { top: (clip[1] - f) / e, bottom: (clip[3] - f) / e };
}

function lineKey(
	line: DrawTextCommand["layout"]["lines"][number],
	color: string | undefined,
	fallback: string[],
): string {
	return JSON.stringify([
		fallback,
		color,
		line.spans.map((s) => [s.text, s.font, s.color]),
		...(line.wordSpacing ? [line.wordSpacing] : []),
		...(line.direction ? [line.direction] : []),
	]);
}

function drawShape(
	ck: CK,
	canvas: CK,
	provider: CK,
	images: Map<string, CK>,
	bin: Bin,
	cmd: DrawCommand,
	issues: PaintIssues,
	frame: Frame,
) {
	if (cmd.op === "drawRect") {
		const { x, y } = cmd.pos;
		const { width: w, height: h } = cmd.size;
		const rect = ck.XYWHRect(x, y, w, h);
		const cr = cmd.cornerRadius;
		// Corner smoothing (superellipse) applies to a uniform radius; otherwise
		// fall back to a plain (possibly per-corner) rounded rect.
		const smoothing = cmd.cornerSmoothing ?? 0;
		const smoothR =
			smoothing > 0 && typeof cr === "number" && cr > 0 ? cr : null;
		const rr =
			smoothR === null &&
			cr !== undefined &&
			(typeof cr === "number" ? cr > 0 : cr.some((r) => r > 0))
				? rrectFor(ck, rect, cr)
				: null;
		const fillPath =
			smoothR !== null
				? bin.track(
						ck.Path.MakeFromSVGString(
							squircleSvg(x, y, w, h, smoothR, smoothing),
						),
					)
				: null;
		for (const fill of cmd.fills ?? []) {
			const paint = bin.track(new ck.Paint());
			paint.setAntiAlias(true);
			if (fill.kind === "solid") paint.setColor(toColor(ck, fill.color));
			else paint.setShader(shaderFor(ck, bin, fill, x, y, w, h));
			if (fillPath) canvas.drawPath(fillPath, paint);
			else if (rr) canvas.drawRRect(rr, paint);
			else canvas.drawRect(rect, paint);
		}
		if (cmd.stroke) {
			const sp = strokePaint(ck, bin, cmd.stroke);
			// Offset the stroked rect for inside/outside alignment (center = 0).
			const inset = strokeInset(cmd.stroke);
			if (smoothR !== null) {
				const path = bin.track(
					ck.Path.MakeFromSVGString(
						squircleSvg(
							x + inset,
							y + inset,
							w - 2 * inset,
							h - 2 * inset,
							Math.max(0, smoothR - inset),
							smoothing,
						),
					),
				);
				canvas.drawPath(path, sp);
			} else if (inset === 0) {
				if (rr) canvas.drawRRect(rr, sp);
				else canvas.drawRect(rect, sp);
			} else {
				const srect = ck.XYWHRect(
					x + inset,
					y + inset,
					w - 2 * inset,
					h - 2 * inset,
				);
				if (rr)
					canvas.drawRRect(rrectFor(ck, srect, insetCorner(cr, inset)), sp);
				else canvas.drawRect(srect, sp);
			}
		}
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
		for (let y = 0; y < modules.length; y++)
			for (let x = 0; x < modules.length; x++)
				if (modules[y][x])
					canvas.drawRect(
						ck.XYWHRect(pos.x + margin + x * m, pos.y + margin + y * m, m, m),
						fg,
					);
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
// (DstOut where it's transparent, for invert); a luminance channel first maps
// the mask's brightness to alpha via a color matrix.
function drawMasked(
	ck: CK,
	canvas: CK,
	provider: CK,
	images: Map<string, CK>,
	bin: Bin,
	cmd: DrawMaskedCommand,
	issues: PaintIssues,
	frame: Frame,
) {
	canvas.saveLayer();
	for (const child of cmd.children)
		paintDrawable(ck, canvas, provider, images, bin, child, issues, frame);
	const maskPaint = bin.track(new ck.Paint());
	maskPaint.setBlendMode(cmd.invert ? ck.BlendMode.DstOut : ck.BlendMode.DstIn);
	if (cmd.channel === "luminance")
		maskPaint.setColorFilter(
			bin.track(
				ck.ColorFilter.MakeMatrix([
					0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2126, 0.7152, 0.0722,
					0, 0,
				]),
			),
		);
	canvas.saveLayer(maskPaint);
	paintDrawable(ck, canvas, provider, images, bin, cmd.mask, issues, frame);
	canvas.restore();
	canvas.restore();
}

// The color-matrix component of an `adjust` as a Skia ColorFilter — the cheap
// per-pixel path, folded into the layer paint. The nonlinear `lut` and spatial
// `sharpen` components can't be a color filter, so they take the offscreen SkSL
// path (see paintAdjustedOffscreen); here we handle only the matrix.
function adjustColorFilter(ck: CK, bin: Bin, cmd: DrawCommand): CK | null {
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
function lutKey(lut: NonNullable<DrawCommand["adjust"]>["lut"]): string {
	if (!lut) throw new Error("lutKey: no lut");
	// The bytes are the value of a curve; callers often construct separate typed
	// arrays for the same gamma, so object identity would miss the useful cache.
	return `${lut.r.join(",")}|${lut.g.join(",")}|${lut.b.join(",")}`;
}

function lutImage(
	ck: CK,
	bin: Bin,
	lut: NonNullable<DrawCommand["adjust"]>["lut"],
): CK {
	if (!lut) throw new Error("lutImage: no lut");
	const key = lutKey(lut);
	const cached = bin.lutImages.get(key);
	if (cached) return cached;
	const px = new Uint8Array(256 * 4);
	for (let i = 0; i < 256; i++) {
		px[i * 4] = lut.r[i];
		px[i * 4 + 1] = lut.g[i];
		px[i * 4 + 2] = lut.b[i];
		px[i * 4 + 3] = 255;
	}
	const image = bin.track(
		ck.MakeImage(
			{
				width: 256,
				height: 1,
				colorType: ck.ColorType.RGBA_8888,
				alphaType: ck.AlphaType.Unpremul,
				colorSpace: ck.ColorSpace.SRGB,
			},
			px,
			256 * 4,
		),
	);
	bin.lutImages.set(key, image);
	return image;
}

function lut3dKey(lut: NonNullable<DrawCommand["adjust"]>["lut3d"]): string {
	if (!lut) throw new Error("lut3dKey: no LUT");
	return `${lut.size}:${lut.data.join(",")}`;
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
	ck: CK,
	bin: Bin,
	lut: NonNullable<DrawCommand["adjust"]>["lut3d"],
): CK {
	if (!validLut3d(lut)) throw new Error("lut3dImage: invalid LUT");
	const key = lut3dKey(lut);
	const cached = bin.lut3dImages.get(key);
	if (cached) return cached;
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
	const image = bin.track(
		ck.MakeImage(
			{
				width,
				height: lut.size,
				colorType: ck.ColorType.RGBA_8888,
				alphaType: ck.AlphaType.Unpremul,
				colorSpace: ck.ColorSpace.SRGB,
			},
			px,
			width * 4,
		),
	);
	bin.lut3dImages.set(key, image);
	return image;
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
		     lut.eval(float2(c.g*255.0+0.5, 0.5)).r,
		     lut.eval(float2(c.b*255.0+0.5, 0.5)).r); }`
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
const effectCache = new WeakMap<object, Map<string, CK | null>>();
function adjustEffect(
	ck: CK,
	hasMatrix: boolean,
	preserveHue: boolean,
	hasLut: boolean,
	hasLut3d: boolean,
	hasSharpen: boolean,
): CK | null {
	let byVariant = effectCache.get(ck);
	if (!byVariant) {
		byVariant = new Map();
		effectCache.set(ck, byVariant);
	}
	const bit = (b: boolean) => (b ? 1 : 0);
	const key = `${bit(hasMatrix)}${bit(preserveHue)}${bit(hasLut)}${bit(hasLut3d)}${bit(hasSharpen)}`;
	let eff = byVariant.get(key);
	if (eff === undefined) {
		eff =
			ck.RuntimeEffect.Make(
				adjustShaderSksl(hasMatrix, preserveHue, hasLut, hasLut3d, hasSharpen),
			) ?? null;
		byVariant.set(key, eff);
	}
	return eff;
}

// Apply an adjust's LUTs/sharpen via an offscreen SkSL pass: render the drawable
// (with only its color matrix) to a frame-sized offscreen surface, then draw it
// back through the adjust shader. The color matrix rides the inner render, so
// ordering is matrix → curve → cube → sharpen — color first, spatial last. The
// offscreen inherits the main canvas's full CTM and is composited back in
// device coordinates, so an adjusted descendant follows every parent transform
// exactly once. Falls back to a matrix-only render (+ an adjust_unsupported warning)
// if the surface or effect can't be created.
function paintAdjustedOffscreen(
	ck: CK,
	canvas: CK,
	provider: CK,
	images: Map<string, CK>,
	bin: Bin,
	cmd: DrawCommand,
	issues: PaintIssues,
	frame: Frame,
) {
	const adjust = cmd.adjust as NonNullable<DrawCommand["adjust"]>;
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
	// The inner drawable: same node, but only the (cheap) color matrix survives —
	// lut/sharpen are this pass's job, so dropping them avoids re-entering here.
	const inner: DrawCommand = {
		...cmd,
		adjust:
			adjust.colorMatrix && !matrixInShader
				? { colorMatrix: adjust.colorMatrix }
				: undefined,
	} as DrawCommand;
	if (hasLut3d && !validLut3d(adjust.lut3d)) {
		reportAdjustUnsupported(issues, cmd, "lut3d");
		const fallback: DrawCommand = matrixInShader
			? ({ ...cmd, adjust: { colorMatrix: adjust.colorMatrix } } as DrawCommand)
			: inner;
		paintDrawable(ck, canvas, provider, images, bin, fallback, issues, frame);
		return;
	}

	// The offscreen matches the SURFACE, not the design box: at a 2× export the
	// layer must be rendered at 2× too, or it would be blitted back upscaled from
	// half-resolution pixels. The inner render draws in design units under the same
	// scaled matrix the main canvas carries.
	const device = exportPixelSize(frame, frame.scale);
	const info = {
		width: device.width,
		height: device.height,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Premul,
		colorSpace: ck.ColorSpace.SRGB,
	};
	const surface = canvas.makeSurface(info);
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
		const fallback: DrawCommand = matrixInShader
			? ({ ...cmd, adjust: { colorMatrix: adjust.colorMatrix } } as DrawCommand)
			: inner;
		paintDrawable(ck, canvas, provider, images, bin, fallback, issues, frame);
		return;
	}

	const off = surface.getCanvas();
	off.clear(ck.TRANSPARENT);
	// The main canvas may already carry an export scale and arbitrary ancestor
	// transforms. Render the inner layer through that exact local→device matrix so
	// the snapshot occupies the same texels it would on the main surface.
	const matrix = canvas.getTotalMatrix();
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
		),
	);
	const children: CK[] = [srcSh];
	if (hasLut) {
		const lutImg = lutImage(ck, bin, adjust.lut);
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
		const cubeImg = lut3dImage(ck, bin, adjust.lut3d);
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
	// Blit in DEVICE pixels — undo the main canvas's complete CTM, not merely the
	// export scale. The snapshot already includes parent rotations/transforms; a
	// second application here would move it. The main clip remains in device space,
	// so clipping semantics are unchanged.
	// Transparent offscreen pixels stay transparent, so a full-frame draw only
	// lays down the drawable.
	const inverse = ck.Matrix.invert(matrix);
	if (!inverse) throw new Error("adjust: non-invertible canvas transform");
	canvas.save();
	canvas.concat(inverse);
	canvas.drawRect(ck.XYWHRect(0, 0, device.width, device.height), paint);
	canvas.restore();
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
	ck: CK,
	out: CK,
	src: CK,
	bin: Bin,
	design: Size,
	exportScale: number,
	supersample: number,
) {
	const rect = (s: Size) => ck.XYWHRect(0, 0, s.width, s.height);
	const retire = (s: CK) => bin.track({ delete: () => s.dispose() });

	let level = src;
	let levelSize = exportPixelSize(design, exportScale * supersample);
	retire(src);

	for (let factor = supersample; factor > 1; factor /= 2) {
		const target = exportPixelSize(design, (exportScale * factor) / 2);
		const last = factor === 2;
		const dst = last
			? out
			: level.getCanvas().makeSurface({
					width: target.width,
					height: target.height,
					colorType: ck.ColorType.RGBA_8888,
					alphaType: ck.AlphaType.Premul,
					colorSpace: ck.ColorSpace.SRGB,
				});
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

// SkSL for the whole-frame finishing pass. Order mirrors the classic output
// pipeline: dither first (break banding), then black-extract, then white-clamp.
// Colors are unpremultiplied for the threshold tests and re-premultiplied out.
// Disabled ops are signalled by a sentinel threshold of -1 (dither 0).
const FINISH_SKSL = `uniform shader src;
	uniform float whiteT;
	uniform float blackT;
	uniform float dither;
	uniform float ditherSeed;
	uniform float monochromeDither;
	half hash(float2 p){
		p += float2(ditherSeed * 0.1031, ditherSeed * 0.11369);
		return half(fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0);
	}
	half3 hash3(float2 p){
		return half3(hash(p + float2(19.19, 7.13)),
		             hash(p + float2(43.31, 31.71)),
		             hash(p + float2(67.67, 59.59)));
	}
	half4 main(float2 xy){
		half4 s = src.eval(xy);
		half a = s.a;
		half3 c = a > 0.0 ? s.rgb/a : s.rgb;
		if (dither > 0.0) {
			half n = hash(xy);
			half3 noise = monochromeDither > 0.5 ? half3(n) : hash3(xy);
			c = clamp(c + noise * dither, 0.0, 1.0);
		}
		if (blackT >= 0.0 && c.r < blackT && c.g < blackT && c.b < blackT) c = half3(0.0);
		if (whiteT >= 0.0 && c.r > whiteT && c.g > whiteT && c.b > whiteT) c = half3(1.0);
		return half4(c*a, a);
	}`;

function finishEffect(ck: CK): CK | null {
	let byVariant = effectCache.get(ck);
	if (!byVariant) {
		byVariant = new Map();
		effectCache.set(ck, byVariant);
	}
	let eff = byVariant.get("finish");
	if (eff === undefined) {
		eff = ck.RuntimeEffect.Make(FINISH_SKSL) ?? null;
		byVariant.set("finish", eff);
	}
	return eff;
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

// Run the finishing pass on the composited surface: snapshot it, clear it, then
// redraw the snapshot through the finish shader. A no-op finish never reaches
// here (compileScene only emits the command when something is set).
function applyFrameFinish(
	ck: CK,
	surface: CK,
	bin: Bin,
	finish: FrameFinish,
	// The surface's own pixel size — this pass reads and rewrites the composited
	// pixels, so it works in device pixels whatever density the scene exported at.
	device: Size,
) {
	const effect = finishEffect(ck);
	if (!effect) return; // rt_effect unavailable — leave the frame as-is.
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
	// Thresholds normalized to [0,1]; -1 disables. Dither gets an amplitude, stable
	// seed, and a scalar-vs-per-channel mode flag.
	// The comparisons are integer strict >/< on 8-bit values (matching a 0–255
	// pipeline), so the cutoff sits half a level past the threshold — robust to the
	// float round-trip and exact at the boundary (a pixel == threshold stays put).
	const whiteT =
		finish.whiteClamp !== undefined ? (finish.whiteClamp + 0.5) / 255 : -1;
	const blackT =
		finish.blackExtract !== undefined ? (finish.blackExtract - 0.5) / 255 : -1;
	const ditherConfig = normalizeDither(finish.dither);
	const dither = ditherConfig.amount > 0 ? ditherConfig.amount / 255 : 0;
	const shader = bin.track(
		effect.makeShaderWithChildren(
			[
				whiteT,
				blackT,
				dither,
				ditherConfig.seed,
				ditherConfig.monochrome ? 1 : 0,
			],
			[srcSh],
		),
	);
	const paint = bin.track(new ck.Paint());
	paint.setShader(shader);
	canvas.drawRect(ck.XYWHRect(0, 0, device.width, device.height), paint);
}

// Skia's name for each layer blend mode. Figma's linear dodge is Skia's Plus.
const SKIA_BLEND_MODE: Record<BlendMode, string> = {
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
};

// A layer paint carrying opacity + blend + blur/shadow + adjust, so the element
// composites onto everything below it exactly like a Figma layer.
function layerPaint(ck: CK, bin: Bin, cmd: DrawCommand): CK | null {
	const { blendMode, opacity, blur, shadow } = cmd;
	const hasBlend = blendMode && blendMode !== "normal";
	const hasOpacity = opacity !== undefined && opacity < 1;
	const hasBlur = typeof blur === "number" && blur > 0;
	const colorFilter = adjustColorFilter(ck, bin, cmd);
	if (!hasBlend && !hasOpacity && !hasBlur && !shadow && !colorFilter)
		return null;
	const paint = bin.track(new ck.Paint());
	// The color filter runs on the layer's contents (before blur/shadow, which are
	// image filters on the layer result): color-correct first, spatial effects
	// after.
	if (colorFilter) paint.setColorFilter(colorFilter);
	if (hasOpacity) paint.setAlphaf(opacity);
	if (blendMode && blendMode !== "normal") {
		paint.setBlendMode(
			ck.BlendMode[SKIA_BLEND_MODE[blendMode]] ?? ck.BlendMode.SrcOver,
		);
	}
	let filter: CK = null;
	if (typeof blur === "number" && blur > 0)
		filter = bin.track(
			ck.ImageFilter.MakeBlur(
				LAYER_BLUR_SIGMA(blur),
				LAYER_BLUR_SIGMA(blur),
				ck.TileMode.Decal,
				null,
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
function spreadSource(ck: CK, bin: Bin, spread: number, input: CK): CK {
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
function invertedSilhouette(ck: CK, bin: Bin, color: string): CK {
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

// The image filter for a drawable's whole shadow stack, or null when it has
// none. A `null` input anywhere in the graph is the layer's own contents.
//
// Every shadow is cast from the ORIGINAL silhouette, not from the result of the
// one below it — stacking MakeDropShadow would blur each shadow into the next.
// So each is built on its own and blended: drop shadows under the contents,
// inner shadows over them, each list painted bottom-up.
function shadowFilter(ck: CK, bin: Bin, shadow: DrawCommand["shadow"]): CK {
	const list = (Array.isArray(shadow) ? shadow : shadow ? [shadow] : []).filter(
		(s) => s.color !== "transparent",
	);
	if (list.length === 0) return null;

	let under: CK = null;
	let over: CK = null;
	for (const s of list) {
		const sigma = SHADOW_SIGMA(s.blur);
		if (s.inset) {
			// Offset + blur the inverted silhouette, then keep only the part that
			// lands on the drawable — an inner shadow never spills outside it.
			let f = invertedSilhouette(ck, bin, s.color);
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
	let out: CK = under
		? bin.track(ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, under, null))
		: null;
	if (over)
		out = bin.track(ck.ImageFilter.MakeBlend(ck.BlendMode.SrcOver, out, over));
	return out;
}

function paintDrawable(
	ck: CK,
	canvas: CK,
	provider: CK,
	images: Map<string, CK>,
	bin: Bin,
	cmd: DrawCommand,
	issues: PaintIssues,
	frame: Frame,
) {
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
	const lp = layerPaint(ck, bin, cmd);
	if (lp) canvas.saveLayer(lp);
	// drawImage clips/strokes itself so its stroke isn't clipped.
	if (cmd.clip && cmd.op !== "drawImage")
		canvas.clipPath(
			maskPath(
				ck,
				bin,
				cmd.clip,
				cmd.pos.x,
				cmd.pos.y,
				cmd.size.width,
				cmd.size.height,
			),
			ck.ClipOp.Intersect,
			true,
		);
	drawShape(ck, canvas, provider, images, bin, cmd, issues, frame);
	if (lp) canvas.restore();
	canvas.restore();
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

function warnSvgFeatures(warnings: PaintWarning[], src: string, img: CK) {
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
	ck: CK,
	commands: Command[],
	rt: PaintRuntime,
): Promise<PaintOutput> {
	const cache = rt.cache ? paintCacheState(rt.cache) : null;
	if (cache) cache.stats.paints++;
	const { fonts, images } = collectAssets(commands);
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
	const provider = cache
		? cachedFontProvider(cache, loaded, () => makeFontProvider(ck, loaded))
		: makeFontProvider(ck, loaded);
	if (cache) shapedLines.set(provider, cache);

	const imageMap = new Map<string, CK>();
	// Images the runtime lent through loadImage: painted, never freed here.
	const borrowed = new Set<string>();
	for (const src of images) {
		if (rt.loadImage) {
			try {
				const img = await rt.loadImage(src, ck);
				if (img) {
					imageMap.set(src, img);
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
		const hit = cache?.images.get(src);
		if (hit) {
			imageMap.set(src, hit);
			warnSvgFeatures(warnings, src, hit);
			continue;
		}
		try {
			const bytes = await rt.loadImageBytes(src);
			if (cache) cache.stats.imageDecodes++;
			const img = isSvg(bytes)
				? makeSvgPicture(ck, provider, bytes)
				: ck.MakeImageFromEncoded(bytes);
			if (img) {
				imageMap.set(src, img);
				cache?.images.set(src, img);
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

	const bin = makeBin();
	const create = commands.find((c) => c.op === "createCanvas") as
		| {
				op: "createCanvas";
				width: number;
				height: number;
				scale?: number;
				supersample?: number;
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
	const frame: Frame = { ...design, scale: renderScale, grid: supersample };

	// Derived from the output surface rather than ck.MakeSurface so it stays on the
	// same backend (GPU under WebGL). A backend that won't give one degrades to
	// rendering at the export size — softer than asked for, but a render.
	const superSurface =
		supersample > 1
			? surface.getCanvas().makeSurface({
					width: render.width,
					height: render.height,
					colorType: ck.ColorType.RGBA_8888,
					alphaType: ck.AlphaType.Premul,
					colorSpace: ck.ColorSpace.SRGB,
				})
			: null;
	if (supersample > 1 && !superSurface) {
		frame.scale = exportScale;
		frame.grid = 1;
	}
	// Where the drawables actually land: the supersampled offscreen when there is
	// one, else the output surface directly (the pre-supersampling path, untouched).
	const target = superSurface ?? surface;
	const skCanvas = target.getCanvas();
	skCanvas.clear(ck.TRANSPARENT);

	try {
		// Scoped to the drawable loop: the finishing pass below reads back the
		// composited pixels and belongs in device space.
		if (frame.scale !== 1) {
			skCanvas.save();
			skCanvas.scale(frame.scale, frame.scale);
		}
		for (const cmd of commands) {
			if (
				cmd.op === "createCanvas" ||
				cmd.op === "loadFonts" ||
				cmd.op === "loadImages" ||
				cmd.op === "finishFrame" // handled as a post-pass, after the loop
			)
				continue;
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
				cmd as DrawCommand,
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
				if (!images.includes(src)) {
					warnings.push({
						kind: "image_load_failed",
						src,
						error: "no image was loaded for this src",
					});
				}
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
			);
		const finishCmd = commands.find((c) => c.op === "finishFrame") as
			| { op: "finishFrame"; finish: FrameFinish }
			| undefined;
		if (finishCmd) applyFrameFinish(ck, surface, bin, finishCmd.finish, device);
		// Flush before freeing the provider/images below: on the WebGL path the GPU
		// still references the decoded images until the surface is flushed.
		surface.flush();
	} finally {
		if (cache) {
			evictUnusedImages(cache, images);
			evictUnusedLines(cache);
		} else {
			provider.delete();
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
				const data = snap.readPixels(0, 0, {
					width: w,
					height: h,
					colorType: ck.ColorType.RGBA_8888,
					alphaType: ck.AlphaType.Unpremul,
					colorSpace: ck.ColorSpace.SRGB,
				}) as Uint8Array | null;
				return data
					? { data: new Uint8Array(data), width: w, height: h }
					: null;
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
				const pixels = snap.readPixels(0, 0, {
					width: w,
					height: h,
					colorType: ck.ColorType.RGBA_8888,
					alphaType: ck.AlphaType.Unpremul,
					colorSpace: ck.ColorSpace.SRGB,
				}) as Uint8Array | null;
				// A surface that won't read back (a lost context) still has Skia's
				// encoder, which works off the snapshot rather than a pixel buffer —
				// as does a runtime without CompressionStream. Bigger bytes beat no
				// bytes, so both fall back to it rather than failing the render.
				if (!pixels) return skiaPng();
				try {
					return {
						bytes: await encodePng(new Uint8Array(pixels), w, h, encodeOpts),
						format: "png" as const,
					};
				} catch {
					return skiaPng();
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

// Bind to rt.canvas when present (WebGL, SW fallback) -> displayable; otherwise an
// offscreen raster surface. MakeWebGLCanvasSurface -> null IS the capability probe
// (a host canvas that can't back WebGL), so this needs no environment flag.
// `loseContext` drops the DOM canvas's WebGL context on dispose (see releaseGL); it
// is a no-op for the SW/offscreen paths, which hold no such context.
function makeSurface(
	ck: CK,
	rt: PaintRuntime,
	w: number,
	h: number,
): { surface: CK; canvas: CanvasLike; loseContext: () => void } {
	const noop = () => {};
	if (rt.canvas) {
		try {
			const el = rt.canvas.createCanvas(w, h);
			const gl = ck.MakeWebGLCanvasSurface(el);
			if (gl)
				return { surface: gl, canvas: el, loseContext: () => releaseGL(el) };
			const sw = ck.MakeSWCanvasSurface(el);
			if (sw) return { surface: sw, canvas: el, loseContext: noop };
		} catch {
			// Fall through to an offscreen surface.
		}
	}
	const surface = ck.MakeSurface(w, h);
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
function encodeJpeg(ck: CK, snap: CK, quality: number): Uint8Array | null {
	const width = snap.width();
	const height = snap.height();
	const info = {
		width,
		height,
		colorType: ck.ColorType.RGBA_8888,
		alphaType: ck.AlphaType.Unpremul,
		colorSpace: ck.ColorSpace.SRGB,
	};
	const pixels = snap.readPixels(0, 0, info) as Uint8Array | null;
	if (!pixels) return null;
	const flat = ck.MakeImage(
		{ ...info, alphaType: ck.AlphaType.Opaque },
		flattenOverWhite(new Uint8Array(pixels)),
		width * 4,
	);
	if (!flat) return null;
	try {
		return (flat.encodeToBytes(ck.ImageFormat.JPEG, quality) ??
			null) as Uint8Array | null;
	} finally {
		flat.delete();
	}
}
