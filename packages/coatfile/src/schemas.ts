import { z } from "zod";
import { FORMAT_MAJOR, formatVersionStatus } from "./format";
import { parseImageFocus } from "./image-focus";
import { tokenIds } from "./mustache";
import type {
	Element,
	FrameElement,
	FrameProperties,
	MaskElement,
} from "./types";

export const Vec2Schema = z.object({
	x: z.number(),
	y: z.number(),
});

export const SizeSchema = z.object({
	width: z.number(),
	height: z.number(),
});

export const BlendModeSchema = z.enum([
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
	"plus",
	"linear-burn",
]);

export const FontWeightSchema = z.union([
	z.literal(100),
	z.literal(200),
	z.literal(300),
	z.literal(400),
	z.literal(500),
	z.literal(600),
	z.literal(700),
	z.literal(800),
	z.literal(900),
]);

// Variable-font axis values keyed by OpenType tag: four characters, registered
// axes lowercase ("wdth", "opsz"), custom ones uppercase ("GRAD"). A `wght`
// entry overrides `weight`. A static face ignores them all.
export const FontVariationsSchema = z.record(
	z.string().regex(/^[A-Za-z0-9 ]{4}$/),
	z.number(),
);

// OpenType feature settings by tag: 1 on, 0 off, or an alternate's index.
export const FontFeaturesSchema = z.record(
	z.string().regex(/^[A-Za-z0-9 ]{4}$/),
	z.number().int().min(0),
);

export const FontFileSchema = z.object({
	weight: FontWeightSchema,
	style: z.enum(["normal", "italic"]).optional(),
	src: z.string(),
});

export const GoogleFontDescriptorSchema = z.object({
	kind: z.literal("google"),
	family: z.string(),
	url: z.string(),
});

export const FontsourceFontDescriptorSchema = z.object({
	kind: z.literal("fontsource"),
	family: z.string(),
	url: z.string(),
});

export const LocalFontDescriptorSchema = z.object({
	kind: z.literal("local"),
	family: z.string(),
	files: z.array(FontFileSchema),
});

export const FontDescriptorSchema = z.discriminatedUnion("kind", [
	GoogleFontDescriptorSchema,
	FontsourceFontDescriptorSchema,
	LocalFontDescriptorSchema,
]);

export const FieldDefinitionSchema = z.object({
	type: z.literal("string"),
	title: z.string().optional(),
	description: z.string().optional(),
	default: z.string().optional(),
	// "boolean" is a toggle whose value is the string "true" or "false".
	format: z.enum(["color", "url", "image", "longText", "boolean"]).optional(),
	maxLength: z.number().optional(),
	minLength: z.number().optional(),
	pattern: z
		.string()
		.describe(
			"JavaScript regular expression. Compiled with the u flag, or without flags when it only parses that way. A pattern invalid in both modes imposes no constraint.",
		)
		.optional(),
	readOnly: z.boolean().optional(),
	"x-widget": z.string().optional(),
	"x-source": z.enum(["user", "system", "order"]).optional(),
	"x-image-aspect": z.tuple([z.number(), z.number()]).optional(),
});

export const FieldsSchemaSchema = z.object({
	type: z.literal("object"),
	properties: z.record(z.string(), FieldDefinitionSchema),
	required: z.array(z.string()).optional(),
});

export const GradientStopSchema = z.object({
	offset: z.number(),
	color: z.string(),
});

// What paints past the last stop. Omitted means pad, the last color held.
export const GradientSpreadSchema = z.enum(["pad", "reflect", "repeat"]);

export const GradientSchema = z.union([
	z.object({
		kind: z.literal("linear"),
		// Degrees, 0 pointing right and 90 down, through the centre of the box.
		angle: z.number(),
		// Start and end points in fractions of the drawable's box. When both are
		// set they place the gradient and `angle` is only what a reader without
		// them draws, so a writer keeps it pointing along `to - from`. Either may
		// lie outside [0, 1]: a gradient can start beyond the box.
		from: z.tuple([z.number(), z.number()]).optional(),
		to: z.tuple([z.number(), z.number()]).optional(),
		stops: z.array(GradientStopSchema),
		spread: GradientSpreadSchema.optional(),
	}),
	z.object({
		kind: z.literal("radial"),
		center: z.tuple([z.number(), z.number()]).optional(),
		// How far the last stop sits from the center, as a fraction of the
		// drawable's LONGEST side. Omitted means 0.5, a gradient that just fills
		// the shape.
		radius: z.number().optional(),
		// Reach along the axis perpendicular to the primary one, same units.
		// Omitted means the gradient is circular; set, it is an ellipse — a glow
		// that spreads much further vertically than sideways, say.
		radiusY: z.number().optional(),
		// Degrees the primary axis is turned from +x. Only meaningful alongside
		// radiusY, since a circle looks the same at every angle.
		rotation: z.number().optional(),
		// Where the first stop sits, in the same units as `center`. Omitted means
		// the center.
		focus: z.tuple([z.number(), z.number()]).optional(),
		// Radius of the first stop's circle around `focus`, in the units of
		// `radius`. Omitted means 0.
		focusRadius: z.number().nonnegative().optional(),
		stops: z.array(GradientStopSchema),
		spread: GradientSpreadSchema.optional(),
	}),
	z.object({
		kind: z.literal("angular"),
		center: z.tuple([z.number(), z.number()]).optional(),
		rotation: z.number().optional(),
		stops: z.array(GradientStopSchema),
	}),
]);

export const FillSchema = z.union([
	z.string(),
	...GradientSchema.options,
	// A procedural texture drawn by a shader, in design units from the
	// drawable's top-left. Omitted parameters take the pattern's defaults.
	z.object({
		kind: z.literal("pattern"),
		pattern: z.enum(["noise", "paper", "hatching", "dots"]),
		// Feature size: grain, fibre length, line spacing or dot pitch.
		scale: z.number().positive().optional(),
		// Degrees, 0 pointing right and 90 down.
		angle: z.number().optional(),
		// How much of the second colour covers the first.
		density: z.number().min(0).max(1).optional(),
		seed: z.number().int().optional(),
		// Background, then ink.
		colors: z.tuple([z.string(), z.string()]).optional(),
	}),
]);

