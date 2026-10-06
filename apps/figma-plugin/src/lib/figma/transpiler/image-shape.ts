import type { FigmaNode, FigmaRectangleNode, FigmaVectorNode } from "../types";

const EPS = 1e-4;

/** Whether an image element's mask can draw this layer's outline: a rectangle,
 *  a full solid ellipse, or a polygon with sharp corners. */
export function canHoldImage(
	n: FigmaNode,
): n is FigmaRectangleNode | FigmaVectorNode {
	if (n.type === "RECTANGLE") return true;
	if (n.type === "ELLIPSE") {
		const arc = n.arcData;
		if (!arc) return true;
		return (
			arc.innerRadius <= EPS &&
			Math.abs(arc.endingAngle - arc.startingAngle) >= 2 * Math.PI - EPS
		);
	}
	if (n.type === "POLYGON")
		return (n.pointCount ?? 0) >= 3 && !((n.cornerRadius ?? 0) > 0);
	return false;
}
