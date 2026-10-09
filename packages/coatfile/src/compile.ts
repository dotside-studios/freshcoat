import {
	type Adjust,
	type BitmapNode,
	buildAdjust,
	type ChildLayout,
	type EllipseNode,
	FALLBACK_LINE_HEIGHT,
	type GroupNode,
	type ImageNode,
	isEllipsePath,
	type MaskNode,
	type Node,
	type PathNode,
	parseColor,
	patternFill,
	roundCorners,
	type RectNode,
	scalePathData,
	strokeTrim,
	type TextNode,
	type TrackSize,
	type Layout as SceneLayout,
} from "@freshcoat-js/engine";
import { encodeBarcode } from "./barcode";
import {
	BEARER_BAR_MODULES,
	bearerBarsOf,
	defaultQuietZone,
	isLinearSymbology,
	isSquareSymbology,
	symbologyLabel,
} from "./barcode-encoder";
import {
	extendIntoBleed,
	hasInsets,
	NO_INSETS,
	offsetElements,
	templateBleed,
} from "./bleed";
import { linearPoints } from "./fills";
import { barcodeFontFamily, defaultFontFamily } from "./font-usage";
import { parseImageFocus } from "./image-focus";
import { prepareTemplate } from "./prepare";
import { substitute } from "./mustache";
import { generatePixels } from "./qr";
import { resolveStrokeTrim, type StrokeTrimInput } from "./stroke-trim";
import { applyCase, isTextCase, lastChar } from "./text-case";
import { walkElements } from "./tree";
import type {
	Background,
	BearerBars,
	CompiledFrame,
	CompiledTemplate,
	CompileOptions,
	CompileWarning,
	CornerRadius,
	Element,
	ElementAdjust,
	Fill,
	FontRequest,
	FrameFlexLayout,
	Gradient,
	GradientFill,
	GridTrack,
	ImageCrop,
	Layout,
	LayoutChild,
	ResolvedFill,
	ResolvedFont,
	Shadow,
	Shadows,
	ShapeMask,
	Size,
	Stroke,
	Symbology,
	Template,
	TemplateFrame,
	TextProperties,
	Vec2,
} from "./types";
import { pruneHiddenElements } from "./visibility";

type TextSpanInput = {
	text: string;
	font?: {
		family?: string;
		size?: number;
		weight?: number;
		style?: string;
		letterSpacing?: number;
		lineHeight?: number;
		decoration?: ResolvedFont["decoration"];
		skipInk?: boolean;
		variations?: ResolvedFont["variations"];
		features?: ResolvedFont["features"];
	};
	color?: string;
};

type ImageMaskInput =
	| "circle"
	| "ellipse"
	| { kind: "rounded-rect"; radius: number }
	| { kind: "polygon"; sides: number; rotation?: number; cornerRadius?: number }
	| { kind: "squircle"; radius: number };

const ASPECT_TOLERANCE = 0.005;

// compile() turns a Template + values into a per-frame freshcoat Node tree
// (declarative — auto-layout is expressed via each group's `layout`, positions
// are parent-relative, {{tokens}} are substituted, text is NOT yet baked). The
// heavy lifting — resolving auto-layout to absolute geometry, baking glyphs, and
// lowering to the flat Command IR — is freshcoat's compileScene, driven by
// coatfile's `render` (compile + paint). A consumer that only needs geometry
// (e.g. a skeleton preview) lowers the tree with freshcoat's compileScene itself.
export function compile(
	inputTemplate: Template,
	values: Record<string, unknown>,
	opts: CompileOptions,
): CompiledTemplate {
	const template = prepareTemplate(inputTemplate, {
		variantId: opts.variantId,
		resize: opts.resize,
	});

	const ratio = opts.width / template.width;
	const aspectTemplate = template.width / template.height;
	const aspectTarget = opts.width / opts.height;
	if (
		!opts.resize &&
		Math.abs(aspectTarget - aspectTemplate) >= ASPECT_TOLERANCE
	) {
		throw new Error(
			`aspect ratio mismatch: template ${aspectTemplate.toFixed(3)}, target ${aspectTarget.toFixed(3)}`,
		);
	}

	const ctx: Record<string, unknown> = {};
	for (const [k, def] of Object.entries(template.fields.properties)) {
		if (def.default !== undefined) ctx[k] = def.default;
	}
	for (const [k, val] of Object.entries(values)) {
		if (val !== undefined && val !== null) ctx[k] = val;
	}

	const bleed = opts.bleed ? templateBleed(template) : NO_INSETS;
	const withBleed = hasInsets(bleed);
	const width = opts.width + (bleed.left + bleed.right) * ratio;
	const height = opts.height + (bleed.top + bleed.bottom) * ratio;
	const trim = { width: template.width, height: template.height };

	const frameData = opts.frameNames
		? template.template_data.filter((f) => opts.frameNames?.includes(f.name))
		: template.template_data;
	const frames = frameData.map((frame) => {
		const elements = pruneHiddenElements(
			frame.elements,
			ctx,
			template.fields.properties,
		);
		return compileFrame(
			{
				...frame,
				elements: withBleed
					? offsetElements(
							extendIntoBleed(elements, trim, bleed),
							bleed.left,
							bleed.top,
						)
					: elements,
			},
			template,
			ctx,
			ratio,
			width,
			height,
		);
	});

	if (!withBleed) return { width, height, frames };
	return {
		width,
		height,
		trim: {
			x: bleed.left * ratio,
			y: bleed.top * ratio,
			width: opts.width,
			height: opts.height,
		},
		frames,
	};
}

// ─────────────── frame → root group ───────────────

