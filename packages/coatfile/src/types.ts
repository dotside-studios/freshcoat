import type {
	BlendMode,
	FontRequest,
	GroupNode,
	PaintWarning,
	Shadows,
	Size,
	Vec2,
} from "@freshcoat-js/engine";
import type { z } from "zod";
import type {
	AdjustSchema,
	BackgroundSchema,
	BarcodeElementSchema,
	BarcodePropertiesSchema,
	ConstraintSchema,
	ConstraintsSchema,
	CornerRadiusSchema,
	FieldDefinitionSchema,
	FieldsSchemaSchema,
	FillSchema,
	FlexLayoutSchema,
	GridLayoutSchema,
	GridTrackSchema,
	ImageElementSchema,
	ImagePropertiesSchema,
	InlineAssetSchema,
	InsetsSchema,
	LayoutChildSchema,
	LayoutSchema,
	LeafElementSchema,
	QrCodeElementSchema,
	QrCodePropertiesSchema,
	RectElementSchema,
	RectPropertiesSchema,
	SymbologySchema,
	StrokeSchema,
	TemplateFrameSchema,
	TemplateSchema,
	TemplateSourceSchema,
	TemplateWarningSchema,
	TextElementSchema,
	TextPropertiesSchema,
	VariantSchema,
	VectorElementSchema,
	VectorPropertiesSchema,
	VisibilityConditionSchema,
} from "./schemas";

// The render vocabulary (geometry primitives, the Frame/Command IR, the resolved
// style types, and the paint runtime contract) lives in freshcoat. Re-export
// it so `@freshcoat-js/coatfile` consumers keep importing those types from the barrel,
// and so this module's own `./types` importers resolve them unchanged.
export type * from "@freshcoat-js/engine";

// ── Authoring types (zod-inferred from ./schemas) ────────────────────────────

export type FieldFormat = NonNullable<
	z.infer<typeof FieldDefinitionSchema>["format"]
>;
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;
export type FieldsSchema = z.infer<typeof FieldsSchemaSchema>;

export type Fill = z.infer<typeof FillSchema>;

export type TextProperties = z.infer<typeof TextPropertiesSchema>;
export type ImageProperties = z.infer<typeof ImagePropertiesSchema>;
export type QrCodeProperties = z.infer<typeof QrCodePropertiesSchema>;
export type BarcodeProperties = z.infer<typeof BarcodePropertiesSchema>;
export type Symbology = z.infer<typeof SymbologySchema>;
export type RectProperties = z.infer<typeof RectPropertiesSchema>;
export type VectorProperties = z.infer<typeof VectorPropertiesSchema>;

export type TextElement = z.infer<typeof TextElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type QrCodeElement = z.infer<typeof QrCodeElementSchema>;
export type BarcodeElement = z.infer<typeof BarcodeElementSchema>;
export type RectElement = z.infer<typeof RectElementSchema>;
export type VectorElement = z.infer<typeof VectorElementSchema>;

export type VisibilityCondition = z.infer<typeof VisibilityConditionSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type FrameFlexLayout = z.infer<typeof FlexLayoutSchema>;
export type FrameGridLayout = z.infer<typeof GridLayoutSchema>;
export type GridTrack = z.infer<typeof GridTrackSchema>;
export type ElementAdjust = z.infer<typeof AdjustSchema>;
export type LayoutChild = z.infer<typeof LayoutChildSchema>;
export type Constraint = z.infer<typeof ConstraintSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export type LeafElement = z.infer<typeof LeafElementSchema>;

export interface FrameProperties {
	fill?: Fill | Fill[];
	stroke?: z.infer<typeof StrokeSchema>;
	cornerRadius?: z.infer<typeof CornerRadiusSchema>;
	clipsContent?: boolean;
	layout?: Layout;
	children: Element[];
}

export interface FrameElement extends ElementShell {
	type: "frame";
	properties: FrameProperties;
}

export interface MaskProperties {
	// The coverage source, positioned like a child. Its alpha (or luminance)
	// decides how much of `children` shows.
	mask: Element;
	children: Element[];
	channel?: "alpha" | "luminance";
	invert?: boolean;
}

export interface MaskElement extends ElementShell {
	type: "mask";
	properties: MaskProperties;
}

export type Element = LeafElement | FrameElement | MaskElement;
export type Background = z.infer<typeof BackgroundSchema>;

export type ElementType = Element["type"];

export interface ElementShell {
	id: string;
	pos?: Vec2;
	size?: Size;
	rotation?: number;
	opacity?: number;
	blendMode?: BlendMode;
	shadow?: Shadows;
	blur?: number;
	adjust?: ElementAdjust;
	layoutChild?: LayoutChild;
	constraints?: Constraints;
	visibleWhen?: VisibilityCondition | VisibilityCondition[];
}

export type ECLevel = "L" | "M" | "Q" | "H";

export type InlineAsset = z.infer<typeof InlineAssetSchema>;
export type Insets = z.infer<typeof InsetsSchema>;
/** An inset resolved to each side. */
export type Sides = {
	top: number;
	right: number;
	bottom: number;
	left: number;
};
export type TemplateWarning = z.infer<typeof TemplateWarningSchema>;
export type TemplateSource = z.infer<typeof TemplateSourceSchema>;

export type TemplateFrame = z.infer<typeof TemplateFrameSchema>;
export type Variant = z.infer<typeof VariantSchema>;
export type Template = z.infer<typeof TemplateSchema>;

// ── Compile model (compile() output → freshcoat's compileScene lowers it) ─────
//
// compile() emits a freshcoat Node tree per frame. Rendering (auto-layout
// resolution, glyph baking, lowering to the Command IR, paint) is coatfile's
// `render` → freshcoat's compileScene + env.paint.

export type CompiledTemplate = {
	width: number;
	height: number;
	/** Where the trim lies in the scene, when it was compiled with bleed. */
	trim?: { x: number; y: number; width: number; height: number };
	frames: CompiledFrame[];
};

export type CompiledFrame = {
	name: string;
	assets: FrameAssets;
	// The frame's declarative freshcoat scene: a static root group whose
	// children are the background (index 0) + the element nodes. Auto-layout
	// lives on group nodes' `layout`; positions are parent-relative; text is
	// not yet baked. resolveLayout / compileScene finish it.
	root: GroupNode;
	// What compile found wrong while building the scene (a barcode it could not
	// encode). render() passes these on with the painter's own.
	warnings?: PaintWarning[];
};

export type FrameAssets = {
	fonts: FontRequest[];
	images: string[];
};

export type CompileOptions = {
	width: number;
	height: number;
	variantId?: string;
	/** Lay each frame out at this size in design units, re-placing elements by
	 *  their `constraints`, before scaling to `width` x `height`. The aspect
	 *  check is then skipped: the caller picks `resize` with the target's aspect
	 *  (see `fitDesignSize`). */
	resize?: Size;
	/** Draw the template's `bleed` around the trim. `width` x `height` stays
	 *  the trim's size and the scene grows by the bleed at the same scale. */
	bleed?: boolean;
};

export type ValidationError = {
	path: string;
	code: string;
	message: string;
};

export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; errors: ValidationError[] };
