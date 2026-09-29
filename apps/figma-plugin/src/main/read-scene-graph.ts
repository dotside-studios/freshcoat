import type {
	FigmaBlendMode,
	FigmaColor,
	FigmaConstraints,
	FigmaContainerNode,
	FigmaContainerNodeType,
	FigmaEffect,
	FigmaGridTrack,
	FigmaImageFilters,
	FigmaNode,
	FigmaPaint,
	FigmaRectangleNode,
	FigmaTextNode,
	FigmaTextStyle,
	FigmaTransform,
	FigmaVectorNode,
	FigmaVectorNodeType,
} from "~/lib/figma/types";
import { FIELD_KEY, FIELDS_KEY, readPluginData } from "~/main/plugin-data";

function rgbaFrom(color: {
	r: number;
	g: number;
	b: number;
	a?: number;
}): FigmaColor {
	return { r: color.r, g: color.g, b: color.b, a: color.a ?? 1 };
}

/** Invert a 2x3 affine matrix; returns identity if singular. */
function invert(t: FigmaTransform): FigmaTransform {
	const [[a, b, c], [d, e, f]] = t;
	const det = a * e - b * d;
	if (det === 0)
		return [
			[1, 0, 0],
			[0, 1, 0],
		];
	const id = 1 / det;
	return [
		[e * id, -b * id, (b * f - e * c) * id],
		[-d * id, a * id, (d * c - a * f) * id],
	];
}

function applyTransform(
	t: FigmaTransform,
	x: number,
	y: number,
): { x: number; y: number } {
	return {
		x: t[0][0] * x + t[0][1] * y + t[0][2],
		y: t[1][0] * x + t[1][1] * y + t[1][2],
	};
}

/**
 * Plugin gradients carry a `gradientTransform` (gradient-space ← object-space).
 * The REST `gradientHandlePositions` live in object space, so they're the
 * inverse transform applied to the gradient's canonical handle points.
 *
 * WHICH points those are depends on the kind, because the two gradients sit
 * differently inside Figma's unit-square gradient space. A linear gradient runs
 * along the square's horizontal midline, so REST reports its start (0, 0.5), its
 * end (1, 0.5), and (0, 1), whose offset from the start sets the width. Those
 * are the handles Figma draws on the layer, which is what coatfile's `from` and
 * `to` place. A radial one is the circle centered at (0.5, 0.5) with radius 0.5, so
 * REST reports that center and its two axis ENDS — (1, 0.5) and (0.5, 1).
 * Sampling a radial gradient at the linear points hands the consumer a corner of
 * the shape as the center of a glow that belongs in its middle.
 */
export function gradientHandlesFromTransform(
	t: FigmaTransform,
	kind: "linear" | "radial",
): Array<{ x: number; y: number }> {
	const inv = invert(t);
	if (kind === "radial") {
		return [
			applyTransform(inv, 0.5, 0.5),
			applyTransform(inv, 1, 0.5),
			applyTransform(inv, 0.5, 1),
		];
	}
	return [
		applyTransform(inv, 0, 0.5),
		applyTransform(inv, 1, 0.5),
		applyTransform(inv, 0, 1),
	];
}

/** A minimal structural shape of a Plugin-API Paint (what we read off it). */
type AnyPaint = {
	type: string;
	visible?: boolean;
	opacity?: number;
	color?: { r: number; g: number; b: number };
	gradientTransform?: FigmaTransform;
	gradientStops?: Array<{
		position: number;
		color: { r: number; g: number; b: number; a: number };
	}>;
	scaleMode?: string;
	imageHash?: string | null;
	imageTransform?: FigmaTransform;
	filters?: FigmaImageFilters;
};