function compileFrame(
	frame: TemplateFrame,
	template: Template,
	ctx: Record<string, unknown>,
	ratio: number,
	targetWidth: number,
	targetHeight: number,
): CompiledFrame {
	const declaredFontByFamily = new Map(
		(template.fonts ?? []).map((f) => [f.family, f] as const),
	);

	const usedFamilies = new Set<string>();
	const images = new Set<string>();
	const fallbackFamily = defaultFontFamily(template);
	const collectAssets = (el: Element | Background) => {
		if (el.type === "text") usedFamilies.add(el.properties.font.family);
		if (el.type === "barcode") {
			const family = barcodeFontFamily(el, fallbackFamily);
			if (family) usedFamilies.add(family);
		}
		if (el.type === "image") {
			const src = String(substitute(el.properties.src, ctx) ?? "");
			if (src) images.add(src);
		}
	};
	collectAssets(frame.background);
	walkElements(frame.elements, collectAssets);

	// collectFontRequests in fonts.ts mirrors this resolution — keep in step.
	const fonts: FontRequest[] = [...usedFamilies].map((family) => {
		const descriptor = declaredFontByFamily.get(family);
		return descriptor ? { family, descriptor } : { family };
	});

	const scope: CompileScope = {
		fontFamily: fallbackFamily ?? "sans-serif",
		warnings: [],
	};
	const children: Node[] = [
		compileBackground(frame.background, ctx, targetWidth, targetHeight, ratio),
		...frame.elements.map((el) => compileElement(el, ctx, ratio, scope)),
	];
	const root: GroupNode = {
		kind: "group",
		pos: { x: 0, y: 0 },
		size: { width: targetWidth, height: targetHeight },
		children,
	};

	return {
		name: frame.name,
		assets: { fonts, images: [...images] },
		root,
		...(scope.warnings.length > 0 ? { warnings: scope.warnings } : {}),
	};
}

// What compiling one frame's elements shares: the family a barcode's text falls
// back to, and the problems found along the way, which the frame carries out.
type CompileScope = {
	fontFamily: string;
	warnings: CompileWarning[];
};

function compileBackground(
	bg: Background,
	ctx: Record<string, unknown>,
	targetWidth: number,
	targetHeight: number,
	ratio: number,
): Node {
	const props = substitute(bg.properties, ctx) as Record<string, unknown>;
	const pos: Vec2 = { x: 0, y: 0 };
	const size: Size = { width: targetWidth, height: targetHeight };
	const transform = {
		pos,
		size,
		rotation: bg.rotation,
		opacity: bg.opacity,
		blendMode: bg.blendMode,
		shadow: scaleShadow(bg.shadow, 1),
		blur: bg.blur,
		backdropBlur: bg.backdropBlur,
		adjust: resolveAdjust(bg.adjust),
	};
	if (bg.type === "rect") {
		return {
			...transform,
			kind: "rect",
			fills: resolveFills(props.fill as Fill | Fill[] | undefined, ratio),
			stroke: resolveStroke(props.stroke as StrokeInput | undefined, 1),
			cornerRadius: scaleCorner(props.cornerRadius, 1),
			cornerSmoothing:
				typeof props.cornerSmoothing === "number"
					? props.cornerSmoothing
					: undefined,
		};
	}
	return {
		...transform,
		kind: "image",
		src: String(props.src ?? ""),
		fit: (props.fit as ImageNode["fit"]) ?? "cover",
		...imageFraming(props),
		stroke: resolveStroke(props.stroke as StrokeInput | undefined, 1),
		mask: resolveImageClip(
			props.cornerRadius as number | undefined,
			props.mask as ImageMaskInput | undefined,
			1,
		),
	};
}

// ─────────────── element → node ───────────────

function compileElement(
	el: Element,
	ctx: Record<string, unknown>,
	ratio: number,
	scope: CompileScope,
): Node {
	const pos = scaleVec(el.pos ?? { x: 0, y: 0 }, ratio);
	const size = scaleSize(el.size ?? { width: 0, height: 0 }, ratio);
	const transform = {
		id: el.id,
		pos,
		size,
		rotation: el.rotation,
		opacity: el.opacity,
		blendMode: el.blendMode,
		shadow: scaleShadow(el.shadow, ratio),
		blur: typeof el.blur === "number" ? el.blur * ratio : undefined,
		backdropBlur:
			typeof el.backdropBlur === "number"
				? el.backdropBlur * ratio
				: undefined,
		adjust: resolveAdjust(el.adjust),
		layoutChild: mapLayoutChild(el.layoutChild, ratio),
	};
	const props = substituteOwnProperties(el, ctx);
	switch (el.type) {
		case "rect":
			return {
				...transform,
				kind: "rect",
				fills: resolveFills(props.fill as Fill | Fill[] | undefined, ratio),
				stroke: resolveStroke(props.stroke as StrokeInput | undefined, ratio),
				cornerRadius: scaleCorner(props.cornerRadius, ratio),
				cornerSmoothing:
					typeof props.cornerSmoothing === "number"
						? props.cornerSmoothing
						: undefined,
			} satisfies RectNode;
		case "image":
			return {
				...transform,
				kind: "image",
				src: String(props.src ?? ""),
				fit: (props.fit as ImageNode["fit"]) ?? "cover",
				...imageFraming(props),
				stroke: resolveStroke(props.stroke as StrokeInput | undefined, ratio),
				mask: resolveImageClip(
					props.cornerRadius as number | undefined,
					props.mask as ImageMaskInput | undefined,
					ratio,
				),
			} satisfies ImageNode;
		case "vector": {
			const stroke = resolveStroke(
				props.stroke as StrokeInput | undefined,
				ratio,
			);
			const d = String(props.d ?? "");
			const fills = resolveFills(
				props.fill as Fill | Fill[] | undefined,
				ratio,
			);
			// A trimmed ellipse runs from its top, as a progress ring does.
			if (
				stroke &&
				strokeTrim(stroke) &&
				el.size &&
				isEllipsePath(d, el.size.width, el.size.height)
			)
				return {
					...transform,
					kind: "ellipse",
					fills,
					stroke,
				} satisfies EllipseNode;
			return {
				...transform,
				kind: "path",
				d: scalePathString(
					roundCorners(d, Number(props.cornerRadius ?? 0)),
					ratio,
				),
				...(props.fillRule === "evenodd" || props.fillRule === "nonzero"
					? { fillRule: props.fillRule }
					: {}),
				fills,
				stroke,
			} satisfies PathNode;
		}
		case "text":
			return compileText(transform, props, ratio);
		case "qr_code":
			return compileQr(transform, props, ratio);
		case "barcode":
			return compileBarcode(transform, props, ratio, scope);
		case "mask":
			return {
				...transform,
				kind: "mask",
				mask: compileElement(props.mask as Element, ctx, ratio, scope),
				children: ((props.children as Element[] | undefined) ?? []).map(
					(child) => compileElement(child, ctx, ratio, scope),
				),
				...(props.channel === "luminance" ? { channel: "luminance" } : {}),
				...(props.invert === true ? { invert: true } : {}),
			} satisfies MaskNode;
		case "frame":
			return compileFrameElement(transform, props, ratio, ctx, scope);
		default:
			return unknownElement(el);
	}
}