// A rect or path can carry one or many fills. They paint bottom-up
// (index 0 = furthest back), matching Figma's stacked-fill semantic.
export const FillsSchema = z.union([FillSchema, z.array(FillSchema)]);

const FontDescriptorObjectSchema = z.object({
	family: z.string().optional(),
	size: z.number().optional(),
	weight: FontWeightSchema.optional(),
	style: z.enum(["normal", "italic"]).optional(),
	letterSpacing: z.number().optional(),
	// A number, or "auto" — the font's own line box (ascent + descent + line
	// gap), which is what a design tool shows when nobody typed a value. Resolved
	// per family at render time; see freshcoat's line-height.
	lineHeight: z.union([z.number(), z.literal("auto")]).optional(),
	decoration: z.enum(["underline", "line-through"]).optional(),
	// Break an underline where glyphs cross it. Defaults to true.
	skipInk: z.boolean().optional(),
	// Merged over the element's own axes.
	variations: FontVariationsSchema.optional(),
	// Merged over the element's own features.
	features: FontFeaturesSchema.optional(),
});

// One styled segment within a mixed-style text element. Only the fields
// a span wants to override need to be present; everything else falls
// back to the element's default font + color.
export const TextSpanSchema = z.object({
	text: z.string(),
	font: FontDescriptorObjectSchema.optional(),
	color: z.string().optional(),
});

export const TextPropertiesSchema = z.object({
	// Single-style text.
	value: z.string().optional(),
	// Mixed-style text, per-span font + color, wrapped as one paragraph. When
	// set, wins over `value`.
	spans: z.array(TextSpanSchema).optional(),
	font: z.object({
		family: z.string(),
		size: z.number(),
		weight: FontWeightSchema.optional(),
		style: z.enum(["normal", "italic"]).optional(),
		letterSpacing: z.number().optional(),
		// A number, or "auto" — see FontDescriptorObjectSchema above.
		lineHeight: z.union([z.number(), z.literal("auto")]).optional(),
		decoration: z.enum(["underline", "line-through"]).optional(),
		skipInk: z.boolean().optional(),
		variations: FontVariationsSchema.optional(),
		features: FontFeaturesSchema.optional(),
	}),
	// Solid color; optional when a gradient `fill` is provided (compile defaults
	// to #000 when neither is set).
	color: z.string().optional(),
	// Optional gradient fill for the text (mapped to the element box). `color`
	// remains the solid fallback.
	fill: FillSchema.optional(),
	// start and end follow `direction`.
	align: z
		.enum(["left", "center", "right", "justify", "start", "end"])
		.optional(),
	// How a justified paragraph sets its last line. Default start.
	alignLast: z
		.enum(["left", "center", "right", "justify", "start", "end"])
		.optional(),
	// Extra space after each hard line break (a newline), in design units.
	paragraphSpacing: z.number().min(0).optional(),
	// Base direction for bidi ordering; auto takes the first strong character
	// of the resolved text. Default ltr.
	direction: z.enum(["ltr", "rtl", "auto"]).optional(),
	verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
	// shrink scales the font down until the text fits the box; with spans,
	// every span's size scales by the same factor.
	fit: z.enum(["shrink", "clip"]).optional(),
	// Figma "Case": transform applied to the RESOLVED text (after token
	// substitution), so it works on dynamic {{values}}. "original" (or absent)
	// leaves the text untouched.
	case: z.enum(["upper", "lower", "title", "original"]).optional(),
	// Figma "Vertical trim" (Cap height to baseline): anchor the cap height to
	// the text box top, trimming the first line's leading.
	leadingTrim: z.boolean().optional(),
	// Figma "Truncate text": cap the wrapped text at N lines, ellipsizing the
	// last line if content overflows.
	maxLines: z.number().int().positive().optional(),
	// Sets the text along a circle centered on the box, for seals and badges.
	// Each hard line is one ring and nothing wraps. Angles are degrees clockwise
	// from 12 o'clock.
	arc: z
		.object({
			// Baseline radius of the first ring, in design units. Absent keeps the
			// glyphs inside the box.
			radius: z.number().nonnegative().optional(),
			// Spreads each ring's glyphs across this many degrees.
			sweep: z.number().positive().max(360).optional(),
			// Where `align` anchors the ring. Default 0.
			startAngle: z.number().optional(),
			// outside reads clockwise, tops outward (the top of a seal); inside reads
			// counter-clockwise, tops inward (the bottom). Default outside.
			direction: z.enum(["outside", "inside"]).optional(),
			// Which part of the ring sits at startAngle. Default center.
			align: z.enum(["start", "center", "end"]).optional(),
			// "shrink" scales a ring longer than its circle down until it fits.
			// Without it, such a ring overlaps itself and the render warns.
			fit: z.literal("shrink").optional(),
		})
		.optional(),
	// Sets the text along a path, as SVG's <textPath>. Wins over `arc`. Each hard
	// line is one baseline below the last; nothing wraps. Glyphs that run past
	// an open path's ends, or a whole lap of a closed one, are hidden.
	path: z
		.object({
			// Path data in the element's own design units, or `ref`, the id of a
			// sibling vector. `d` wins when both are set.
			d: z.string().optional(),
			ref: z.string().optional(),
			// Where `align` anchors the text along the path: design units, or a
			// share of its length as "50%". Default 0.
			startOffset: z
				.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?%$/)])
				.optional(),
			// left follows the path's direction, right reverses it. Default left.
			side: z.enum(["left", "right"]).optional(),
			// Which part of the text sits at startOffset. Default start.
			align: z.enum(["start", "center", "end"]).optional(),
		})
		.refine((p) => p.d !== undefined || p.ref !== undefined, {
			message: "a text path needs `d` or `ref`",
		})
		.optional(),
});