export function readPaint(paint: AnyPaint): FigmaPaint {
	if (paint.type === "SOLID") {
		return {
			type: "SOLID",
			visible: paint.visible,
			opacity: paint.opacity,
			color: rgbaFrom({ ...(paint.color ?? { r: 0, g: 0, b: 0 }), a: 1 }),
		};
	}
	if (paint.type === "IMAGE") {
		const mode =
			paint.scaleMode === "CROP" ? "STRETCH" : (paint.scaleMode ?? "FILL");
		return {
			type: "IMAGE",
			visible: paint.visible,
			opacity: paint.opacity,
			scaleMode: mode as "FILL" | "FIT" | "TILE" | "STRETCH",
			imageRef: paint.imageHash ?? "",
			...(paint.scaleMode === "CROP" && paint.imageTransform
				? { imageTransform: paint.imageTransform }
				: {}),
			...(paint.filters && Object.values(paint.filters).some((v) => v)
				? { filters: { ...paint.filters } }
				: {}),
		};
	}
	// Gradient (linear/radial/angular/diamond): emit REST-shaped gradient paint.
	// RADIAL, ANGULAR and DIAMOND all radiate from the gradient square's center,
	// so they share the radial sampling; only LINEAR runs along an axis.
	return {
		type: paint.type as "GRADIENT_LINEAR" | "GRADIENT_RADIAL",
		visible: paint.visible,
		opacity: paint.opacity,
		...(paint.gradientTransform
			? { gradientTransform: paint.gradientTransform }
			: {}),
		gradientHandlePositions: gradientHandlesFromTransform(
			paint.gradientTransform ?? [
				[1, 0, 0],
				[0, 1, 0],
			],
			paint.type === "GRADIENT_LINEAR" ? "linear" : "radial",
		),
		gradientStops: (paint.gradientStops ?? []).map((s) => ({
			position: s.position,
			color: rgbaFrom(s.color),
		})),
	};
}

export function readPaints(
	paints: readonly AnyPaint[] | typeof figma.mixed | undefined,
): FigmaPaint[] {
	if (!Array.isArray(paints)) return [];
	return paints.map(readPaint);
}

type AnyEffect = {
	type: string;
	visible?: boolean;
	radius?: number;
	spread?: number;
	offset?: { x: number; y: number };
	color?: { r: number; g: number; b: number; a: number };
};

type AnySceneNode = {
	id: string;
	name: string;
	visible?: boolean;
	opacity?: number;
	blendMode?: string;
	rotation?: number;
	absoluteTransform?: FigmaTransform;
	relativeTransform?: FigmaTransform;
	width?: number;
	height?: number;
	absoluteBoundingBox?: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null;
	absoluteRenderBounds?: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null;
	effects?: readonly AnyEffect[];
	isMask?: boolean;
	maskType?: string;
	layoutGrow?: number;
	layoutAlign?: string;
	layoutSizingHorizontal?: string;
	layoutSizingVertical?: string;
	layoutPositioning?: string;
	minWidth?: number | null;
	maxWidth?: number | null;
	minHeight?: number | null;
	maxHeight?: number | null;
	constraints?: { horizontal: string; vertical: string };
	getPluginData?: (key: string) => string;
};

const CONSTRAINT_TYPES: ReadonlySet<string> = new Set([
	"MIN",
	"CENTER",
	"MAX",
	"STRETCH",
	"SCALE",
]);

// Only the node types with a ConstraintMixin carry `constraints`; a group or a
// boolean operation has none, and reads as absent.
function readConstraints(
	node: AnySceneNode,
): { constraints: FigmaConstraints } | undefined {
	const c = node.constraints;
	if (!c || !CONSTRAINT_TYPES.has(c.horizontal)) return undefined;
	if (!CONSTRAINT_TYPES.has(c.vertical)) return undefined;
	return {
		constraints: {
			horizontal: c.horizontal as FigmaConstraints["horizontal"],
			vertical: c.vertical as FigmaConstraints["vertical"],
		},
	};
}

// The author's stored binding for this node (set by the plugin's harvest step).
// Property → value template, e.g. { text: "{{name}}", textColor: "{{brand}}" }.
function readBinding(
	node: AnySceneNode,
): { bind: Record<string, string> } | undefined {
	const raw = readPluginData(node, FIELD_KEY);
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw) as { bind?: Record<string, string> };
		if (parsed && typeof parsed === "object" && parsed.bind) {
			return { bind: parsed.bind };
		}
	} catch {
		// Malformed pluginData — ignore and fall back to live inference.
	}
	return undefined;
}

// Template-global field metadata (FIELDS_KEY), set on a slot frame by the
// plugin's harvest/override step. Overrides inferred metadata at export.
function readFieldMeta(
	node: AnySceneNode,
): Record<string, unknown> | undefined {
	const raw = readPluginData(node, FIELDS_KEY);
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Malformed pluginData — ignore.
	}
	return undefined;
}

