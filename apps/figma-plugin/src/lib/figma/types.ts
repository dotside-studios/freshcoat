export type FigmaColor = { r: number; g: number; b: number; a: number };

export type FigmaBoundingBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type FigmaTransform = [
	[number, number, number],
	[number, number, number],
];

export type FigmaBlendMode =
	| "NORMAL"
	| "MULTIPLY"
	| "SCREEN"
	| "OVERLAY"
	| "DARKEN"
	| "LIGHTEN"
	| "LINEAR_DODGE"
	| "LINEAR_BURN"
	| "COLOR_DODGE"
	| "COLOR_BURN"
	| "HARD_LIGHT"
	| "SOFT_LIGHT"
	| "DIFFERENCE"
	| "EXCLUSION"
	| "HUE"
	| "SATURATION"
	| "COLOR"
	| "LUMINOSITY"
	| "PASS_THROUGH";

export type FigmaSolidPaint = {
	type: "SOLID";
	visible?: boolean;
	opacity?: number;
	blendMode?: FigmaBlendMode;
	color: FigmaColor;
};

export type FigmaGradientStop = { position: number; color: FigmaColor };

export type FigmaGradientPaint = {
	type:
		| "GRADIENT_LINEAR"
		| "GRADIENT_RADIAL"
		| "GRADIENT_ANGULAR"
		| "GRADIENT_DIAMOND";
	visible?: boolean;
	opacity?: number;
	blendMode?: FigmaBlendMode;
	gradientHandlePositions: Array<{ x: number; y: number }>;
	gradientStops: FigmaGradientStop[];
	/** The paint's own transform, carried unread. Nothing in the transpiler uses
	 *  it — gradientHandlePositions is derived from it at read time — but the
	 *  handles are a lossy view of it (which points they sample depends on the
	 *  gradient's kind), so a diagnostics dump that only had them could not show
	 *  what Figma actually said. */
	gradientTransform?: FigmaTransform;
};

export type FigmaImagePaint = {
	type: "IMAGE";
	visible?: boolean;
	opacity?: number;
	blendMode?: FigmaBlendMode;
	scaleMode: "FILL" | "FIT" | "TILE" | "STRETCH";
	imageRef: string;
	// STRETCH (the Plugin API's CROP) only: maps the layer's unit square into
	// the image's, so its translation and scale are the visible region.
	imageTransform?: FigmaTransform;
	filters?: FigmaImageFilters;
};

// Figma's image adjustments, each in [-1, 1] with 0 unchanged.
export type FigmaImageFilters = {
	exposure?: number;
	contrast?: number;
	saturation?: number;
	temperature?: number;
	tint?: number;
	highlights?: number;
	shadows?: number;
};

export type FigmaGridTrack = { type: "FLEX" | "FIXED" | "HUG"; value?: number };

export type FigmaPaint = FigmaSolidPaint | FigmaGradientPaint | FigmaImagePaint;

export type FigmaEffect = {
	type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
	visible?: boolean;
	color?: { r: number; g: number; b: number; a: number };
	offset?: { x: number; y: number };
	radius?: number;
	spread?: number;
	blendMode?: FigmaBlendMode;
	// A PROGRESSIVE layer blur ramps its radius across the layer.
	blurType?: "NORMAL" | "PROGRESSIVE";
};

export type FigmaTextStyle = {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	italic?: boolean;
	letterSpacing?: number;
	lineHeightPx?: number;
	lineHeightPercentFontSize?: number;
	textAlignHorizontal: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
	textAlignVertical: "TOP" | "CENTER" | "BOTTOM";
	textAutoResize?: "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT" | "TRUNCATE";
	// Figma "Truncate text", which replaced textAutoResize TRUNCATE. maxLines
	// caps the line count; absent means as many lines as the box holds.
	textTruncation?: "DISABLED" | "ENDING";
	maxLines?: number;
	// Figma "Vertical trim". STANDARD (the default) seats the first baseline by
	// the line box — half the leading, then the ascent. CAP_HEIGHT tucks the cap
	// line against the box top instead, which moves every line up by roughly
	// ascent − capHeight.
	leadingTrim?: "NONE" | "CAP_HEIGHT";
	// Figma "Paragraph spacing": px after each paragraph.
	paragraphSpacing?: number;
	// Figma "OpenType features" the layer explicitly sets, by uppercase tag.
	openTypeFeatures?: Record<string, boolean>;
	textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
	// Only on a styleOverrideTable entry: that run's own paints. The base
	// style's paints are the node's `fills`.
	fills?: FigmaPaint[];
	textCase?:
		| "ORIGINAL"
		| "UPPER"
		| "LOWER"
		| "TITLE"
		| "SMALL_CAPS"
		| "SMALL_CAPS_FORCED";
};