export const ImageMaskSchema = z.union([
	z.literal("circle"),
	z.literal("ellipse"),
	z.object({ kind: z.literal("rounded-rect"), radius: z.number() }),
	z.object({
		kind: z.literal("polygon"),
		sides: z.number().int().min(3),
		rotation: z.number().optional(),
		cornerRadius: z.number().min(0).optional(),
	}),
	z.object({ kind: z.literal("squircle"), radius: z.number() }),
]);

// Shared stroke definition. `align` positions the stroke inside / outside /
// centered on the shape edge (Figma's stroke position); default center (Skia's
// native alignment). Every stroked element honors it.
export const StrokeSchema = z.object({
	// A solid colour, or a gradient placed in the element's box as a fill is.
	color: z.union([z.string(), ...GradientSchema.options]),
	width: z.number(),
	dash: z.array(z.number()).optional(),
	cap: z.enum(["butt", "round", "square"]).optional(),
	join: z.enum(["round", "bevel", "miter"]).optional(),
	align: z.enum(["inside", "outside", "center"]).optional(),
	// The drawn part of the outline as fractions of its length, and a rotation
	// of that part along it. A string binds a field, as "{{progress}}"; it
	// compiles to a number or, with a trailing %, a percentage.
	trimStart: z.union([z.number().min(0).max(1), z.string()]).optional(),
	trimEnd: z.union([z.number().min(0).max(1), z.string()]).optional(),
	trimOffset: z.union([z.number(), z.string()]).optional(),
});

// Fractions of the source image's width and height.
export const ImageCropSchema = z.object({
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
	width: z.number().gt(0).max(1),
	height: z.number().gt(0).max(1),
});

export const ImagePropertiesSchema = z.object({
	src: z.string(),
	fit: z.enum(["cover", "contain", "fill", "tile"]),
	// The point of the image, as [x, y] fractions of it, that `cover` keeps in
	// the middle of the box. A string is "x,y", so a field can carry a focal
	// point per record: "{{photo_focus}}". Default the centre.
	focus: z
		.union([
			z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
			z.string(),
		])
		.optional(),
	// The part of the source that is drawn, before `fit` places it. Ignored by
	// `tile`.
	crop: ImageCropSchema.optional(),
	cornerRadius: z.number().optional(),
	mask: ImageMaskSchema.optional(),
	stroke: StrokeSchema.optional(),
});

export const QrCodePropertiesSchema = z.object({
	value: z.string(),
	errorCorrection: z.enum(["L", "M", "Q", "H"]).optional(),
	foreground: z.string().optional(),
	background: z.string().optional(),
	margin: z.number().optional(),
});

export const SymbologySchema = z.enum([
	"code128",
	"ean13",
	"upca",
	"code39",
	"itf14",
	"pdf417",
	"datamatrix",
	"aztec",
]);

export const BearerBarsSchema = z.enum(["none", "frame", "horizontal"]);

export const BarcodePropertiesSchema = z.object({
	value: z.string(),
	symbology: SymbologySchema,
	foreground: z.string().optional(),
	background: z.string().optional(),
	// 1D only: the human-readable line under the bars. Default true.
	showText: z.boolean().optional(),
	// Design px. Default 14% of the element's height, at least 8.
	textSize: z.number().optional(),
	// Default the template's first font.
	fontFamily: z.string().optional(),
	// Modules each side, kept inside the box. Default the symbology's minimum.
	quietZone: z.number().min(0).optional(),
	// pdf417: level 0 to 8. aztec: percent 5 to 95. Ignored elsewhere.
	errorCorrection: z.number().optional(),
	// itf14 only. Default "none".
	bearerBars: BearerBarsSchema.optional(),
});