function readEffects(
	effects: readonly AnyEffect[] | undefined,
): FigmaEffect[] | undefined {
	if (!Array.isArray(effects)) return undefined;
	return effects.map((e) => ({
		type: e.type as FigmaEffect["type"],
		visible: e.visible,
		radius: e.radius,
		spread: e.spread,
		offset: e.offset,
		color: e.color,
	}));
}

/** The properties on this node that Figma answered with `figma.mixed`. Every
 *  reader below narrows such a value away — readPaints returns [], the corner
 *  read returns undefined — so without this the collapse is invisible. */
function mixedProperties(node: AnySceneNode): string[] | undefined {
	const candidates: Array<[string, unknown]> = [
		["fills", (node as { fills?: unknown }).fills],
		["strokes", (node as { strokes?: unknown }).strokes],
		["cornerRadius", (node as { cornerRadius?: unknown }).cornerRadius],
	];
	const mixed = candidates
		.filter(([key, value]) => {
			if (value === undefined) return false;
			if (key === "cornerRadius") return typeof value !== "number";
			return !Array.isArray(value);
		})
		.map(([key]) => key);
	return mixed.length > 0 ? mixed : undefined;
}

export function readBaseFields(node: AnySceneNode) {
	const mixed = mixedProperties(node);
	return {
		id: node.id,
		name: node.name,
		...(mixed ? { mixed } : {}),
		visible: node.visible,
		opacity: node.opacity,
		blendMode: (node.blendMode ?? "NORMAL") as FigmaBlendMode,
		rotation: node.rotation,
		absoluteTransform: node.absoluteTransform,
		relativeTransform: node.relativeTransform,
		width: node.width,
		height: node.height,
		absoluteBoundingBox: node.absoluteBoundingBox ?? {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		},
		absoluteRenderBounds: node.absoluteRenderBounds ?? null,
		effects: readEffects(node.effects),
		...(node.isMask === true
			? {
					isMask: true,
					...(node.maskType === "ALPHA" ||
					node.maskType === "VECTOR" ||
					node.maskType === "LUMINANCE"
						? {
								maskType: node.maskType as NonNullable<
									FigmaVectorNode["maskType"]
								>,
							}
						: {}),
				}
			: {}),
		layoutGrow: node.layoutGrow,
		layoutAlign: node.layoutAlign as never,
		layoutSizingHorizontal: node.layoutSizingHorizontal as never,
		layoutSizingVertical: node.layoutSizingVertical as never,
		layoutPositioning: node.layoutPositioning as never,
		minWidth: node.minWidth,
		maxWidth: node.maxWidth,
		minHeight: node.minHeight,
		maxHeight: node.maxHeight,
		...readConstraints(node),
		...(readBinding(node) ? { binding: readBinding(node) } : {}),
		...(readFieldMeta(node) ? { fieldMeta: readFieldMeta(node) } : {}),
	};
}

type AnyLetterSpacing = { value: number; unit: "PIXELS" | "PERCENT" };
type AnyLineHeight =
	| { value: number; unit: "PIXELS" | "PERCENT" }
	| { unit: "AUTO" };

// Fallbacks when a font property is mixed and the text has no styled runs to
// borrow from — a degenerate case, but the payload still has to be numbers.
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = "Inter";

function isItalic(style: string): boolean {
	return /italic/i.test(style);
}

function letterSpacingPx(
	ls: AnyLetterSpacing | undefined,
	fontSize: number,
): number | undefined {
	if (!ls) return undefined;
	if (ls.unit === "PERCENT") return (ls.value / 100) * fontSize;
	return ls.value;
}

function lineHeightFields(
	lh: AnyLineHeight | undefined,
	_fontSize: number,
): Partial<FigmaTextStyle> {
	if (!lh || lh.unit === "AUTO") return {};
	if (lh.unit === "PERCENT") return { lineHeightPercentFontSize: lh.value };
	return { lineHeightPx: lh.value };
}

type AnyTextSegment = {
	start: number;
	end: number;
	fontName: { family: string; style: string };
	fontSize: number;
	fontWeight: number;
	letterSpacing?: AnyLetterSpacing;
	lineHeight?: AnyLineHeight;
};