/** How a layer follows its parent frame when that frame is resized, per axis:
 *  Figma's left/top (MIN), right/bottom (MAX), centre, left and right (STRETCH)
 *  or scale. */
export type FigmaConstraintType =
	| "MIN"
	| "CENTER"
	| "MAX"
	| "STRETCH"
	| "SCALE";

export type FigmaConstraints = {
	horizontal: FigmaConstraintType;
	vertical: FigmaConstraintType;
};

type FigmaBaseNode = {
	id: string;
	name: string;
	/** Properties Figma reported as `figma.mixed` — a vector painted per region,
	 *  a text coloured per character. Reading one necessarily collapses it (to an
	 *  empty paint list, to no corner radius), which is indistinguishable from
	 *  the author having set nothing. Naming them is the difference between "this
	 *  layer has no fill" and "this layer's fill could not be read", which is the
	 *  answer when a layer arrives as a bitmap for no visible reason. Carried for
	 *  diagnostics; nothing in the transpiler branches on it. */
	mixed?: string[];
	visible?: boolean;
	opacity?: number;
	blendMode?: FigmaBlendMode;
	effects?: FigmaEffect[];
	// "Use as mask": this layer is not drawn; it masks the siblings above it,
	// up to the next mask. ALPHA and VECTOR mask by coverage, LUMINANCE by
	// brightness.
	isMask?: boolean;
	maskType?: "ALPHA" | "VECTOR" | "LUMINANCE";
	absoluteBoundingBox: FigmaBoundingBox;
	// The node's rendered/visual region (includes effects + clipping), as
	// exported by exportAsync. Differs from absoluteBoundingBox (geometry AABB)
	// when the node bleeds past a clip or an effect expands it. Null for
	// invisible nodes. Rasters must be placed here, not at absoluteBoundingBox.
	absoluteRenderBounds?: FigmaBoundingBox | null;
	relativeTransform?: FigmaTransform;
	// World transform — its decomposed rotation is the node's *effective*
	// rotation (includes any rotation inherited from ancestor groups/frames),
	// unlike `rotation`, which is only relative to the immediate parent.
	absoluteTransform?: FigmaTransform;
	rotation?: number;
	// Unrotated layout dimensions (node.width/height). Differ from
	// absoluteBoundingBox (the axis-aligned box) when the node is rotated.
	width?: number;
	height?: number;
	// Auto-layout child fields (present on any node inside an auto-layout
	// parent). layoutPositioning ABSOLUTE = Figma "ignore auto-layout".
	layoutGrow?: number;
	layoutAlign?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
	layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
	layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
	layoutPositioning?: "AUTO" | "ABSOLUTE";
	// Grid child fields, read only inside a GRID parent. Indices are 0-based.
	gridRowAnchorIndex?: number;
	gridColumnAnchorIndex?: number;
	gridRowSpan?: number;
	gridColumnSpan?: number;
	// Absent on a GROUP and a BOOLEAN_OPERATION, which the Plugin API gives
	// none: resizing a frame applies their children's constraints instead.
	constraints?: FigmaConstraints;
	minWidth?: number | null;
	maxWidth?: number | null;
	minHeight?: number | null;
	maxHeight?: number | null;
	// Stored field binding (pluginData): which element property maps
	// to which value template. Captured by read-scene-graph; honored by the
	// transpiler over live inference. Property keys mirror binding.ts BindProperty.
	binding?: {
		bind: Partial<
			Record<"text" | "textColor" | "fill" | "image" | "qr" | "barcode", string>
		>;
	};
	// Template-global field metadata (pluginData), set on a slot
	// frame by the harvest/override step. Shape mirrors binding.ts FieldMeta;
	// kept loose here to avoid a types↔binding import cycle.
	fieldMeta?: Record<string, unknown>;
};

export type FigmaTextNode = FigmaBaseNode & {
	type: "TEXT";
	characters: string;
	style: FigmaTextStyle;
	fills: FigmaPaint[];
	strokes?: FigmaPaint[];
	strokeWeight?: number;
	characterStyleOverrides?: number[];
	styleOverrideTable?: Record<string, Partial<FigmaTextStyle>>;
};