// Uniform radius or per-corner [topLeft, topRight, bottomRight, bottomLeft].
export const CornerRadiusSchema = z.union([
	z.number(),
	z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);

export const RectPropertiesSchema = z.object({
	fill: FillsSchema.optional(),
	stroke: StrokeSchema.optional(),
	cornerRadius: CornerRadiusSchema.optional(),
	// Figma corner smoothing in [0, 1]; renders a superellipse corner.
	cornerSmoothing: z.number().min(0).max(1).optional(),
});

export const VectorPropertiesSchema = z.object({
	// SVG path data, any number of subpaths, arcs included.
	d: z.string(),
	// Which regions of overlapping subpaths are inside; SVG's default is nonzero.
	fillRule: z.enum(["nonzero", "evenodd"]).optional(),
	// Rounds every corner between two straight segments by this radius.
	cornerRadius: z.number().min(0).optional(),
	fill: FillsSchema.optional(),
	stroke: StrokeSchema.optional(),
});

export const ShadowSchema = z.object({
	color: z.string(),
	dx: z.number(),
	dy: z.number(),
	blur: z.number(),
	// Figma's Spread / the third box-shadow length: grows the silhouette the
	// shadow is cast from before it is blurred (negative shrinks it).
	spread: z.number().optional(),
	// Figma's inner shadow / CSS `inset`: cast inward from the shape's own edges
	// instead of behind it.
	inset: z.boolean().optional(),
});

/** One shadow, or a stack painted bottom-up (last is nearest the viewer) — the
 *  same one-or-many shape a fill takes. */
export const ShadowsSchema = z.union([ShadowSchema, z.array(ShadowSchema)]);

const LayoutPaddingSchema = z.object({
	top: z.number().optional(),
	right: z.number().optional(),
	bottom: z.number().optional(),
	left: z.number().optional(),
});

export const FlexLayoutSchema = z.object({
	direction: z.enum(["row", "column"]),
	gap: z.number().optional(),
	padding: LayoutPaddingSchema.optional(),
	primaryAlign: z
		.enum([
			"start",
			"center",
			"end",
			"space-between",
			"space-around",
			"space-evenly",
		])
		.optional(),
	crossAlign: z.enum(["start", "center", "end", "stretch"]).optional(),
	wrap: z.boolean().optional(),
	crossGap: z.number().optional(),
});

// A track is a length in design px, "auto" (as wide or tall as its largest
// single-track child) or "<n>fr", a share of the space the others leave.
export const GridTrackSchema = z.union([
	z.number().min(0),
	z.literal("auto"),
	z.string().regex(/^(?:\d+(?:\.\d+)?|\.\d+)fr$/),
]);

// Children fill cells row by row unless their `layoutChild` names a column or
// row. Rows beyond `rows` are added as "auto".
export const GridLayoutSchema = z.object({
	type: z.literal("grid"),
	columns: z.array(GridTrackSchema).min(1),
	rows: z.array(GridTrackSchema).optional(),
	// One gap for both axes, or [row gap, column gap].
	gap: z
		.union([z.number().min(0), z.tuple([z.number().min(0), z.number().min(0)])])
		.optional(),
	padding: LayoutPaddingSchema.optional(),
});

export const LayoutSchema = z.union([FlexLayoutSchema, GridLayoutSchema]);

// A 1-based track, or an inclusive [first, last] span.
const GridLineSchema = z.union([
	z.number().int().min(1),
	z.tuple([z.number().int().min(1), z.number().int().min(1)]),
]);

export const LayoutChildSchema = z.object({
	width: z.enum(["fixed", "hug", "fill"]).optional(),
	height: z.enum(["fixed", "hug", "fill"]).optional(),
	grow: z.union([z.literal(0), z.literal(1)]).optional(),
	align: z.enum(["start", "center", "end", "stretch"]).optional(),
	absolute: z.boolean().optional(),
	min: z
		.object({ width: z.number().optional(), height: z.number().optional() })
		.optional(),
	max: z
		.object({ width: z.number().optional(), height: z.number().optional() })
		.optional(),
	// Grid placement; ignored in a flex layout.
	column: GridLineSchema.optional(),
	row: GridLineSchema.optional(),
});

// Per-layer tone. Each factor is 1 for no change; `sharpen` is 0 for none.
// `preserveHue` gives up saturation rather than hue when a boost pushes a
// colour out of range.
export const AdjustSchema = z.object({
	saturation: z.number().min(0).optional(),
	contrast: z.number().min(0).optional(),
	brightness: z.number().min(0).optional(),
	gamma: z.number().positive().optional(),
	sharpen: z.number().min(0).optional(),
	preserveHue: z.boolean().optional(),
});

// Shows an element only while a field is set (a boolean field is "true", any
// other field non-blank), or, with `equals`, while it has that exact value. `not`
// inverts either.
export const VisibilityConditionSchema = z.object({
	field: z.string(),
	equals: z.string().optional(),
	not: z.boolean().optional(),
});

// How an element follows its parent when the parent is laid out at a size
// other than the one it was designed at (compile's `resize`), per axis:
// keep the offset from the start or the end, keep the centre's offset from the
// parent's centre, keep both offsets and change size, or scale with the parent.
// Omitted is `start` on both axes, which is what an element has always done.
export const ConstraintSchema = z.enum([
	"start",
	"end",
	"center",
	"stretch",
	"scale",
]);

export const ConstraintsSchema = z.object({
	horizontal: ConstraintSchema.optional(),
	vertical: ConstraintSchema.optional(),
});

const elementShellShape = {
	id: z.string(),
	pos: Vec2Schema.optional(),
	size: SizeSchema.optional(),
	rotation: z.number().optional(),
	opacity: z.number().optional(),
	blendMode: BlendModeSchema.optional(),
	shadow: ShadowsSchema.optional(),
	blur: z.number().optional(),
	backdropBlur: z.number().min(0).optional(),
	adjust: AdjustSchema.optional(),
	layoutChild: LayoutChildSchema.optional(),
	constraints: ConstraintsSchema.optional(),
	// Several conditions must all hold.
	visibleWhen: z
		.union([VisibilityConditionSchema, z.array(VisibilityConditionSchema)])
		.optional(),
};

export const TextElementSchema = z.object({
	...elementShellShape,
	type: z.literal("text"),
	properties: TextPropertiesSchema,
});

export const ImageElementSchema = z.object({
	...elementShellShape,
	type: z.literal("image"),
	properties: ImagePropertiesSchema,
});

export const QrCodeElementSchema = z.object({
	...elementShellShape,
	type: z.literal("qr_code"),
	properties: QrCodePropertiesSchema,
});

export const BarcodeElementSchema = z.object({
	...elementShellShape,
	type: z.literal("barcode"),
	properties: BarcodePropertiesSchema,
});

export const RectElementSchema = z.object({
	...elementShellShape,
	type: z.literal("rect"),
	properties: RectPropertiesSchema,
});

export const VectorElementSchema = z.object({
	...elementShellShape,
	type: z.literal("vector"),
	properties: VectorPropertiesSchema,
});

// Non-frame leaf elements. Frames are added to the element union separately
// (FrameElementSchema) and may nest via FramePropertiesSchema.children.
export const LeafElementSchema = z.discriminatedUnion("type", [
	TextElementSchema,
	ImageElementSchema,
	QrCodeElementSchema,
	BarcodeElementSchema,
	RectElementSchema,
	VectorElementSchema,
]);

export const FrameElementSchema: z.ZodType<FrameElement> = z.lazy(() =>
	z.object({
		...elementShellShape,
		type: z.literal("frame"),
		properties: FramePropertiesSchema,
	}),
) as z.ZodType<FrameElement>;

export const FramePropertiesSchema: z.ZodType<FrameProperties> = z.lazy(() =>
	z.object({
		fill: FillsSchema.optional(),
		stroke: StrokeSchema.optional(),
		cornerRadius: CornerRadiusSchema.optional(),
		// Figma's `clipsContent`. When true, children are clipped to the frame,
		// honoring cornerRadius. An outside stroke stays unclipped.
		clipsContent: z.boolean().optional(),
		// Figma's Normal on a frame: children blend only with the frame's own
		// content. Unset is pass-through.
		isolate: z.boolean().optional(),
		layout: LayoutSchema.optional(),
		children: z.array(ElementSchema),
	}),
) as z.ZodType<FrameProperties>;

// `mask` and `children` are positioned relative to the mask element, as a
// frame's children are. A single opaque rect or ellipse mask renders as a clip;
// anything else (a path, an image's alpha, a gradient, text, luminance, invert)
// through an offscreen layer.
export const MaskElementSchema: z.ZodType<MaskElement> = z.lazy(() =>
	z.object({
		...elementShellShape,
		type: z.literal("mask"),
		properties: z.object({
			mask: ElementSchema,
			children: z.array(ElementSchema),
			channel: z.enum(["alpha", "luminance"]).optional(),
			invert: z.boolean().optional(),
		}),
	}),
) as z.ZodType<MaskElement>;

export const ElementSchema: z.ZodType<Element> = z.lazy(() =>
	z.union([LeafElementSchema, FrameElementSchema, MaskElementSchema]),
) as z.ZodType<Element>;

export const BackgroundSchema = z.discriminatedUnion("type", [
	RectElementSchema,
	ImageElementSchema,
]);

export const TemplateFrameSchema = z.object({
	name: z.string(),
	background: BackgroundSchema,
	elements: z.array(ElementSchema),
});

export const VariantSchema = z.object({
	id: z.string(),
	label: z.string(),
	swatch: z.string().optional(),
	// Drawn at this size, with the base laid out to it by its constraints.
	size: SizeSchema.optional(),
	overrides: z.array(
		z.object({
			name: z.string(),
			background: BackgroundSchema.optional(),
			elements: z
				.array(
					z.object({
						id: z.string(),
						// Required so a 1.3 reader accepts a 1.4 delta; `{}` when only
						// the shell changes.
						properties: z.record(z.string(), z.unknown()),
						pos: Vec2Schema.optional(),
						size: SizeSchema.optional(),
						rotation: z.number().optional(),
						opacity: z.number().min(0).max(1).optional(),
						// Leaves the element out of the variant.
						hidden: z.boolean().optional(),
					}),
				)
				.optional(),
		}),
	),
});

// ── Authoring extras ─────────────────────────────────────────────────────────
//
// Optional top-level fields an authoring tool fills in. A template without them
// renders identically; a consumer that ignores them draws the same picture.

/** A raster carried inside the template, addressed by the same sha256 an image
 *  element references through `asset:<sha256>`. See ./assets. */
export const InlineAssetSchema = z.object({
	sha256: z.string(),
	base64: z.string(),
	contentType: z.string(),
});

/** Something an export could not represent faithfully. Advisory — a template
 *  with `error` warnings still validates and still renders; a consumer surfaces
 *  them so the author can decide. */
export const TemplateWarningSchema = z.object({
	severity: z.enum(["info", "warn", "error"]),
	code: z.string(),
	message: z.string(),
	nodeId: z.string().optional(),
	slot: z.string().optional(),
});

/** Provenance. Only `kind` is fixed; every other key is preserved verbatim,
 *  because an exporter's vocabulary — file keys, node ids, component instances
 *  — belongs to that exporter and not to the format. */
export const TemplateSourceSchema = z.looseObject({ kind: z.string() });

/** An inset from each edge of the trim, in design units: one number for every
 *  side, or each side on its own. */
export const InsetsSchema = z.union([
	z.number(),
	z.object({
		top: z.number(),
		right: z.number(),
		bottom: z.number(),
		left: z.number(),
	}),
]);

export const TemplateSchema = z
	.object({
		$schema: z.string().optional(),
		format_version: z.string(),
		version: z.string().optional(),
		id: z.string(),
		name: z.string(),
		description: z.string().optional(),
		mood: z.string().optional(),
		author: z
			.object({
				name: z.string(),
				url: z.string().optional(),
			})
			.optional(),
		product: z.string().optional(),
		width: z.number(),
		height: z.number(),
		// Artwork past the trim, drawn when a render asks for it and cut away.
		bleed: InsetsSchema.optional(),
		// What must survive the cut. A guide only; it does not change a render.
		safeArea: InsetsSchema.optional(),
		fields: FieldsSchemaSchema,
		fonts: z.array(FontDescriptorSchema).optional(),
		template_data: z.array(TemplateFrameSchema),
		variants: z.array(VariantSchema).optional(),
		assets: z.array(InlineAssetSchema).optional(),
		source: TemplateSourceSchema.optional(),
		warnings: z.array(TemplateWarningSchema).optional(),
	})
	.superRefine(refineTemplate);

type ParsedTemplate = z.infer<typeof TemplateSchema>;

function refineTemplate(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	enforceFormatVersion(tpl, ctx);
	enforceRequiredStrings(tpl, ctx);
	enforceDimensions(tpl, ctx);
	enforceInsets(tpl, ctx);
	enforceTemplateDataNonEmpty(tpl, ctx);
	enforceFrameNameUniqueness(tpl, ctx);
	enforceBackgroundFrameFill(tpl, ctx);
	enforceElementIdUniqueness(tpl, ctx);
	enforceVariantIdUniqueness(tpl, ctx);
	enforceVariantSizes(tpl, ctx);
	enforceVariantOverrideFrameResolution(tpl, ctx);
	enforceMustacheReferences(tpl, ctx);
	enforceVisibilityReferences(tpl, ctx);
	enforceBooleanDefaults(tpl, ctx);
	enforceGradientStops(tpl, ctx);
	enforceGradientPoints(tpl, ctx);
	enforceFontsBlock(tpl, ctx);
	enforceGridPlacement(tpl, ctx);
	enforceImageFraming(tpl, ctx);
	// Font references are lax: a partial fonts block is allowed; undeclared families fall back at render.
}

function addKitIssue(
	ctx: z.RefinementCtx,
	kitCode: string,
	message: string,
	path: (string | number)[],
) {
	ctx.addIssue({
		code: "custom",
		message,
		path,
		params: { kitCode },
	});
}

function enforceFormatVersion(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	const fv = tpl.format_version;
	if (typeof fv !== "string" || fv.length === 0) {
		addKitIssue(
			ctx,
			"missing_format_version",
			"format_version must be a string",
			["format_version"],
		);
		return;
	}
	if (formatVersionStatus(fv) === "unsupported") {
		addKitIssue(
			ctx,
			"unsupported_format_version",
			`format_version ${fv} not supported by this kit version (expected ${FORMAT_MAJOR}.x)`,
			["format_version"],
		);
	}
}

function enforceRequiredStrings(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	for (const key of ["id", "name"] as const) {
		if (typeof tpl[key] !== "string" || tpl[key].length === 0) {
			addKitIssue(ctx, "missing_required_field", `${key} is required`, [key]);
		}
	}
	// Optional since 1.1, but a key that is present still has to say something.
	for (const key of ["version", "product"] as const) {
		if (tpl[key] !== undefined && tpl[key].length === 0) {
			addKitIssue(ctx, "empty_optional_field", `${key} must not be empty`, [
				key,
			]);
		}
	}
}

function enforceDimensions(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	if (!Number.isInteger(tpl.width) || tpl.width <= 0) {
		addKitIssue(ctx, "invalid_dimension", "width must be a positive integer", [
			"width",
		]);
	}
	if (!Number.isInteger(tpl.height) || tpl.height <= 0) {
		addKitIssue(ctx, "invalid_dimension", "height must be a positive integer", [
			"height",
		]);
	}
}

function enforceVariantSizes(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	tpl.variants?.forEach((v, vi) => {
		if (!v.size) return;
		for (const key of ["width", "height"] as const) {
			const n = v.size[key];
			if (Number.isInteger(n) && n > 0) continue;
			addKitIssue(
				ctx,
				"invalid_dimension",
				`variant size ${key} must be a positive integer`,
				["variants", vi, "size", key],
			);
		}
	});
}

function enforceInsets(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	for (const key of ["bleed", "safeArea"] as const) {
		const value = tpl[key];
		if (value === undefined) continue;
		const sides =
			typeof value === "number"
				? { top: value, right: value, bottom: value, left: value }
				: value;
		const entries: [string | undefined, number][] =
			typeof value === "number" ? [[undefined, value]] : Object.entries(value);
		let valid = true;
		for (const [side, n] of entries) {
			if (Number.isFinite(n) && n >= 0) continue;
			valid = false;
			addKitIssue(
				ctx,
				"invalid_inset",
				`${key} must be a non-negative number`,
				side === undefined ? [key] : [key, side],
			);
		}
		if (
			valid &&
			key === "safeArea" &&
			(sides.left + sides.right >= tpl.width ||
				sides.top + sides.bottom >= tpl.height)
		) {
			addKitIssue(
				ctx,
				"safe_area_exceeds_trim",
				"safeArea must leave room inside the trim",
				[key],
			);
		}
	}
}

function enforceTemplateDataNonEmpty(
	tpl: ParsedTemplate,
	ctx: z.RefinementCtx,
) {
	if (tpl.template_data.length === 0) {
		addKitIssue(ctx, "empty_template_data", "template_data must not be empty", [
			"template_data",
		]);
	}
}

function enforceFrameNameUniqueness(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	const seen = new Set<string>();
	tpl.template_data.forEach((frame, idx) => {
		if (typeof frame.name !== "string" || frame.name.length === 0) {
			addKitIssue(ctx, "missing_frame_name", "frame.name is required", [
				"template_data",
				idx,
				"name",
			]);
		} else if (seen.has(frame.name)) {
			addKitIssue(
				ctx,
				"duplicate_frame_name",
				`duplicate frame name "${frame.name}"`,
				["template_data", idx, "name"],
			);
		} else {
			seen.add(frame.name);
		}
	});
}

function enforceBackgroundFrameFill(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	tpl.template_data.forEach((frame, idx) => {
		const bg = frame.background as {
			pos?: { x?: number; y?: number };
			size?: { width?: number; height?: number };
		};
		if (bg.pos !== undefined && (bg.pos.x !== 0 || bg.pos.y !== 0)) {
			addKitIssue(
				ctx,
				"background_must_fill_frame",
				"background.pos must be {x:0, y:0} or absent",
				["template_data", idx, "background", "pos"],
			);
		}
		if (
			bg.size !== undefined &&
			(bg.size.width !== tpl.width || bg.size.height !== tpl.height)
		) {
			addKitIssue(
				ctx,
				"background_must_fill_frame",
				"background.size must match template dimensions or be absent",
				["template_data", idx, "background", "size"],
			);
		}
	});
}

function enforceElementIdUniqueness(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	tpl.template_data.forEach((frame, idx) => {
		const seen = new Set<string>();
		frame.elements.forEach((el, ei) => {
			if (typeof el.id !== "string" || el.id.length === 0) {
				addKitIssue(ctx, "missing_element_id", "element.id is required", [
					"template_data",
					idx,
					"elements",
					ei,
					"id",
				]);
			} else if (seen.has(el.id)) {
				addKitIssue(
					ctx,
					"duplicate_element_id",
					`duplicate element id "${el.id}"`,
					["template_data", idx, "elements", ei, "id"],
				);
			} else {
				seen.add(el.id);
			}
		});
	});
}

function enforceVariantIdUniqueness(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	if (!tpl.variants) return;
	const seen = new Set<string>();
	tpl.variants.forEach((v, vi) => {
		if (typeof v.id !== "string" || v.id.length === 0) {
			addKitIssue(ctx, "missing_variant_id", "variant.id is required", [
				"variants",
				vi,
				"id",
			]);
		} else if (seen.has(v.id)) {
			addKitIssue(
				ctx,
				"duplicate_variant_id",
				`duplicate variant id "${v.id}"`,
				["variants", vi, "id"],
			);
		} else {
			seen.add(v.id);
		}
		if (typeof v.label !== "string") {
			addKitIssue(ctx, "missing_variant_label", "variant.label is required", [
				"variants",
				vi,
				"label",
			]);
		}
	});
}

function enforceVariantOverrideFrameResolution(
	tpl: ParsedTemplate,
	ctx: z.RefinementCtx,
) {
	if (!tpl.variants) return;
	const knownFrames = new Set(
		tpl.template_data
			.map((f) => f.name)
			.filter((n): n is string => typeof n === "string"),
	);
	tpl.variants.forEach((v, vi) => {
		const seenOverrideNames = new Set<string>();
		v.overrides.forEach((ov, oi) => {
			const opath = ["variants", vi, "overrides", oi] as (string | number)[];
			if (typeof ov.name !== "string") {
				addKitIssue(ctx, "missing_override_name", "override.name is required", [
					...opath,
					"name",
				]);
				return;
			}
			if (!knownFrames.has(ov.name)) {
				addKitIssue(
					ctx,
					"unknown_frame_name",
					`override targets unknown frame "${ov.name}"`,
					[...opath, "name"],
				);
			}
			if (seenOverrideNames.has(ov.name)) {
				addKitIssue(
					ctx,
					"duplicate_override_name",
					`duplicate override for frame "${ov.name}"`,
					[...opath, "name"],
				);
			} else {
				seenOverrideNames.add(ov.name);
			}
		});
	});
}

function enforceMustacheReferences(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	const known = new Set(Object.keys(tpl.fields.properties));
	const path: (string | number)[] = [];

	function walk(value: unknown) {
		if (typeof value === "string") {
			for (const id of tokenIds(value)) {
				if (!known.has(id)) {
					addKitIssue(
						ctx,
						"unknown_field_reference",
						`mustache reference {{${id}}} has no matching field`,
						[...path],
					);
				}
			}
			return;
		}
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				path.push(i);
				walk(value[i]);
				path.pop();
			}
			return;
		}
		if (value !== null && typeof value === "object") {
			for (const k in value) {
				if (!Object.hasOwn(value, k)) continue;
				path.push(k);
				walk((value as Record<string, unknown>)[k]);
				path.pop();
			}
		}
	}

	function walkFrom(value: unknown, start: (string | number)[]) {
		path.length = 0;
		path.push(...start);
		walk(value);
	}

	walkFrom(tpl.template_data, ["template_data"]);
	tpl.variants?.forEach((v, vi) => {
		v.overrides.forEach((ov, oi) => {
			const at = ["variants", vi, "overrides", oi];
			if (ov.background !== undefined)
				walkFrom(ov.background, [...at, "background"]);
			if (ov.elements !== undefined) walkFrom(ov.elements, [...at, "elements"]);
		});
	});
}