// Every font property below is typed `unknown` on purpose: Figma returns
// figma.mixed (a symbol) for any of them when the value varies across the
// string. Typing them as their happy-path shape is what let a symbol reach
// postMessage. Read them through the plain* guards.
type AnyTextNode = AnySceneNode & {
	characters: string;
	fontName: unknown;
	fontSize: unknown;
	fontWeight: unknown;
	letterSpacing?: unknown;
	lineHeight?: unknown;
	textAlignHorizontal: unknown;
	textAlignVertical: unknown;
	textAutoResize?: unknown;
	textCase?: unknown;
	leadingTrim?: unknown;
	fills: readonly AnyPaint[];
	getStyledTextSegments: (fields: string[]) => AnyTextSegment[];
};

// Any text property that varies across the string reads back as `figma.mixed`,
// which is a SYMBOL. A symbol cannot cross figma.ui.postMessage — it fails the
// whole message with "Cannot unwrap symbol" — so nothing read off a node may
// reach the payload unchecked. These two narrow a value to a usable primitive,
// returning undefined for mixed (or anything else unexpected).
function plainNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function plainString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** letterSpacing is an object, so `mixed` has to be rejected structurally. */
function plainLetterSpacing(value: unknown): AnyLetterSpacing | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const ls = value as Partial<AnyLetterSpacing>;
	return typeof ls.value === "number" && typeof ls.unit === "string"
		? (ls as AnyLetterSpacing)
		: undefined;
}

function plainLineHeight(value: unknown): AnyLineHeight | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const lh = value as { unit?: unknown };
	return typeof lh.unit === "string" ? (value as AnyLineHeight) : undefined;
}

/** Build the base FigmaTextStyle from the node-level font props, falling back
 *  to `primary` — the text's first styled run — for anything the node reports
 *  as mixed. A paragraph with a bold phrase in it has mixed fontName/fontSize/
 *  fontWeight at the node level, so on that text every font field here would
 *  otherwise be a symbol; the per-run styles are captured separately in
 *  styleOverrideTable, and run 0 is what the base is meant to describe anyway. */
function baseTextStyle(
	node: AnyTextNode,
	primary: AnyTextSegment | undefined,
): FigmaTextStyle {
	const fontName = (
		typeof node.fontName === "object" && node.fontName !== null
			? node.fontName
			: primary?.fontName
	) as { family?: unknown; style?: unknown } | undefined;
	const fontSize =
		plainNumber(node.fontSize) ?? primary?.fontSize ?? DEFAULT_FONT_SIZE;
	const letterSpacing =
		plainLetterSpacing(node.letterSpacing) ?? primary?.letterSpacing;
	// Mixed on the node means the runs disagree; the first run is what the base
	// describes, same as it is for size and weight. Without this fallback a node
	// whose runs differ in line height reports AUTO for all of them.
	const lineHeight = plainLineHeight(node.lineHeight) ?? primary?.lineHeight;

	return {
		fontFamily: plainString(fontName?.family) ?? DEFAULT_FONT_FAMILY,
		fontSize,
		fontWeight: plainNumber(node.fontWeight) ?? primary?.fontWeight ?? 400,
		italic: isItalic(plainString(fontName?.style) ?? ""),
		letterSpacing: letterSpacingPx(letterSpacing, fontSize),
		textAlignHorizontal: plainString(
			node.textAlignHorizontal,
		) as FigmaTextStyle["textAlignHorizontal"],
		textAlignVertical: plainString(
			node.textAlignVertical,
		) as FigmaTextStyle["textAlignVertical"],
		textAutoResize: plainString(
			node.textAutoResize,
		) as FigmaTextStyle["textAutoResize"],
		...(plainString(node.textCase)
			? { textCase: node.textCase as FigmaTextStyle["textCase"] }
			: {}),
		// Absent on older API versions, and mixed when it varies across the string
		// — both read as unset, which is Figma's own default (STANDARD).
		...(plainString(node.leadingTrim)
			? { leadingTrim: node.leadingTrim as FigmaTextStyle["leadingTrim"] }
			: {}),
		...lineHeightFields(lineHeight, fontSize),
	};
}

/** A stable signature for a segment's style, used to allocate override keys. */
function segSignature(s: AnyTextSegment): string {
	return JSON.stringify([
		s.fontName.family,
		s.fontName.style,
		s.fontSize,
		s.fontWeight,
		s.letterSpacing?.value ?? 0,
		s.letterSpacing?.unit ?? "PIXELS",
		// Line height varies per segment as freely as size does — a signature
		// block whose first line is set to 132% and whose rest is Auto is one
		// text node with two line boxes.
		s.lineHeight?.unit ?? "AUTO",
		s.lineHeight && s.lineHeight.unit !== "AUTO" ? s.lineHeight.value : 0,
	]);
}