// Every element type has a case above; one added to the schema without one is
// a type error here rather than a frame that silently draws nothing.
function unknownElement(el: never): never {
	throw new Error(
		`compile: no case for element type ${(el as { type?: unknown }).type}`,
	);
}

// Nested elements are substituted by their own compileElement call. Substituting
// them here as well would run a second pass over text the first pass produced,
// so a value that itself reads `{{other_field}}` would expand inside a frame.
function substituteOwnProperties(
	el: Element,
	ctx: Record<string, unknown>,
): Record<string, unknown> {
	if (el.type === "frame") {
		const { children, ...own } = el.properties;
		return { ...(substitute(own, ctx) as object), children };
	}
	if (el.type === "mask") {
		const { children, mask, ...own } = el.properties;
		return { ...(substitute(own, ctx) as object), children, mask };
	}
	return substitute(el.properties, ctx) as Record<string, unknown>;
}

type Base = {
	id?: string;
	pos: Vec2;
	size: Size;
	rotation?: number;
	opacity?: number;
	blendMode?: Element["blendMode"];
	shadow?: Shadows;
	blur?: number;
	backdropBlur?: number;
	adjust?: Adjust;
	layoutChild?: ChildLayout;
};

function compileText(
	base: Base,
	props: Record<string, unknown>,
	ratio: number,
): TextNode {
	const inputFont = props.font as {
		family: string;
		size: number;
		weight?: number;
		style?: string;
		lineHeight?: number | "auto";
		letterSpacing?: number;
		decoration?: ResolvedFont["decoration"];
		skipInk?: boolean;
		variations?: ResolvedFont["variations"];
		features?: ResolvedFont["features"];
	};
	const font: ResolvedFont = {
		family: inputFont.family,
		weight: inputFont.weight ?? 400,
		style: (inputFont.style as "normal" | "italic" | undefined) ?? "normal",
		size: inputFont.size * ratio,
		letterSpacing:
			typeof inputFont.letterSpacing === "number"
				? inputFont.letterSpacing * ratio
				: undefined,
		...lineHeightOf(inputFont.lineHeight),
		decoration: inputFont.decoration,
		...(inputFont.skipInk !== undefined ? { skipInk: inputFont.skipInk } : {}),
		...(inputFont.variations ? { variations: inputFont.variations } : {}),
		...(inputFont.features ? { features: inputFont.features } : {}),
	};

	// Normalize: `value` is sugar for a single span. Figma "Case" applies to the
	// already-substituted text (dynamic {{values}} are cased). A single span with
	// no per-span override lowers as single-style text; anything richer as spans.
	const spans = applyTextCase(normalizeTextSpans(props), props.case);
	const single = spans.length === 1 && !hasOverrides(spans[0]);

	const node: TextNode = {
		...base,
		kind: "text",
		font,
		color: String(props.color ?? "#000"),
		align:
			(props.align as TextNode["align"]) ??
			(props.direction ? "start" : "left"),
		...(props.alignLast
			? { alignLast: props.alignLast as TextNode["alignLast"] }
			: {}),
		...(props.direction
			? { direction: props.direction as TextNode["direction"] }
			: {}),
		...(typeof props.paragraphSpacing === "number" && props.paragraphSpacing > 0
			? { paragraphSpacing: props.paragraphSpacing * ratio }
			: {}),
		verticalAlign: (props.verticalAlign as TextNode["verticalAlign"]) ?? "top",
		fit: props.fit as TextNode["fit"],
		maxLines: typeof props.maxLines === "number" ? props.maxLines : undefined,
		// Figma's "Vertical trim", and its default is STANDARD: the first baseline
		// sits at half the leading plus the ascent. Cap-height trim is the opt-in
		// (it lifts every line by ascent − capHeight), so an absent value means
		// standard — measured against Figma's own absoluteRenderBounds, which
		// otherwise sits ~0.39em below where this renders in Vend Sans.
		leadingTrim: props.leadingTrim === true,
		...(props.arc ? { arc: compileArc(props.arc as TextArcInput, ratio) } : {}),
		...(props.path
			? { path: compileTextPath(props.path as TextPathInput, ratio) }
			: {}),
	};
	if (single) {
		node.text = spans[0].text;
	} else {
		node.spans = spans.map((s) => ({
			text: s.text,
			font: s.font ? mapSpanFont(s.font, ratio) : undefined,
			color: s.color,
		}));
	}

	// A gradient text fill (mapped to the box) overrides the solid color.
	const resolvedFill = resolveFill(props.fill as Fill | undefined, ratio);
	if (resolvedFill && resolvedFill.kind !== "solid") node.fill = resolvedFill;
	return node;
}