function enforceVisibilityReferences(
	tpl: ParsedTemplate,
	ctx: z.RefinementCtx,
) {
	const known = new Set(Object.keys(tpl.fields.properties));
	function walk(elements: unknown[], path: (string | number)[]) {
		elements.forEach((raw, i) => {
			const el = raw as {
				visibleWhen?: { field: string } | { field: string }[];
				properties?: { children?: unknown[] };
			};
			const when = el.visibleWhen;
			const conds = when ? (Array.isArray(when) ? when : [when]) : [];
			conds.forEach((c, ci) => {
				if (!known.has(c.field)) {
					addKitIssue(
						ctx,
						"unknown_field_reference",
						`visibleWhen names "${c.field}", which has no matching field`,
						[...path, i, "visibleWhen", ...(Array.isArray(when) ? [ci] : [])],
					);
				}
			});
			if (Array.isArray(el.properties?.children))
				walk(el.properties.children, [...path, i, "properties", "children"]);
		});
	}
	tpl.template_data.forEach((frame, fi) => {
		walk(frame.elements, ["template_data", fi, "elements"]);
	});
}

function enforceBooleanDefaults(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	for (const [id, def] of Object.entries(tpl.fields.properties)) {
		if (def.format !== "boolean" || def.default === undefined) continue;
		if (def.default !== "true" && def.default !== "false") {
			addKitIssue(
				ctx,
				"invalid_boolean_default",
				`${id} is a boolean field; its default must be "true" or "false"`,
				["fields", "properties", id, "default"],
			);
		}
	}
}

