import type {
	FigmaContainerNode,
	FigmaContainerNodeType,
	FigmaGridTrack,
	FigmaNode,
	FigmaRectangleNode,
	FigmaVectorNode,
	FigmaVectorNodeType,
} from "~/lib/figma/types";
import { isContainerNode, isVectorNode } from "~/lib/figma/types";
import { type AnySceneNode, readBaseFields } from "~/main/read-base";
import { type AnyPaint, readPaints } from "~/main/read-paint";
import { readTextNode } from "~/main/read-text";

// Figma returns figma.mixed (a symbol) for per-segment caps/joins. Only
// pass through plain string enums; mixed/other falls back to undefined.
function readStrokeEnum(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readDashPattern(value: unknown): number[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	if (!value.every((v) => typeof v === "number")) return undefined;
	return [...value];
}

function readCornerSmoothing(value: unknown): number | undefined {
	return typeof value === "number" && value > 0 ? value : undefined;
}

type AnyRectNode = AnySceneNode & {
	fills?: readonly AnyPaint[];
	strokes?: readonly AnyPaint[];
	strokeWeight?: number;
	strokeCap?: unknown;
	strokeJoin?: unknown;
	strokeAlign?: unknown;
	dashPattern?: unknown;
	cornerRadius?: unknown;
	cornerSmoothing?: unknown;
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
function readCornerRadius(node: {
	cornerRadius?: unknown;
	topLeftRadius?: number;
	topRightRadius?: number;
	bottomRightRadius?: number;
	bottomLeftRadius?: number;
}): number | [number, number, number, number] | undefined {
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
		...dashField(node.dashPattern),
		cornerRadius: readCornerRadius(node),
		...(readCornerSmoothing(node.cornerSmoothing) !== undefined
			? { cornerSmoothing: readCornerSmoothing(node.cornerSmoothing) }
			: {}),
	};
}

function dashField(value: unknown): { dashPattern?: number[] } {
	const dashPattern = readDashPattern(value);
	return dashPattern ? { dashPattern } : {};
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
	dashPattern?: unknown;
	vectorPaths?: AnyVectorPaths;
	fillGeometry?: AnyVectorPaths;
	arcData?: FigmaVectorNode["arcData"];
	pointCount?: number;
	cornerRadius?: unknown;
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
		...dashField(node.dashPattern),
		fillGeometry: readGeometry(node),
		...(node.type === "ELLIPSE" && node.arcData
			? {
					arcData: {
						startingAngle: node.arcData.startingAngle,
						endingAngle: node.arcData.endingAngle,
						innerRadius: node.arcData.innerRadius,
					},
				}
			: {}),
		...(node.type === "POLYGON" && typeof node.pointCount === "number"
			? { pointCount: node.pointCount }
			: {}),
		...(node.type === "POLYGON" && typeof node.cornerRadius === "number"
			? { cornerRadius: node.cornerRadius }
			: {}),
	};
}

type AnyContainerNode = AnySceneNode & {
	type: string;
	children?: readonly AnySceneNode[];
	fills?: readonly AnyPaint[];
	strokes?: readonly AnyPaint[];
	strokeWeight?: number;
	strokeAlign?: unknown;
	dashPattern?: unknown;
	cornerRadius?: unknown;
	topLeftRadius?: number;
	topRightRadius?: number;
	bottomRightRadius?: number;
	bottomLeftRadius?: number;
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

export function readNode(
	node: AnySceneNode & { type: string },
): FigmaNode | null {
	const t = node.type;
	if (t === "TEXT") return readTextNode(node as never);
	if (t === "RECTANGLE") return readRectangleNode(node as never);
	if (isVectorNode(node)) return readVectorNode(node as never);
	if (isContainerNode(node)) return readContainer(node as AnyContainerNode);
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
		...dashField(node.dashPattern),
		cornerRadius: readCornerRadius(node),
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