type TextArcInput = NonNullable<TextProperties["arc"]>;

function compileArc(arc: TextArcInput, ratio: number): TextNode["arc"] {
	return {
		...(arc.radius !== undefined ? { radius: arc.radius * ratio } : {}),
		...(arc.sweep !== undefined ? { sweep: arc.sweep } : {}),
		...(arc.startAngle !== undefined ? { startAngle: arc.startAngle } : {}),
		...(arc.direction ? { direction: arc.direction } : {}),
		...(arc.align ? { align: arc.align } : {}),
		...(arc.fit ? { fit: arc.fit } : {}),
	};
}

type TextPathInput = NonNullable<TextProperties["path"]>;

function compileTextPath(
	path: TextPathInput,
	ratio: number,
): TextNode["path"] {
	return {
		...(path.d !== undefined ? { d: scalePathString(path.d, ratio) } : {}),
		...(path.ref !== undefined ? { ref: path.ref } : {}),
		...(path.startOffset !== undefined
			? {
					startOffset:
						typeof path.startOffset === "number"
							? path.startOffset * ratio
							: path.startOffset,
				}
			: {}),
		...(path.side ? { side: path.side } : {}),
		...(path.align ? { align: path.align } : {}),
	};
}

function mapSpanFont(
	f: NonNullable<TextSpanInput["font"]>,
	ratio: number,
): Partial<ResolvedFont> {
	return {
		family: f.family,
		size: typeof f.size === "number" ? f.size * ratio : undefined,
		weight: f.weight,
		style: f.style as "normal" | "italic" | undefined,
		letterSpacing:
			typeof f.letterSpacing === "number" ? f.letterSpacing * ratio : undefined,
		...(f.lineHeight === undefined ? {} : lineHeightOf(f.lineHeight)),
		decoration: f.decoration,
		...(f.skipInk !== undefined ? { skipInk: f.skipInk } : {}),
		...(f.variations ? { variations: f.variations } : {}),
		...(f.features ? { features: f.features } : {}),
	};
}

// An authored line height as freshcoat's node carries it. "auto" means the
// FONT's line box, which only the renderer can resolve (it needs the family's
// metrics) — so the node keeps the flag plus the same number coatfile has
// always written, which stands if the family's metrics never turn up.
function lineHeightOf(authored: number | "auto" | undefined): {
	lineHeight: number;
	autoLineHeight?: boolean;
} {
	if (authored === "auto")
		return { lineHeight: FALLBACK_LINE_HEIGHT, autoLineHeight: true };
	return { lineHeight: authored ?? FALLBACK_LINE_HEIGHT };
}

// Frame → a group. fill/stroke/cornerRadius lower to a background rect (the
// group's first child); clipsContent → the group's self-clip, with an outside
// stroke moved to a rect beside the clipped group. When the frame
// auto-layouts AND has a background, the background must stay out of the flow,
// so it wraps in an outer static group [bg, inner layout group]; otherwise the
// frame is the layout group (or a plain static group) directly — no redundant
// nesting.
function compileFrameElement(
	base: Base,
	props: Record<string, unknown>,
	ratio: number,
	ctx: Record<string, unknown>,
	scope: CompileScope,
): GroupNode {
	const size = base.size;
	const fills = resolveFills(props.fill as Fill | Fill[] | undefined, ratio);
	const stroke = resolveStroke(props.stroke as StrokeInput | undefined, ratio);
	const cornerRadius = scaleCorner(props.cornerRadius, ratio);
	const clip = props.clipsContent === true;
	// An outside stroke lies wholly beyond the box, so a clipping frame draws it
	// outside its clip.
	const strokeOutside = clip && stroke?.align === "outside";
	const bgStroke = strokeOutside ? undefined : stroke;

	const bg: RectNode | null =
		fills || bgStroke
			? {
					kind: "rect",
					pos: { x: 0, y: 0 },
					size,
					fills,
					stroke: bgStroke,
					cornerRadius,
				}
			: null;

	const rawChildren = (props.children as Element[] | undefined) ?? [];
	const layout = mapLayout(props.layout as Layout | undefined, ratio);
	const childNodes = rawChildren.map((child) => {
		const node = compileElement(child, ctx, ratio, scope);
		return layout?.type === "grid" ? withFixedGridSize(node) : node;
	});
	const outer = {
		id: base.id,
		pos: base.pos,
		size,
		rotation: base.rotation,
		opacity: base.opacity,
		blendMode: base.blendMode,
		shadow: base.shadow,
		blur: base.blur,
		backdropBlur: base.backdropBlur,
		adjust: base.adjust,
		layoutChild: base.layoutChild,
		clip,
		cornerRadius,
		...(props.isolate === true ? { isolate: true } : {}),
	};

	const frame: GroupNode =
		layout && bg
			? {
					...outer,
					kind: "group",
					children: [
						bg,
						{
							kind: "group",
							pos: { x: 0, y: 0 },
							size,
							layout,
							children: childNodes,
						},
					],
				}
			: {
					...outer,
					kind: "group",
					layout,
					children: bg ? [bg, ...childNodes] : childNodes,
				};
	if (!strokeOutside) return frame;

	const {
		id,
		pos,
		rotation,
		opacity,
		blendMode,
		shadow,
		blur,
		backdropBlur,
		adjust,
		layoutChild,
		isolate,
		...content
	} = frame;
	return {
		id,
		pos,
		size,
		rotation,
		opacity,
		blendMode,
		shadow,
		blur,
		adjust,
		layoutChild,
		...(isolate ? { isolate } : {}),
		...(backdropBlur ? { backdropBlur, cornerRadius } : {}),
		kind: "group",
		children: [
			{ ...content, pos: { x: 0, y: 0 } },
			{ kind: "rect", pos: { x: 0, y: 0 }, size, stroke, cornerRadius },
		],
	};
}