function enforceGradientStops(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	function check(fill: unknown, path: (string | number)[], stroke = false) {
		if (typeof fill === "string" || fill == null) return;
		if (Array.isArray(fill) && !stroke) {
			fill.forEach((f, i) => check(f, [...path, i]));
			return;
		}
		const f = fill as { kind?: unknown; stops?: unknown };
		if (f.kind === "pattern" && !stroke) return;
		if (f.kind !== "linear" && f.kind !== "radial" && f.kind !== "angular") {
			addKitIssue(
				ctx,
				"invalid_fill_kind",
				stroke
					? 'stroke color must be a string or a "linear", "radial" or "angular" gradient'
					: 'fill.kind must be "linear", "radial", "angular" or "pattern"',
				[...path, "kind"],
			);
			return;
		}
		if (!Array.isArray(f.stops) || f.stops.length < 2) {
			addKitIssue(
				ctx,
				"gradient_needs_two_stops",
				"gradient fill must have at least 2 stops",
				[...path, "stops"],
			);
			return;
		}
		f.stops.forEach((s, i) => {
			const stop = s as { offset?: unknown; color?: unknown };
			if (
				typeof stop.offset !== "number" ||
				stop.offset < 0 ||
				stop.offset > 1
			) {
				addKitIssue(
					ctx,
					"invalid_stop_offset",
					"stop.offset must be in [0, 1]",
					[...path, "stops", i, "offset"],
				);
			}
			if (typeof stop.color !== "string") {
				addKitIssue(ctx, "invalid_stop_color", "stop.color must be a string", [
					...path,
					"stops",
					i,
					"color",
				]);
			}
		});
	}

	walkObjects(tpl, (obj, path) => {
		const fill = obj.fill;
		if (typeof fill !== "string" && fill != null) check(fill, [...path, "fill"]);
		const stroke = obj.stroke as { color?: unknown } | null | undefined;
		if (stroke && typeof stroke === "object")
			check(stroke.color, [...path, "stroke", "color"], true);
	});
}