export type FigmaRectangleNode = FigmaBaseNode & {
	type: "RECTANGLE";
	fills: FigmaPaint[];
	strokes?: FigmaPaint[];
	strokeWeight?: number;
	// Loose string: Figma enums like "ROUND"/"SQUARE"/"NONE"/"MITER"/"BEVEL"
	// (or figma.mixed for per-segment caps, guarded at read time).
	strokeCap?: string;
	strokeJoin?: string;
	// "INSIDE" | "OUTSIDE" | "CENTER". Figma defaults a closed shape's stroke to
	// INSIDE, so leaving it unread paints every such stroke half a weight wide of
	// where the design put it.
	strokeAlign?: string;
	dashPattern?: number[];
	// Uniform, or per-corner [topLeft, topRight, bottomRight, bottomLeft] when
	// the four differ (Figma reports the uniform property as mixed then).
	cornerRadius?: number | [number, number, number, number];
	cornerSmoothing?: number;
};

export type FigmaVectorNodeType =
	| "VECTOR"
	| "BOOLEAN_OPERATION"
	| "STAR"
	| "POLYGON"
	| "LINE"
	| "ELLIPSE";

export type FigmaVectorNode = FigmaBaseNode & {
	type: FigmaVectorNodeType;
	fills?: FigmaPaint[];
	strokes?: FigmaPaint[];
	strokeWeight?: number;
	strokeCap?: string;
	strokeJoin?: string;
	strokeAlign?: string;
	dashPattern?: number[];
	// Figma's REST API attaches fillGeometry as an array of path regions, each
	// in the node's bounding-box-local coordinate space and filled by its own
	// winding rule. An open, stroke-only path has none.
	fillGeometry?: { path: string; windingRule?: "NONZERO" | "EVENODD" }[];
	// ELLIPSE only, in radians. Absent reads as a full, solid ellipse.
	arcData?: { startingAngle: number; endingAngle: number; innerRadius: number };
	// POLYGON only.
	pointCount?: number;
	cornerRadius?: number;
};

export type FigmaContainerNodeType =
	| "FRAME"
	| "GROUP"
	| "COMPONENT"
	| "INSTANCE"
	| "COMPONENT_SET";

export type FigmaContainerNode = FigmaBaseNode & {
	type: FigmaContainerNodeType;
	children: FigmaNode[];
	fills?: FigmaPaint[];
	strokes?: FigmaPaint[];
	strokeWeight?: number;
	strokeAlign?: string;
	dashPattern?: number[];
	// Uniform, or per-corner [topLeft, topRight, bottomRight, bottomLeft].
	cornerRadius?: number | [number, number, number, number];
	clipsContent?: boolean;
	componentProperties?: Record<string, { value: string; type: string }>;
	componentId?: string;
	componentSetId?: string;
	// For INSTANCE nodes: the id of the main component this instance derives
	// from (getMainComponentAsync().id). Used by discovery to match colorway
	// instances to their base card. Null/undefined for non-instances or a
	// detached instance.
	mainComponentId?: string | null;
	// Auto-layout container fields. layoutMode NONE (or absent) = not an
	// auto-layout frame (today's absolute behavior).
	layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
	gridRowGap?: number;
	gridColumnGap?: number;
	gridRowSizes?: FigmaGridTrack[];
	gridColumnSizes?: FigmaGridTrack[];
	itemSpacing?: number;
	counterAxisSpacing?: number | null;
	paddingTop?: number;
	paddingRight?: number;
	paddingBottom?: number;
	paddingLeft?: number;
	primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
	counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
	layoutWrap?: "NO_WRAP" | "WRAP";
};

export type FigmaNode =
	| FigmaTextNode
	| FigmaRectangleNode
	| FigmaVectorNode
	| FigmaContainerNode;

export function isContainerNode(n: { type: string }): n is FigmaContainerNode {
	return (
		n.type === "FRAME" ||
		n.type === "GROUP" ||
		n.type === "COMPONENT" ||
		n.type === "INSTANCE" ||
		n.type === "COMPONENT_SET"
	);
}

export function isTextNode(n: FigmaNode): n is FigmaTextNode {
	return n.type === "TEXT";
}

export function isRectangleNode(n: FigmaNode): n is FigmaRectangleNode {
	return n.type === "RECTANGLE";
}

export function isVectorNode(n: { type: string }): n is FigmaVectorNode {
	return (
		n.type === "VECTOR" ||
		n.type === "BOOLEAN_OPERATION" ||
		n.type === "STAR" ||
		n.type === "POLYGON" ||
		n.type === "LINE" ||
		n.type === "ELLIPSE"
	);
}
