// The Node IR — freshcoat's composable, backend-agnostic 2D scene graph. A tree
// of nodes compiles (see ./compile-scene) to the flat Command IR the painter
// walks.
import type {
	Adjust,
	BitmapRole,
	BakedTextLayout,
	BlendMode,
	CornerRadius,
	FillRule,
	ImageCrop,
	ResolvedFill,
	ResolvedFont,
	Shadows,
	ShapeMask,
	Size,
	Stroke,
	Vec2,
	ViewBox,
} from "./types";

// ─────────────── layout ───────────────

export type Padding =
	| number
	| [top: number, right: number, bottom: number, left: number];
export type Align = "start" | "center" | "end" | "stretch";
export type Justify =
	| "start"
	| "center"
	| "end"
	| "space-between"
	| "space-around"
	| "space-evenly";
export type TrackSize = number | "auto" | `${number}fr`;

export type FlexLayout = {
	type: "flex";
	direction: "row" | "column";
	gap?: number;
	// Gap between wrapped lines (cross axis); defaults to `gap`.
	crossGap?: number;
	padding?: Padding;
	align?: Align;
	justify?: Justify;
	wrap?: boolean;
};
export type GridLayout = {
	type: "grid";
	columns: TrackSize[];
	rows?: TrackSize[];
	gap?: number | [number, number];
	padding?: Padding;
};
export type Layout = FlexLayout | GridLayout;

// Child-side hints, interpreted by the parent's layout, inert otherwise. Sizing
// (fill/hug/fixed) is universal; placement (grow / column|row) is type-specific.
export type ChildLayout = {
	width?: "fill" | "hug" | number;
	height?: "fill" | "hug" | number;
	grow?: number; // flex-only: share of leftover main-axis space
	alignSelf?: Align; // flex-only
	// flex-only: take the child out of flow and place it at its own pos
	// (frame-relative), ignoring gap/justify/align.
	absolute?: boolean;
	// flex-only: clamp the resolved main-axis size.
	min?: { width?: number; height?: number };
	max?: { width?: number; height?: number };
	column?: number | [start: number, end: number]; // grid-only
	row?: number | [start: number, end: number]; // grid-only
};

// ─────────────── shared transform / compositing ───────────────

export type Transform = {
	id?: string;
	// Box in PARENT space. Optional for a child of a layout group, which the
	// layout places; resolveLayout guarantees both on every node it returns.
	pos?: Vec2;
	size?: Size;
	rotation?: number;
	opacity?: number;
	blendMode?: BlendMode;
	shadow?: Shadows;
	blur?: number;
	// Per-layer color/tone adjustment (see Adjust). On a group/mask it adjusts the
	// whole subtree's composited result.
	adjust?: Adjust;
	layoutChild?: ChildLayout;
};

// ─────────────── leaves ───────────────

export type RectNode = Transform & {
	kind: "rect";
	fills?: ResolvedFill[];
	stroke?: Stroke;
	cornerRadius?: CornerRadius;
	cornerSmoothing?: number;
};
export type EllipseNode = Transform & {
	kind: "ellipse";
	fills?: ResolvedFill[];
	stroke?: Stroke;
};
export type PathNode = Transform & {
	kind: "path";
	d: string; // SVG subset, coords box-relative
	fills?: ResolvedFill[];
	stroke?: Stroke;
	// The coordinate box `d` is authored in. When set, the path is scaled from
	// this box into the node's `size` (SVG viewBox → viewport), so callers can
	// size vector art by the node box instead of pre-scaling the path data.
	viewBox?: ViewBox;
	// Which regions of a self-intersecting or multi-subpath `d` are inside. A
	// ring drawn as two subpaths needs "evenodd" (or opposite windings) to keep
	// its hole.
	fillRule?: FillRule;
};
export type ImageNode = Transform & {
	kind: "image";
	src: string;
	fit: "cover" | "contain" | "fill" | "tile";
	// The point of the source, as fractions of the (cropped) source, that `cover`
	// keeps in the middle of the box, as near as the source's edges allow.
	// Default the centre.
	focus?: Vec2;
	// The part of the source that is drawn, before `fit` places it. Not applied
	// to `tile`, which repeats the whole source.
	crop?: ImageCrop;
	stroke?: Stroke;
	mask?: ShapeMask; // cheap shape clip (avatar); a MaskNode for anything richer
};
export type BitmapNode = Transform & {
	kind: "bitmap";
	pixels: Uint8Array; // raw RGBA
	pixelWidth: number;
	pixelHeight: number;
	role?: BitmapRole;
};
export type TextNode = Transform & {
	kind: "text";
	text?: string; // single-style …
	spans?: { text: string; font?: Partial<ResolvedFont>; color?: string }[]; // … or rich
	font: ResolvedFont;
	color?: string;
	fill?: ResolvedFill;
	align?: "left" | "center" | "right";
	verticalAlign?: "top" | "middle" | "bottom";
	fit?: "shrink" | "clip";
	maxLines?: number;
	// Figma "Vertical trim: cap height to baseline": anchor the cap line to the
	// box top instead of seating the baseline by the line box (half the leading,
	// then the ascent). Affects baseline placement and the fit:"clip" outset.
	// Unset is true here — a hand-built scene keeps the anchoring it was tuned
	// against — while coatfile compiles the field explicitly, defaulting to
	// Figma's own default, which is standard rather than trimmed.
	leadingTrim?: boolean;
	// A pre-baked layout, used as is. Without one, compileScene bakes text/spans
	// through its TextEngine.
	layout?: BakedTextLayout;
};