// A linear gradient whose start and end coincide has no direction to paint
// along. Every fill in the document is reached, nested or overridden, since
// the check only ever fires on points a writer set.
function enforceGradientPoints(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	walkObjects(tpl, (obj, path) => {
		const f = obj as { kind?: unknown; from?: unknown; to?: unknown };
		if (
			f.kind === "linear" &&
			Array.isArray(f.from) &&
			Array.isArray(f.to) &&
			f.from[0] === f.to[0] &&
			f.from[1] === f.to[1]
		) {
			addKitIssue(
				ctx,
				"gradient_degenerate",
				"linear gradient `from` and `to` must be different points",
				[...path, "to"],
			);
		}
	});
}

function walkObjects(
	tpl: ParsedTemplate,
	visit: (obj: Record<string, unknown>, path: (string | number)[]) => void,
) {
	const path: (string | number)[] = [];
	function walk(value: unknown) {
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				path.push(i);
				walk(value[i]);
				path.pop();
			}
			return;
		}
		if (value === null || typeof value !== "object") return;
		const obj = value as Record<string, unknown>;
		visit(obj, path);
		for (const k in obj) {
			if (!Object.hasOwn(obj, k)) continue;
			path.push(k);
			walk(obj[k]);
			path.pop();
		}
	}
	path.push("template_data");
	walk(tpl.template_data);
	path.length = 0;
	if (tpl.variants) {
		path.push("variants");
		walk(tpl.variants);
	}
}

