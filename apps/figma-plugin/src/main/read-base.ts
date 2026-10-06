import type {
	FigmaBlendMode,
	FigmaConstraints,
	FigmaEffect,
	FigmaTransform,
	FigmaVectorNode,
} from "~/lib/figma/types";
import { readBinding, readFieldMeta } from "~/main/plugin-data";

type AnyEffect = {
	type: string;
	visible?: boolean;
	radius?: number;
	spread?: number;
	offset?: { x: number; y: number };
	color?: { r: number; g: number; b: number; a: number };
	blendMode?: string;
	blurType?: string;
};

export type AnySceneNode = {
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
		...(e.blendMode && e.blendMode !== "NORMAL"
			? { blendMode: e.blendMode as FigmaBlendMode }
			: {}),
		...(e.blurType === "PROGRESSIVE"
			? { blurType: "PROGRESSIVE" as const }
			: {}),
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