// QR → group holding an optional background rect + a bitmap of the module
// matrix (foreground where a module is set, transparent elsewhere), placed
// inside the quiet-zone margin. The painter scales it nearest-neighbor.
function compileQr(
	base: Base,
	props: Record<string, unknown>,
	ratio: number,
): GroupNode {
	const value = String(props.value ?? "");
	const ec =
		(props.errorCorrection as "L" | "M" | "Q" | "H" | undefined) ?? "M";
	const margin = typeof props.margin === "number" ? props.margin * ratio : 0;
	const foreground = String(props.foreground ?? "#000");
	const background = props.background as string | undefined;
	const size = base.size;

	const children: Node[] = [];
	if (background) {
		children.push({
			kind: "rect",
			pos: { x: 0, y: 0 },
			size,
			fills: [{ kind: "solid", color: background }],
		});
	}
	const { size: n, pixels } = generatePixels(
		value,
		ec,
		foregroundRgb(foreground),
	);
	children.push({
		kind: "bitmap",
		pos: { x: margin, y: margin },
		size: { width: size.width - 2 * margin, height: size.height - 2 * margin },
		pixels,
		pixelWidth: n,
		pixelHeight: n,
	});

	return {
		id: base.id,
		kind: "group",
		pos: base.pos,
		size,
		rotation: base.rotation,
		opacity: base.opacity,
		blendMode: base.blendMode,
		shadow: base.shadow,
		blur: base.blur,
		backdropBlur: base.backdropBlur,
		adjust: base.adjust,
		layoutChild: base.layoutChild,
		children,
	};
}

// Barcode → a group like QR's: an optional background rect, then the code as a
// bitmap of its modules (foreground where set, transparent elsewhere) inside
// the quiet zone. A 1D code is one row of pixels stretched to the bar height,
// with its human-readable line under it; a 2D code keeps square modules and sits
// centred. The bitmap carries `role: "barcode"`, which is what has the painter
// snap its modules to whole output pixels.
function compileBarcode(
	base: Base,
	props: Record<string, unknown>,
	ratio: number,
	scope: CompileScope,
): GroupNode {
	const symbology = props.symbology as Symbology;
	const value = String(props.value ?? "");
	const foreground = String(props.foreground ?? "#000000");
	const background = props.background as string | undefined;
	const size = base.size;
	const linear = isLinearSymbology(symbology);
	const quietZone =
		typeof props.quietZone === "number" && props.quietZone >= 0
			? props.quietZone
			: defaultQuietZone(symbology);
	const showText = linear && props.showText !== false;
	const textSize =
		typeof props.textSize === "number" && props.textSize > 0
			? props.textSize * ratio
			: Math.max(8 * ratio, size.height * 0.14);
	const fontFamily =
		typeof props.fontFamily === "string" && props.fontFamily
			? props.fontFamily
			: scope.fontFamily;
	// The text line's box, and the gap that keeps it off the bars.
	const textHeight = showText ? textSize * FALLBACK_LINE_HEIGHT : 0;
	const textGap = showText ? textSize * 0.15 : 0;
	const barHeight = Math.max(0, size.height - textHeight - textGap);

	const children: Node[] = [];
	if (background) {
		children.push({
			kind: "rect",
			pos: { x: 0, y: 0 },
			size,
			fills: [{ kind: "solid", color: background }],
		});
	}
	const group = (): GroupNode => ({
		id: base.id,
		kind: "group",
		pos: base.pos,
		size,
		rotation: base.rotation,
		opacity: base.opacity,
		blendMode: base.blendMode,
		shadow: base.shadow,
		blur: base.blur,
		backdropBlur: base.backdropBlur,
		adjust: base.adjust,
		layoutChild: base.layoutChild,
		children,
	});
	const textLine = (text: string, y: number): TextNode => ({
		kind: "text",
		pos: { x: 0, y },
		size: { width: size.width, height: textHeight },
		text,
		font: {
			family: fontFamily,
			weight: 400,
			style: "normal",
			size: textSize,
			lineHeight: FALLBACK_LINE_HEIGHT,
		},
		color: foreground,
		align: "center",
		verticalAlign: "top",
		leadingTrim: false,
	});

	// An unfilled field in a preview is not a mistake to report: it draws the
	// outline of the code that will be there, and no warning.
	if (value === "") {
		children.push(
			...barcodeSkeleton(symbology, size, foreground, {
				barHeight,
				textY: barHeight + textGap,
				textHeight: showText ? textSize : 0,
			}),
		);
		return group();
	}

	const result = encodeBarcode(symbology, value, {
		errorCorrection:
			typeof props.errorCorrection === "number"
				? props.errorCorrection
				: undefined,
	});
	if (!result.ok) {
		scope.warnings.push({
			kind: "barcode_invalid",
			symbology,
			value,
			message: result.message,
			...(base.id ? { layer: base.id } : {}),
		});
		children.push(
			barcodePlaceholder(symbologyLabel(symbology), size, foreground, {
				family: scope.fontFamily,
				size: placeholderLabelSize(symbologyLabel(symbology), size, ratio),
			}),
		);
		return group();
	}

	const [r, g, b] = foregroundRgb(foreground);
	const paint = (pixels: Uint8Array, i: number) => {
		pixels[i * 4] = r;
		pixels[i * 4 + 1] = g;
		pixels[i * 4 + 2] = b;
		pixels[i * 4 + 3] = 255;
	};
	const { encoding } = result;
	if (encoding.kind === "linear") {
		const n = encoding.modules.length;
		const bearers = bearerBarsOf(
			symbology,
			props.bearerBars as BearerBars | undefined,
		);
		const sideBearers = bearers === "frame" ? BEARER_BAR_MODULES : 0;
		const module = size.width / (n + 2 * quietZone + 2 * sideBearers);
		const bearer = bearers === "none" ? 0 : BEARER_BAR_MODULES * module;
		const pixels = new Uint8Array(n * 4);
		encoding.modules.forEach((set, i) => {
			if (set) paint(pixels, i);
		});
		children.push({
			kind: "bitmap",
			pos: { x: (sideBearers + quietZone) * module, y: bearer },
			size: { width: n * module, height: Math.max(0, barHeight - 2 * bearer) },
			pixels,
			pixelWidth: n,
			pixelHeight: 1,
			role: "barcode",
		} satisfies BitmapNode);
		if (bearers !== "none")
			children.push(
				...bearerBarRects(bearers, size.width, barHeight, bearer, foreground),
			);
		if (showText) children.push(textLine(encoding.text, barHeight + textGap));
		return group();
	}

	const rows = encoding.rows.length;
	const cols = encoding.rows[0]?.length ?? 0;
	const module = Math.min(
		size.width / (cols + 2 * quietZone),
		size.height / (rows + 2 * quietZone),
	);
	const pixels = new Uint8Array(rows * cols * 4);
	encoding.rows.forEach((row, y) => {
		row.forEach((set, x) => {
			if (set) paint(pixels, y * cols + x);
		});
	});
	children.push({
		kind: "bitmap",
		pos: {
			x: (size.width - cols * module) / 2,
			y: (size.height - rows * module) / 2,
		},
		size: { width: cols * module, height: rows * module },
		pixels,
		pixelWidth: cols,
		pixelHeight: rows,
		role: "barcode",
	} satisfies BitmapNode);
	return group();
}