function enforceFontsBlock(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	if (!tpl.fonts) return;
	const seenFamilies = new Set<string>();
	tpl.fonts.forEach((entry, i) => {
		const path = ["fonts", i] as (string | number)[];
		if (typeof entry.family !== "string" || entry.family.length === 0) {
			addKitIssue(ctx, "font_family_required", "font.family is required", [
				...path,
				"family",
			]);
		} else if (seenFamilies.has(entry.family)) {
			addKitIssue(
				ctx,
				"duplicate_font_family",
				`duplicate font family "${entry.family}"`,
				[...path, "family"],
			);
		} else {
			seenFamilies.add(entry.family);
		}
		if (entry.kind === "google" || entry.kind === "fontsource") {
			if (typeof entry.url !== "string" || entry.url.length === 0) {
				addKitIssue(
					ctx,
					"stylesheet_font_url_required",
					`${entry.kind} font url is required`,
					[...path, "url"],
				);
			}
			return;
		}
		if (entry.kind === "local") {
			if (!Array.isArray(entry.files) || entry.files.length === 0) {
				addKitIssue(
					ctx,
					"local_font_files_required",
					"local font requires at least one file entry",
					[...path, "files"],
				);
				return;
			}
			entry.files.forEach((f, fi) => {
				if (typeof f.src !== "string" || f.src.length === 0) {
					addKitIssue(
						ctx,
						"local_font_file_src_required",
						"local font file.src is required",
						[...path, "files", fi, "src"],
					);
				}
			});
		}
	});
}

type ElementVisitor = (
	el: { type?: unknown; properties?: unknown; layoutChild?: unknown },
	path: (string | number)[],
	parentLayout: unknown,
) => void;

function walkElements(tpl: ParsedTemplate, visit: ElementVisitor) {
	function walk(raw: unknown, path: (string | number)[], parentLayout: unknown) {
		const el = raw as Parameters<ElementVisitor>[0] & {
			properties?: { children?: unknown[]; mask?: unknown; layout?: unknown };
		};
		visit(el, path, parentLayout);
		const props = el.properties;
		if (!props) return;
		if (el.type === "mask" && props.mask !== undefined)
			walk(props.mask, [...path, "properties", "mask"], null);
		if (Array.isArray(props.children)) {
			const layout = el.type === "frame" ? props.layout : null;
			props.children.forEach((child, i) => {
				walk(child, [...path, "properties", "children", i], layout);
			});
		}
	}
	tpl.template_data.forEach((frame, fi) => {
		walk(frame.background, ["template_data", fi, "background"], null);
		frame.elements.forEach((el, ei) => {
			walk(el, ["template_data", fi, "elements", ei], null);
		});
	});
}

// A grid child's column span has to lie within the columns the grid declares.
// Rows past the declared ones are added as needed, so a row only has to run
// forwards.
function enforceGridPlacement(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	walkElements(tpl, (el, path, parentLayout) => {
		const lc = el.layoutChild as
			| { column?: number | [number, number]; row?: number | [number, number] }
			| undefined;
		const grid = parentLayout as
			| { type?: unknown; columns?: unknown[] }
			| null
			| undefined;
		if (!lc || grid?.type !== "grid" || !Array.isArray(grid.columns)) return;
		const columns = grid.columns.length;
		const check = (
			axis: "column" | "row",
			value: number | [number, number] | undefined,
			max: number,
		) => {
			if (value === undefined) return;
			const [first, last] = typeof value === "number" ? [value, value] : value;
			if (last < first) {
				addKitIssue(
					ctx,
					"grid_span_reversed",
					`layoutChild.${axis} ends before it starts`,
					[...path, "layoutChild", axis],
				);
			} else if (last > max) {
				addKitIssue(
					ctx,
					"grid_span_out_of_range",
					`layoutChild.${axis} reaches track ${last}, but the grid has ${max}`,
					[...path, "layoutChild", axis],
				);
			}
		};
		check("column", lc.column, columns);
		check("row", lc.row, Number.POSITIVE_INFINITY);
	});
}

// A crop has to stay inside the image, and a focal point written as text
// without a {{field}} has to read as one.
function enforceImageFraming(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	walkElements(tpl, (el, path) => {
		if (el.type !== "image") return;
		const props = el.properties as {
			focus?: unknown;
			crop?: { x: number; y: number; width: number; height: number };
		};
		const crop = props.crop;
		if (
			crop &&
			(crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9)
		) {
			addKitIssue(
				ctx,
				"image_crop_out_of_range",
				"crop must lie inside the image: x + width and y + height at most 1",
				[...path, "properties", "crop"],
			);
		}
		if (
			typeof props.focus === "string" &&
			!props.focus.includes("{{") &&
			parseImageFocus(props.focus) === undefined
		) {
			addKitIssue(
				ctx,
				"invalid_image_focus",
				'focus text must be "x,y" with both in [0, 1], or reference a field',
				[...path, "properties", "focus"],
			);
		}
	});
}