export function readTextNode(node: AnyTextNode): FigmaTextNode {
	const base = readBaseFields(node);
	const fills = readPaints(node.fills);

	// Segments come first: they're what the base style falls back to when the
	// node reports a font property as mixed.
	const segments = node.getStyledTextSegments([
		"fontName",
		"fontSize",
		"fontWeight",
		"letterSpacing",
		"lineHeight",
	]);
	const style = baseTextStyle(node, segments[0]);
	const charCount = [...node.characters].length;
	const overrides = new Array<number>(charCount).fill(0);
	const table: Record<string, Partial<FigmaTextStyle>> = {};

	// The dominant (first) segment's style is the base (key 0); each *other*
	// distinct style gets an incrementing key.
	const baseSig = segments.length > 0 ? segSignature(segments[0]) : "";
	const keyBySig = new Map<string, number>([[baseSig, 0]]);
	let nextKey = 1;

	for (const seg of segments) {
		const sig = segSignature(seg);
		let key = keyBySig.get(sig);
		if (key === undefined) {
			key = nextKey++;
			keyBySig.set(sig, key);
			table[String(key)] = {
				fontFamily: seg.fontName.family,
				fontSize: seg.fontSize,
				fontWeight: seg.fontWeight,
				italic: isItalic(seg.fontName.style),
				letterSpacing: letterSpacingPx(seg.letterSpacing, seg.fontSize),
				// AUTO contributes no fields, exactly as it does on the base style,
				// and the transpiler reads that absence as "auto".
				...lineHeightFields(seg.lineHeight, seg.fontSize),
			};
		}
		for (let i = seg.start; i < seg.end && i < charCount; i++)
			overrides[i] = key;
	}

	return {
		...base,
		type: "TEXT",
		characters: node.characters,
		style,
		fills,
		characterStyleOverrides: overrides,
		styleOverrideTable: table,
	};
}