// ITF-14's bearer bars: across the top and bottom of the bars, and for a frame
// down both sides too, outside the quiet zone.
function bearerBarRects(
	bearers: "frame" | "horizontal",
	width: number,
	height: number,
	thickness: number,
	color: string,
): RectNode[] {
	const bar = (x: number, y: number, w: number, h: number): RectNode => ({
		kind: "rect",
		pos: { x, y },
		size: { width: w, height: h },
		fills: [{ kind: "solid", color }],
	});
	const out = [
		bar(0, 0, width, thickness),
		bar(0, height - thickness, width, thickness),
	];
	const inner = Math.max(0, height - 2 * thickness);
	if (bearers === "frame")
		out.push(
			bar(0, thickness, thickness, inner),
			bar(width - thickness, thickness, thickness, inner),
		);
	return out;
}

// The shape a barcode will take once its field is filled: the bar area (and the
// text line under it) of a 1D code, the square of a Data Matrix or Aztec, the
// box of a PDF417. Drawn faint, in the code's own colour.
function barcodeSkeleton(
	symbology: Symbology,
	size: Size,
	foreground: string,
	linear: { barHeight: number; textY: number; textHeight: number },
): RectNode[] {
	const faint = (pos: Vec2, box: Size): RectNode => ({
		kind: "rect",
		pos,
		size: box,
		opacity: 0.15,
		fills: [{ kind: "solid", color: foreground }],
	});
	if (isLinearSymbology(symbology)) {
		const inset = size.width * 0.08;
		const out = [
			faint(
				{ x: inset, y: 0 },
				{ width: size.width - 2 * inset, height: linear.barHeight },
			),
		];
		if (linear.textHeight > 0) {
			const width = size.width * 0.5;
			out.push(
				faint(
					{ x: (size.width - width) / 2, y: linear.textY },
					{ width, height: linear.textHeight },
				),
			);
		}
		return out;
	}
	if (isSquareSymbology(symbology)) {
		const side = Math.min(size.width, size.height);
		return [
			faint(
				{ x: (size.width - side) / 2, y: (size.height - side) / 2 },
				{ width: side, height: side },
			),
		];
	}
	return [faint({ x: 0, y: 0 }, size)];
}

// The placeholder's label: a fifth of the box's height, narrowed until the
// name fits across it, and never under 8 design px. It names what is missing,
// so it has to read at the zoom the whole card is seen at.
function placeholderLabelSize(label: string, size: Size, ratio: number) {
	const across = size.width / (Math.max(1, label.length) * 0.75);
	return Math.max(8 * ratio, Math.min(size.height * 0.2, across));
}

// What stands in for a barcode that can't be drawn: a hatched box with the
// symbology's name, so the gap reads as deliberate and says what belongs there.
function barcodePlaceholder(
	label: string,
	size: Size,
	foreground: string,
	font: { family: string; size: number },
): GroupNode {
	const spacing = Math.max(4, Math.min(size.width, size.height) / 8);
	let d = "";
	for (let x = -size.height; x < size.width; x += spacing) {
		d += `M${x} ${size.height}L${x + size.height} 0`;
	}
	const hairline = Math.max(1, Math.min(size.width, size.height) / 100);
	return {
		kind: "group",
		pos: { x: 0, y: 0 },
		size,
		clip: true,
		children: [
			{
				kind: "path",
				pos: { x: 0, y: 0 },
				size,
				d,
				opacity: 0.25,
				stroke: { color: foreground, width: hairline },
			},
			{
				kind: "rect",
				pos: { x: 0, y: 0 },
				size,
				opacity: 0.5,
				stroke: { color: foreground, width: hairline * 2, align: "inside" },
			},
			{
				kind: "text",
				pos: { x: 0, y: 0 },
				size,
				text: label,
				font: {
					family: font.family,
					weight: 600,
					style: "normal",
					size: font.size,
					lineHeight: FALLBACK_LINE_HEIGHT,
				},
				color: foreground,
				align: "center",
				verticalAlign: "middle",
				leadingTrim: false,
			},
		],
	};
}

