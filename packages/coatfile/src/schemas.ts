import { z } from "zod";
import { FORMAT_MAJOR, formatVersionStatus } from "./format";
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
	pattern: z.string().optional(),
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

export const FillSchema = z.union([
	z.string(),
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
		stops: z.array(GradientStopSchema),
	}),
	z.object({
		kind: z.literal("angular"),
		center: z.tuple([z.number(), z.number()]).optional(),
		rotation: z.number().optional(),
		stops: z.array(GradientStopSchema),
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
	// Merged over the element's own axes.
	variations: FontVariationsSchema.optional(),
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
	// Single-style text. The only form `fit: "shrink"` applies to.
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
		variations: FontVariationsSchema.optional(),
	}),
	// Solid color; optional when a gradient `fill` is provided (compile defaults
	// to #000 when neither is set).
	color: z.string().optional(),
	// Optional gradient fill for the text (mapped to the element box). `color`
	// remains the solid fallback.
	fill: FillSchema.optional(),
	align: z.enum(["left", "center", "right", "justify"]).optional(),
	// How a justified paragraph sets its last line. Default left.
	alignLast: z.enum(["left", "center", "right", "justify"]).optional(),
	verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
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
});

export const ImageMaskSchema = z.union([
	z.literal("circle"),
	z.literal("ellipse"),
	z.object({ kind: z.literal("rounded-rect"), radius: z.number() }),
	z.object({
		kind: z.literal("polygon"),
		sides: z.number().int().min(3),
		rotation: z.number().optional(),
	}),
	z.object({ kind: z.literal("squircle"), radius: z.number() }),
]);

// Shared stroke definition. `align` positions the stroke inside / outside /
// centered on the shape edge (Figma's stroke position); default center (Skia's
// native alignment). align currently renders for rects; other shapes use center.
export const StrokeSchema = z.object({
	color: z.string(),
	width: z.number(),
	dash: z.array(z.number()).optional(),
	cap: z.enum(["butt", "round", "square"]).optional(),
	join: z.enum(["round", "bevel", "miter"]).optional(),
	align: z.enum(["inside", "outside", "center"]).optional(),
});

export const ImagePropertiesSchema = z.object({
	src: z.string(),
	fit: z.enum(["cover", "contain", "fill", "tile"]),
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

export const LayoutSchema = z.object({
	direction: z.enum(["row", "column"]),
	gap: z.number().optional(),
	padding: z
		.object({
			top: z.number().optional(),
			right: z.number().optional(),
			bottom: z.number().optional(),
			left: z.number().optional(),
		})
		.optional(),
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
		cornerRadius: z.number().optional(),
		// Figma's `clipsContent`. When true, children are clipped to the frame
		// (rounded-rect if cornerRadius set, plain rect otherwise).
		clipsContent: z.boolean().optional(),
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

const REF = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function refineTemplate(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	enforceFormatVersion(tpl, ctx);
	enforceRequiredStrings(tpl, ctx);
	enforceDimensions(tpl, ctx);
	enforceTemplateDataNonEmpty(tpl, ctx);
	enforceFrameNameUniqueness(tpl, ctx);
	enforceBackgroundFrameFill(tpl, ctx);
	enforceElementIdUniqueness(tpl, ctx);
	enforceVariantIdUniqueness(tpl, ctx);
	enforceVariantOverrideFrameResolution(tpl, ctx);
	enforceMustacheReferences(tpl, ctx);
	enforceVisibilityReferences(tpl, ctx);
	enforceBooleanDefaults(tpl, ctx);
	enforceGradientStops(tpl, ctx);
	enforceGradientPoints(tpl, ctx);
	enforceFontsBlock(tpl, ctx);
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

	function walk(value: unknown, path: (string | number)[]) {
		if (typeof value === "string") {
			const re = new RegExp(REF.source, "g");
			let m: RegExpExecArray | null;
			while ((m = re.exec(value)) !== null) {
				const id = m[1]!;
				if (!known.has(id)) {
					addKitIssue(
						ctx,
						"unknown_field_reference",
						`mustache reference {{${id}}} has no matching field`,
						path,
					);
				}
			}
			return;
		}
		if (Array.isArray(value)) {
			value.forEach((v, i) => walk(v, [...path, i]));
			return;
		}
		if (value !== null && typeof value === "object") {
			for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
		}
	}

	walk(tpl.template_data, ["template_data"]);
	tpl.variants?.forEach((v, vi) => {
		v.overrides.forEach((ov, oi) => {
			const path = ["variants", vi, "overrides", oi];
			if (ov.background !== undefined)
				walk(ov.background, [...path, "background"]);
			if (ov.elements !== undefined) walk(ov.elements, [...path, "elements"]);
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
	function check(fill: unknown, path: (string | number)[]) {
		if (typeof fill === "string" || fill == null) return;
		if (Array.isArray(fill)) {
			fill.forEach((f, i) => check(f, [...path, i]));
			return;
		}
		const f = fill as { kind?: unknown; stops?: unknown };
		if (f.kind !== "linear" && f.kind !== "radial" && f.kind !== "angular") {
			addKitIssue(
				ctx,
				"invalid_fill_kind",
				'fill.kind must be "linear", "radial", or "angular"',
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

	tpl.template_data.forEach((frame, fi) => {
		const bg = frame.background as {
			type?: string;
			properties?: { fill?: unknown };
		};
		if (bg.type === "rect" && bg.properties?.fill !== undefined) {
			check(bg.properties.fill, [
				"template_data",
				fi,
				"background",
				"properties",
				"fill",
			]);
		}
		frame.elements.forEach((el, ei) => {
			if (el.type === "rect") {
				const props = el.properties as { fill?: unknown };
				if (props.fill !== undefined) {
					check(props.fill, [
						"template_data",
						fi,
						"elements",
						ei,
						"properties",
						"fill",
					]);
				}
			}
		});
	});
}

// A linear gradient whose start and end coincide has no direction to paint
// along. Every fill in the document is reached, nested or overridden, since
// the check only ever fires on points a writer set.
function enforceGradientPoints(tpl: ParsedTemplate, ctx: z.RefinementCtx) {
	function walk(value: unknown, path: (string | number)[]) {
		if (Array.isArray(value)) {
			value.forEach((v, i) => walk(v, [...path, i]));
			return;
		}
		if (value === null || typeof value !== "object") return;
		const f = value as { kind?: unknown; from?: unknown; to?: unknown };
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
		for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
	}
	walk(tpl.template_data, ["template_data"]);
	if (tpl.variants) walk(tpl.variants, ["variants"]);
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
