import { scalePathData } from "@freshcoat-js/engine/path";
import type {
	FigmaBooleanOperation,
	FigmaNode,
	FigmaTransform,
	FigmaVectorNode,
} from "../types";
import { vectorFillRule } from "./classify";
import { roundHalfPx } from "./coordinates";
import { scaleCorners } from "./rect";
import { applyTransform, decomposeTransform, nodeExtent } from "./transform";

const OPS = {
	UNION: "union",
	SUBTRACT: "subtract",
	INTERSECT: "intersect",
	EXCLUDE: "exclude",
} as const satisfies Record<FigmaBooleanOperation, string>;

type Operand = {
	id: string;
	type: "rect" | "vector";
	pos: { x: number; y: number };
	size: { width: number; height: number };
	rotation?: number;
	properties: Record<string, unknown>;
};

export type LiveBoolean = {
	op: (typeof OPS)[FigmaBooleanOperation];
	operands: Operand[];
};

/** A boolean operand and the Figma layer it came from. */
export type OperandNode = { node: FigmaNode; operand: Operand };

/** A boolean operation kept live, with every operand at any depth beside its
 *  layer, or why it could not be. */
export type BooleanResult =
	| { boolean: LiveBoolean; operands: OperandNode[] }
	| { blocker: string };

type Placement = Pick<Operand, "pos" | "size" | "rotation">;

function invert([
	[a, b, tx],
	[c, d, ty],
]: FigmaTransform): FigmaTransform | null {
	const det = a * d - b * c;
	if (Math.abs(det) < 1e-12) return null;
	return [
		[d / det, -b / det, (b * ty - d * tx) / det],
		[-c / det, a / det, (c * tx - a * ty) / det],
	];
}

function multiply(p: FigmaTransform, q: FigmaTransform): FigmaTransform {
	const [[a, b, tx], [c, d, ty]] = p;
	const [[e, f, ux], [g, h, uy]] = q;
	return [
		[a * e + b * g, a * f + b * h, a * ux + b * uy + tx],
		[c * e + d * g, c * f + d * h, c * ux + d * uy + ty],
	];
}

// A child's transform inside its boolean. Both sit in the space of the nearest
// frame, since a boolean opens none, so the transform between them is the same
// whichever pair the read supplied.
function within(parent: FigmaNode, child: FigmaNode): FigmaTransform | null {
	const pair =
		parent.absoluteTransform && child.absoluteTransform
			? [parent.absoluteTransform, child.absoluteTransform]
			: parent.relativeTransform && child.relativeTransform
				? [parent.relativeTransform, child.relativeTransform]
				: undefined;
	if (!pair) {
		const box = parent.absoluteBoundingBox;
		const at = child.absoluteBoundingBox;
		return [
			[1, 0, at.x - box.x],
			[0, 1, at.y - box.y],
		];
	}
	const inverse = invert(pair[0]);
	return inverse && multiply(inverse, pair[1]);
}

// Where a child sits in the boolean's own box, as the unrotated top-left,
// size and turn about the centre that coatfile elements use. Null when the
// transform is not a rotation and translation.
function place(
	parent: FigmaNode,
	child: FigmaNode,
	scale: number,
): Placement | null {
	const t = within(parent, child);
	if (!t) return null;
	const w = child.width ?? child.absoluteBoundingBox.width;
	const h = child.height ?? child.absoluteBoundingBox.height;
	const [[a, b], [c, d]] = t;
	if (a * d - b * c <= 0) return null;
	const decomposed = decomposeTransform(t, nodeExtent(child));
	if (!decomposed.ok) return null;
	const center = applyTransform(t, w / 2, h / 2);
	return {
		pos: {
			x: roundHalfPx((center.x - w / 2) * scale),
			y: roundHalfPx((center.y - h / 2) * scale),
		},
		size: { width: roundHalfPx(w * scale), height: roundHalfPx(h * scale) },
		...(decomposed.rotation !== 0 ? { rotation: decomposed.rotation } : {}),
	};
}

const idOf = (n: FigmaNode) =>
	n.name.replace(/[^a-zA-Z0-9_]/g, "_") || n.id.replace(":", "_");

function pathOf(n: FigmaVectorNode, scale: number) {
	const geometry = n.fillGeometry ?? [];
	if (geometry.length === 0) return null;
	const fillRule = vectorFillRule(geometry);
	if (fillRule === null) return null;
	return {
		d: geometry.map((g) => scalePathData(g.path, scale)).join(" "),
		...(fillRule ? { fillRule } : {}),
	};
}

function operandOf(
	parent: FigmaVectorNode,
	child: FigmaNode,
	scale: number,
	nested: OperandNode[],
): Operand | string {
	const label = `"${child.name}"`;
	if (child.isMask) return `${label} is a mask`;
	if (
		child.type !== "RECTANGLE" &&
		child.type !== "BOOLEAN_OPERATION" &&
		child.type !== "VECTOR" &&
		child.type !== "ELLIPSE" &&
		child.type !== "STAR" &&
		child.type !== "POLYGON"
	)
		return `${label} is a ${child.type.toLowerCase().replace(/_/g, " ")}`;
	const placed = place(parent, child, scale);
	if (!placed) return `${label} is skewed, flipped or scaled`;
	if (child.type === "RECTANGLE") {
		if (child.cornerSmoothing && child.cornerRadius)
			return `${label} has corner smoothing`;
		const corners = scaleCorners(child.cornerRadius, scale);
		return {
			id: idOf(child),
			type: "rect",
			...placed,
			properties: corners !== undefined ? { cornerRadius: corners } : {},
		};
	}
	const path = pathOf(child, scale);
	if (!path) return `${label} has no fill region`;
	const inner =
		child.type === "BOOLEAN_OPERATION" ? liveBoolean(child, scale) : undefined;
	if (inner && "blocker" in inner) return inner.blocker;
	if (inner) nested.push(...inner.operands);
	return {
		id: idOf(child),
		type: "vector",
		...placed,
		properties: { ...path, ...(inner ? { boolean: inner.boolean } : {}) },
	};
}

/** The live form of a BOOLEAN_OPERATION: its operation and the children that
 *  take part, bottom-most first. A hidden child is not part of Figma's result,
 *  so it is left out. A child that cannot be an operand keeps the whole
 *  operation flat, since the others alone would not give the same shape. Null
 *  for a node read without its children. */
export function liveBoolean(
	node: FigmaVectorNode,
	scale: number,
): BooleanResult | null {
	if (!node.booleanOperation || !node.children) return null;
	const operands: Operand[] = [];
	const nodes: OperandNode[] = [];
	for (const child of node.children) {
		if (child.visible === false) continue;
		const operand = operandOf(node, child, scale, nodes);
		if (typeof operand === "string") return { blocker: operand };
		operands.push(operand);
		nodes.push({ node: child, operand });
	}
	if (operands.length === 0) return { blocker: "it has no visible children" };
	return {
		boolean: { op: OPS[node.booleanOperation], operands },
		operands: nodes,
	};
}