// The foreground's colour channels. Anything unreadable falls back to black.
function foregroundRgb(color: string): [number, number, number] {
	const c = parseColor(color);
	return c && c !== "none" ? [c[0], c[1], c[2]] : [0, 0, 0];
}

// ─────────────── layout mapping (template Layout → freshcoat Layout) ───────────────

function mapLayout(
	layout: Layout | undefined,
	ratio: number,
): SceneLayout | undefined {
	if (!layout) return undefined;
	const padding = layout.padding
		? ([
				(layout.padding.top ?? 0) * ratio,
				(layout.padding.right ?? 0) * ratio,
				(layout.padding.bottom ?? 0) * ratio,
				(layout.padding.left ?? 0) * ratio,
			] as [number, number, number, number])
		: undefined;
	if ("type" in layout && layout.type === "grid") {
		const track = (t: GridTrack): TrackSize =>
			typeof t === "number" ? t * ratio : (t as TrackSize);
		return {
			type: "grid",
			columns: layout.columns.map(track),
			...(layout.rows ? { rows: layout.rows.map(track) } : {}),
			...(layout.gap === undefined
				? {}
				: {
						gap:
							typeof layout.gap === "number"
								? layout.gap * ratio
								: [layout.gap[0] * ratio, layout.gap[1] * ratio],
					}),
			...(padding ? { padding } : {}),
		};
	}
	const flex = layout as FrameFlexLayout;
	const out: SceneLayout = { type: "flex", direction: flex.direction };
	if (flex.gap !== undefined) out.gap = flex.gap * ratio;
	if (flex.crossGap !== undefined) out.crossGap = flex.crossGap * ratio;
	if (padding) out.padding = padding;
	if (flex.primaryAlign) out.justify = flex.primaryAlign;
	if (flex.crossAlign) out.align = flex.crossAlign;
	if (flex.wrap) out.wrap = true;
	return out;
}

// A grid stretches a child to its cell unless told otherwise, where a coatfile
// child without `fill` or `hug` keeps its own size, as it does in a flex layout.
function withFixedGridSize(node: Node): Node {
	const lc = node.layoutChild ?? {};
	const size = node.size ?? { width: 0, height: 0 };
	return {
		...node,
		layoutChild: {
			...lc,
			width: lc.width ?? size.width,
			height: lc.height ?? size.height,
		},
	};
}

function mapLayoutChild(
	lc: LayoutChild | undefined,
	ratio: number,
): ChildLayout | undefined {
	if (!lc) return undefined;
	const out: ChildLayout = {};
	// "fixed" (or unset) → omit so the resolver uses the node's own size.
	if (lc.width === "fill" || lc.width === "hug") out.width = lc.width;
	if (lc.height === "fill" || lc.height === "hug") out.height = lc.height;
	if (lc.grow !== undefined) out.grow = lc.grow;
	if (lc.align !== undefined) out.alignSelf = lc.align;
	if (lc.absolute) out.absolute = true;
	if (lc.min) {
		out.min = {
			width: lc.min.width !== undefined ? lc.min.width * ratio : undefined,
			height: lc.min.height !== undefined ? lc.min.height * ratio : undefined,
		};
	}
	if (lc.max) {
		out.max = {
			width: lc.max.width !== undefined ? lc.max.width * ratio : undefined,
			height: lc.max.height !== undefined ? lc.max.height * ratio : undefined,
		};
	}
	if (lc.column !== undefined) out.column = lc.column;
	if (lc.row !== undefined) out.row = lc.row;
	return Object.keys(out).length > 0 ? out : undefined;
}

// ─────────────── span normalization ───────────────

function normalizeTextSpans(props: Record<string, unknown>): TextSpanInput[] {
	const spans = props.spans as TextSpanInput[] | undefined;
	if (spans && spans.length > 0) return spans;
	return [{ text: String(props.value ?? "") }];
}

// Figma "Case": upper/lower/title on the resolved text.
function applyTextCase(spans: TextSpanInput[], mode: unknown): TextSpanInput[] {
	if (!isTextCase(mode)) return spans;
	let prev = "";
	return spans.map((s) => {
		const text = applyCase(s.text, mode, prev);
		prev = lastChar(s.text) || prev;
		return { ...s, text };
	});
}

function hasOverrides(span: TextSpanInput): boolean {
	if (span.color !== undefined) return true;
	const f = span.font;
	if (!f) return false;
	return (
		f.family !== undefined ||
		f.size !== undefined ||
		f.weight !== undefined ||
		f.style !== undefined ||
		f.letterSpacing !== undefined ||
		f.lineHeight !== undefined ||
		f.variations !== undefined ||
		f.features !== undefined
	);
}

// ─────────────── fills / strokes / shadows / clips ───────────────

type StrokeInput = {
	color: string | Gradient;
	width: number;
	dash?: number[];
	cap?: Stroke["cap"];
	join?: Stroke["join"];
	align?: Stroke["align"];
} & StrokeTrimInput;

function resolveStroke(
	stroke: StrokeInput | undefined,
	ratio: number,
): Stroke | undefined {
	if (!stroke) return undefined;
	const { color } = stroke;
	return {
		...(typeof color === "string"
			? { color }
			: {
					color: color.stops[0]?.color ?? "#000000",
					gradient: resolveFill(color, ratio) as GradientFill,
				}),
		width: stroke.width * ratio,
		dash: stroke.dash?.map((d) => d * ratio),
		cap: stroke.cap,
		join: stroke.join,
		align: stroke.align,
		...resolveStrokeTrim(stroke),
	};
}