// ─────────────── container ───────────────

export type GroupNode = Transform & {
	kind: "group";
	children: Node[];
	layout?: Layout;
	// Painted behind the children, across the group's own box, honoring
	// `cornerRadius`/`cornerSmoothing`. A hug-height container can therefore carry
	// its own background instead of a sibling rect sized to it — which otherwise
	// means resolving the layout once to learn the height and again to paint.
	//
	// The group's `shadow` is cast by the composited layer, so an opaque fill
	// makes that silhouette the rounded box rather than the children's outline.
	fills?: ResolvedFill[];
	clip?: boolean; // clip children to my box…
	cornerRadius?: CornerRadius; // …honoring these corners
	cornerSmoothing?: number;
};

// The unified masking primitive: `children` are masked by `mask`'s coverage.
// Cheap-vs-expensive is a renderer decision, not authoring: a single opaque
// shape mask lowers to a clipPath; anything else (image alpha, gradient, text,
// group) to an offscreen coverage layer. `group.clip` / `image.mask` remain the
// cheap sugar for the simple shape-clip case.
export type MaskNode = Transform & {
	kind: "mask";
	mask: Node; // coverage source
	children: Node[]; // masked by it
	channel?: "alpha" | "luminance"; // default alpha
	invert?: boolean;
};

export type Node =
	| RectNode
	| EllipseNode
	| PathNode
	| ImageNode
	| BitmapNode
	| TextNode
	| GroupNode
	| MaskNode;

// ─────────────── constructors ───────────────

export const createRect = (p: Omit<RectNode, "kind">): RectNode => ({
	kind: "rect",
	...p,
});
export const createEllipse = (p: Omit<EllipseNode, "kind">): EllipseNode => ({
	kind: "ellipse",
	...p,
});
// Circle = square-box ellipse; the caller supplies an equal width/height.
export const createCircle = (p: Omit<EllipseNode, "kind">): EllipseNode => ({
	kind: "ellipse",
	...p,
});
export const createPath = (p: Omit<PathNode, "kind">): PathNode => ({
	kind: "path",
	...p,
});
export const createImage = (p: Omit<ImageNode, "kind">): ImageNode => ({
	kind: "image",
	...p,
});
export const createBitmap = (p: Omit<BitmapNode, "kind">): BitmapNode => ({
	kind: "bitmap",
	...p,
});
export const createText = (p: Omit<TextNode, "kind">): TextNode => ({
	kind: "text",
	...p,
});
export const createGroup = (
	children: Node[],
	opts?: Omit<GroupNode, "kind" | "children">,
): GroupNode => ({ kind: "group", children, ...opts });
export const createMask = (
	mask: Node,
	children: Node[],
	opts?: Omit<MaskNode, "kind" | "mask" | "children">,
): MaskNode => ({ kind: "mask", mask, children, ...opts });

// Frame is a helper, not a kind: group + background child + self-clip.
export function createFrame(
	opts: {
		background?: Node;
		children: Node[];
		clip?: boolean;
		cornerRadius?: CornerRadius;
		layout?: Layout;
	} & Omit<Transform, "layoutChild">,
): GroupNode {
	const { background, children, clip, cornerRadius, layout, ...rest } = opts;
	return {
		kind: "group",
		children: background ? [background, ...children] : children,
		clip,
		cornerRadius,
		layout,
		...rest,
	};
}

// ─────────────── layout annotators ───────────────

export const autoLayout = (
	g: GroupNode,
	cfg: Omit<FlexLayout, "type">,
): GroupNode => ({ ...g, layout: { type: "flex", ...cfg } });
export const gridLayout = (
	g: GroupNode,
	cfg: Omit<GridLayout, "type">,
): GroupNode => ({ ...g, layout: { type: "grid", ...cfg } });
