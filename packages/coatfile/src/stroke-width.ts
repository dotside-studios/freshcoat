import type { Sides, StrokeSideWidths } from "./types";

/** A stroke width as each side's, a side left out or negative as 0. Null for
 *  one number. */
export function strokeSides(width: number | StrokeSideWidths): Sides | null {
	if (typeof width === "number") return null;
	const side = (v: number | undefined) =>
		typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
	return {
		top: side(width.top),
		right: side(width.right),
		bottom: side(width.bottom),
		left: side(width.left),
	};
}

/** The widest side of a stroke width, or the width itself. */
export function widestStroke(width: number | StrokeSideWidths): number {
	const sides = strokeSides(width);
	return sides
		? Math.max(sides.top, sides.right, sides.bottom, sides.left)
		: (width as number);
}