function scaleShadow(
	shadow: Shadows | undefined,
	ratio: number,
): Shadows | undefined {
	if (!shadow) return undefined;
	if (Array.isArray(shadow)) return shadow.map((s) => scaleOne(s, ratio));
	return scaleOne(shadow, ratio);
}

function scaleOne(shadow: Shadow, ratio: number): Shadow {
	return {
		color: shadow.color,
		dx: shadow.dx * ratio,
		dy: shadow.dy * ratio,
		blur: shadow.blur * ratio,
		...(shadow.spread !== undefined ? { spread: shadow.spread * ratio } : {}),
		...(shadow.inset ? { inset: true } : {}),
	};
}

function resolveAdjust(adjust: ElementAdjust | undefined): Adjust | undefined {
	if (!adjust) return undefined;
	const out = buildAdjust(adjust);
	return Object.keys(out).length > 0 ? out : undefined;
}

// `focus` has been substituted by now, so a field-bound one arrives as "x,y".
function imageFraming(props: Record<string, unknown>): {
	focus?: Vec2;
	crop?: ImageCrop;
} {
	const focus = parseImageFocus(props.focus);
	const crop = props.crop as ImageCrop | undefined;
	return {
		...(focus ? { focus } : {}),
		...(crop ? { crop: { ...crop } } : {}),
	};
}

function resolveImageClip(
	cornerRadius: number | undefined,
	mask: ImageMaskInput | undefined,
	ratio: number,
): ShapeMask | undefined {
	if (mask !== undefined) {
		if (cornerRadius !== undefined) {
			console.warn(
				"coatfile: image has both `mask` and `cornerRadius` — using `mask`",
			);
		}
		if (mask === "circle") return { kind: "circle" };
		if (mask === "ellipse") return { kind: "ellipse" };
		if (mask.kind === "rounded-rect") {
			return { kind: "rounded-rect", radius: mask.radius * ratio };
		}
		if (mask.kind === "squircle") {
			return { kind: "squircle", radius: mask.radius * ratio };
		}
		return {
			kind: "polygon",
			sides: mask.sides,
			rotation: mask.rotation,
			...(mask.cornerRadius ? { cornerRadius: mask.cornerRadius * ratio } : {}),
		};
	}
	if (typeof cornerRadius === "number") {
		return { kind: "rounded-rect", radius: cornerRadius * ratio };
	}
	return undefined;
}

// Scales every numeric coordinate in an SVG path string by `ratio`.
// M/L/H/V/C/Q/Z subset (no arc — A's flag args need command-aware tokenizing).
// Path data the parser cannot read still renders as far as Skia can take it,
// scaled the only way available without knowing which numbers are lengths.
function scalePathString(d: string, ratio: number): string {
	if (ratio === 1) return d;
	try {
		return scalePathData(d, ratio);
	} catch {
		return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (n) => {
			const val = parseFloat(n) * ratio;
			return Number.isFinite(val) ? String(val) : n;
		});
	}
}

function scaleCorner(cr: unknown, ratio: number): CornerRadius | undefined {
	if (typeof cr === "number") return cr * ratio;
	if (
		Array.isArray(cr) &&
		cr.length === 4 &&
		cr.every((n) => typeof n === "number")
	)
		return [cr[0] * ratio, cr[1] * ratio, cr[2] * ratio, cr[3] * ratio];
	return undefined;
}

function resolveFills(
	fill: Fill | Fill[] | undefined,
	ratio: number,
): ResolvedFill[] | undefined {
	if (fill === undefined) return undefined;
	const arr = Array.isArray(fill) ? fill : [fill];
	const resolved: ResolvedFill[] = [];
	for (const f of arr) {
		const r = resolveFill(f, ratio);
		if (r !== undefined) resolved.push(r);
	}
	return resolved.length > 0 ? resolved : undefined;
}

function resolveFill(
	fill: Fill | undefined,
	ratio: number,
): ResolvedFill | undefined {
	if (fill === undefined) return undefined;
	if (typeof fill === "string") return { kind: "solid", color: fill };
	if (fill.kind === "pattern") {
		const { kind: _, pattern, ...params } = fill;
		const resolved = patternFill(pattern, params);
		return { ...resolved, scale: resolved.scale * ratio };
	}
	if (fill.kind === "linear") {
		// Explicit points place the gradient; `angle` is then only what a reader
		// that predates them draws.
		const { from, to } = linearPoints(fill);
		return {
			kind: "linear",
			stops: fill.stops,
			from: { x: from[0], y: from[1] },
			to: { x: to[0], y: to[1] },
			...(fill.spread ? { spread: fill.spread } : {}),
		};
	}
	if (fill.kind === "angular") {
		const c = fill.center ?? [0.5, 0.5];
		return {
			kind: "angular",
			stops: fill.stops,
			center: { x: c[0], y: c[1] },
			rotation: fill.rotation ?? 0,
		};
	}
	const c = fill.center ?? [0.5, 0.5];
	const radius = fill.radius ?? 0.5;
	return {
		kind: "radial",
		stops: fill.stops,
		center: { x: c[0], y: c[1] },
		radius,
		radiusY: fill.radiusY ?? radius,
		rotation: fill.rotation ?? 0,
		...(fill.focus ? { focus: { x: fill.focus[0], y: fill.focus[1] } } : {}),
		...(fill.focusRadius ? { focusRadius: fill.focusRadius } : {}),
		...(fill.spread ? { spread: fill.spread } : {}),
	};
}

function scaleVec(v: Vec2, r: number): Vec2 {
	return { x: v.x * r, y: v.y * r };
}
function scaleSize(s: Size, r: number): Size {
	return { width: s.width * r, height: s.height * r };
}