// Figma returns figma.mixed (a symbol) for per-segment caps/joins. Only
// pass through plain string enums; mixed/other falls back to undefined.
function readStrokeEnum(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

type AnyRectNode = AnySceneNode & {
	fills?: readonly AnyPaint[];
	strokes?: readonly AnyPaint[];
	strokeWeight?: number;
	strokeCap?: unknown;
	strokeJoin?: unknown;
	strokeAlign?: unknown;
	cornerRadius?: unknown;
	topLeftRadius?: number;
	topRightRadius?: number;
	bottomRightRadius?: number;
	bottomLeftRadius?: number;
};

/** A node whose four corners differ reports `cornerRadius` as figma.mixed, so a
 *  uniform read comes back undefined and the rounding is lost outright. Figma
 *  still exposes each corner on its own and coatfile takes a
 *  [topLeft, topRight, bottomRight, bottomLeft] tuple, so read them
 *  individually and collapse to one number only when they agree. */
function readCornerRadius(
	node: AnyRectNode,
): number | [number, number, number, number] | undefined {
	if (typeof node.cornerRadius === "number") return node.cornerRadius;
	const corners = [
		node.topLeftRadius,
		node.topRightRadius,
		node.bottomRightRadius,
		node.bottomLeftRadius,
	];
	if (!corners.every((c) => typeof c === "number")) return undefined;
	const [tl, tr, br, bl] = corners as [number, number, number, number];
	return tl === tr && tr === br && br === bl ? tl : [tl, tr, br, bl];
}

export function readRectangleNode(node: AnyRectNode): FigmaRectangleNode {
	return {
		...readBaseFields(node),
		type: "RECTANGLE",
		fills: readPaints(node.fills),
		strokes: readPaints(node.strokes),
		strokeWeight:
			typeof node.strokeWeight === "number" ? node.strokeWeight : undefined,
		strokeCap: readStrokeEnum(node.strokeCap),
		strokeJoin: readStrokeEnum(node.strokeJoin),
		strokeAlign: readStrokeEnum(node.strokeAlign),
		cornerRadius: readCornerRadius(node),
	};
}

type AnyVectorPaths = readonly { windingRule: string; data: string }[];

type AnyVectorNode = AnySceneNode & {
	type: string;
	fills?: readonly AnyPaint[];
	strokes?: readonly AnyPaint[];
	strokeWeight?: number;
	strokeCap?: unknown;
	strokeJoin?: unknown;
	strokeAlign?: unknown;
	vectorPaths?: AnyVectorPaths;
	fillGeometry?: AnyVectorPaths;
};

/** The path a shape node is emitted from.
 *
 *  `fillGeometry` is the RESOLVED outline of the region a node paints, and it is
 *  what a FILLED shape is read from. It exists on every shape — `vectorPaths`
 *  only on VECTOR and BOOLEAN_OPERATION, so reading that alone leaves an
 *  ELLIPSE / STAR / POLYGON with no geometry at all and the transpiler
 *  rasterizes it — and it has the node's per-point corner rounding already
 *  resolved into it, which the authored path does not: a join softened by a
 *  200px corner exports sharp.
 *
 *  A node with nothing to fill has no fill region to resolve, so a stroke-only
 *  shape is read from `vectorPaths` — the path its stroke actually follows,
 *  which for an open rule is not a closed outline at all.
 *
 *  A LINE has neither: nothing to fill, and no authored path. Its geometry is
 *  the segment across its own width, which is the whole shape (a Figma line has
 *  no height in its own space). */
function readGeometry(
	node: AnyVectorNode,
): NonNullable<FigmaVectorNode["fillGeometry"]> {
	const paints = Array.isArray(node.fills) ? node.fills : [];
	const hasFill = paints.some((f) => f.visible !== false);
	const resolved = node.fillGeometry ?? [];
	const authored = node.vectorPaths ?? [];
	if (hasFill && resolved.length > 0) {
		return resolved.map(readVectorPath);
	}
	if (authored.length > 0) return authored.map(readVectorPath);
	if (resolved.length > 0) return resolved.map(readVectorPath);
	if (
		node.type === "LINE" &&
		typeof node.width === "number" &&
		node.width > 0
	) {
		return [{ path: `M 0 0 L ${node.width} 0` }];
	}
	return [];
}

// Figma's "NONE" marks an open path with nothing to fill, which has no rule.
function readVectorPath(p: {
	windingRule: string;
	data: string;
}): NonNullable<FigmaVectorNode["fillGeometry"]>[number] {
	return p.windingRule === "NONZERO" || p.windingRule === "EVENODD"
		? { path: p.data, windingRule: p.windingRule }
		: { path: p.data };
}

export function readVectorNode(node: AnyVectorNode): FigmaVectorNode {
	return {
		...readBaseFields(node),
		type: node.type as FigmaVectorNodeType,
		fills: readPaints(node.fills),
		strokes: readPaints(node.strokes),
		strokeWeight:
			typeof node.strokeWeight === "number" ? node.strokeWeight : undefined,
		strokeCap: readStrokeEnum(node.strokeCap),
		strokeJoin: readStrokeEnum(node.strokeJoin),
		strokeAlign: readStrokeEnum(node.strokeAlign),
		fillGeometry: readGeometry(node),
	};
}

type AnyContainerNode = AnySceneNode & {
	type: string;
	children?: readonly AnySceneNode[];
	fills?: readonly AnyPaint[];
	strokes?: readonly AnyPaint[];
	strokeWeight?: number;
	strokeAlign?: unknown;
	cornerRadius?: number;
	clipsContent?: boolean;
	variantProperties?: Record<string, string> | null;
	layoutMode?: string;
	itemSpacing?: number;
	counterAxisSpacing?: number | null;
	paddingTop?: number;
	paddingRight?: number;
	paddingBottom?: number;
	paddingLeft?: number;
	primaryAxisAlignItems?: string;
	counterAxisAlignItems?: string;
	layoutWrap?: string;
	gridRowGap?: number;
	gridColumnGap?: number;
	gridRowSizes?: readonly { type: string; value?: number }[];
	gridColumnSizes?: readonly { type: string; value?: number }[];
	getMainComponentAsync?: () => Promise<{ id: string } | null>;
};

const VECTOR_TYPES = new Set([
	"VECTOR",
	"BOOLEAN_OPERATION",
	"STAR",
	"POLYGON",
	"LINE",
	"ELLIPSE",
]);
const CONTAINER_TYPES = new Set([
	"FRAME",
	"GROUP",
	"COMPONENT",
	"INSTANCE",
	"COMPONENT_SET",
]);

export function readNode(
	node: AnySceneNode & { type: string },
): FigmaNode | null {
	const t = node.type;
	if (t === "TEXT") return readTextNode(node as never);
	if (t === "RECTANGLE") return readRectangleNode(node as never);
	if (VECTOR_TYPES.has(t)) return readVectorNode(node as never);
	if (CONTAINER_TYPES.has(t)) return readContainer(node as AnyContainerNode);
	return null; // unsupported node type — skipped by the caller
}

function readContainer(node: AnyContainerNode): FigmaContainerNode {
	// A COMPONENT_SET keeps ALL its component children (Phase 3 derives variants
	// from them); the transpiler picks the base for template_data. A COMPONENT
	// carries its variantProperties so the transpiler can build the join key.
	const grid = node.layoutMode === "GRID";
	const children = (node.children ?? [])
		.map((c) => {
			const read = readNode(c as AnySceneNode & { type: string });
			return read && grid ? { ...read, ...readGridChild(c) } : read;
		})
		.filter((c): c is FigmaNode => c !== null);

	const result: FigmaContainerNode = {
		...readBaseFields(node),
		type: node.type as FigmaContainerNodeType,
		children,
		fills: readPaints(node.fills),
		strokes: readPaints(node.strokes),
		strokeWeight:
			typeof node.strokeWeight === "number" ? node.strokeWeight : undefined,
		strokeAlign: readStrokeEnum(node.strokeAlign),
		cornerRadius:
			typeof node.cornerRadius === "number" ? node.cornerRadius : undefined,
		clipsContent: node.clipsContent,
		layoutMode: node.layoutMode as never,
		itemSpacing: node.itemSpacing,
		counterAxisSpacing: node.counterAxisSpacing,
		paddingTop: node.paddingTop,
		paddingRight: node.paddingRight,
		paddingBottom: node.paddingBottom,
		paddingLeft: node.paddingLeft,
		primaryAxisAlignItems: node.primaryAxisAlignItems as never,
		counterAxisAlignItems: node.counterAxisAlignItems as never,
		layoutWrap: node.layoutWrap as never,
		...(grid
			? {
					gridRowGap: node.gridRowGap,
					gridColumnGap: node.gridColumnGap,
					gridRowSizes: readTracks(node.gridRowSizes),
					gridColumnSizes: readTracks(node.gridColumnSizes),
				}
			: {}),
	};
	if (node.variantProperties) {
		result.componentProperties = Object.fromEntries(
			Object.entries(node.variantProperties).map(([k, v]) => [
				k,
				{ value: v, type: "VARIANT" },
			]),
		);
	}
	return result;
}

function readTracks(
	tracks: readonly { type: string; value?: number }[] | undefined,
): FigmaGridTrack[] | undefined {
	return tracks?.map((t) => ({
		type: t.type as FigmaGridTrack["type"],
		...(typeof t.value === "number" ? { value: t.value } : {}),
	}));
}

// Where a child sits in its GRID parent. The fields only exist on a grid's
// children, so they are read here rather than for every node.
type GridChildFields = {
	gridRowAnchorIndex?: number;
	gridColumnAnchorIndex?: number;
	gridRowSpan?: number;
	gridColumnSpan?: number;
};

function readGridChild(node: AnySceneNode): GridChildFields {
	const n = node as AnySceneNode & GridChildFields;
	const out: GridChildFields = {};
	for (const key of [
		"gridRowAnchorIndex",
		"gridColumnAnchorIndex",
		"gridRowSpan",
		"gridColumnSpan",
	] as const) {
		if (typeof n[key] === "number") out[key] = n[key];
	}
	return out;
}

/** Entry point: read a selected slot frame (or component set) into a container tree. */
export function readFrameTree(node: AnyContainerNode): FigmaContainerNode {
	return readContainer(node);
}

export async function readContainerAsync(
	node: AnyContainerNode,
): Promise<FigmaContainerNode> {
	const base = readContainer(node);
	if (
		node.type === "INSTANCE" &&
		typeof node.getMainComponentAsync === "function"
	) {
		const main = await node.getMainComponentAsync();
		base.mainComponentId = main?.id ?? null;
	}
	return base;
}
