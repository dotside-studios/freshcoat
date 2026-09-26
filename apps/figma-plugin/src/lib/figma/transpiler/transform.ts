import type { FigmaTransform } from "../types";

export type DecomposeResult =
	| { ok: true; rotation: number }
	| { ok: false; reason: "non_uniform_scale" | "skew" };

// How far a distortion may drag the node's own far corner, in Figma pixels,
// before the transform stops counting as a clean rotation.
//
// Figma composes a nested node's matrix in float32 and re-multiplies it through
// every ancestor, so a layer that is a pure rotation in the file arrives a hair
// off-orthogonal — an icon three groups deep decomposes to a shear of 0.015°.
// A unitless epsilon cannot tell that apart from a shear an author drew: the
// same ratio is invisible on a 48px icon and obvious on a 3000px panel. Judging
// the distortion by the pixels it actually moves does, and a quarter pixel is
// half the half-pixel grid every emitted coordinate is snapped to — under it,
// nothing survives to the rendered card, while rejecting it costs the author a
// crisp vector replaced by a bitmap.
const TOLERANCE_PX = 0.25;

/** The node's longest side — the lever arm a shear or an unequal axis scale
 *  acts through. Floored at 1px so a zero-sized node still gets a real test. */
export function nodeExtent(node: {
	width?: number;
	height?: number;
	absoluteBoundingBox?: { width: number; height: number };
}): number {
	const w = node.width ?? node.absoluteBoundingBox?.width ?? 0;
	const h = node.height ?? node.absoluteBoundingBox?.height ?? 0;
	return Math.max(w, h, 1);
}

/** `extent` is the node's longest side in FIGMA pixels (see nodeExtent) — the
 *  tolerance is geometric, so the same matrix decomposes on a small node and
 *  is rejected on a large one. */
export function decomposeTransform(
	t: FigmaTransform,
	extent: number,
): DecomposeResult {
	const [[a, b], [c, d]] = t;

	// Column lengths: how long the images of the local x and y axes are.
	const sx = Math.sqrt(a * a + c * c);
	const sy = Math.sqrt(b * b + d * d);
	if (sx === 0 || sy === 0) return { ok: false, reason: "non_uniform_scale" };

	// sin of the angle by which the two axes fall short of perpendicular; it
	// drags the far corner `skew · sy · extent` px along the x axis.
	const skew = (a * b + c * d) / (sx * sy);
	if (Math.abs(skew) * sy * extent > TOLERANCE_PX)
		return { ok: false, reason: "skew" };

	// Unequal axis scales stretch that same corner by `|sx − sy| · extent` px.
	if (Math.abs(sx - sy) * extent > TOLERANCE_PX)
		return { ok: false, reason: "non_uniform_scale" };

	// Both axes get a vote on the angle. Averaging them — circularly, so the
	// ±180° seam needs no special case — puts the emitted rotation in the middle
	// of the wedge the two columns disagree over instead of pinning it to
	// whichever one is read first.
	const angleU = Math.atan2(c, a);
	const angleV = Math.atan2(-b, d);
	const angleRad = Math.atan2(
		Math.sin(angleU) + Math.sin(angleV),
		Math.cos(angleU) + Math.cos(angleV),
	);
	const rotation = Math.round(((angleRad * 180) / Math.PI) * 1e4) / 1e4;
	return { ok: true, rotation: rotation === 0 ? 0 : rotation };
}

export function applyTransform(
	t: FigmaTransform,
	x: number,
	y: number,
): { x: number; y: number } {
	const [[a, b, tx], [c, d, ty]] = t;
	return { x: a * x + b * y + tx, y: c * x + d * y + ty };
}

/** Map a world point back into the coordinate space `t` describes, treating `t`
 *  as a rigid rotation + translation. Any uniform scale in `t` is ignored, for
 *  the same reason placeLocal ignores it: a nested element's emitted size is the
 *  node's own w×h and the painter composes frames without scaling, so local
 *  units and author units are 1:1 throughout the tree. */
export function invertRigid(
	t: FigmaTransform,
	x: number,
	y: number,
): { x: number; y: number } {
	const [[a, b, tx], [c, d, ty]] = t;
	const sx = Math.sqrt(a * a + c * c) || 1;
	const sy = Math.sqrt(b * b + d * d) || 1;
	// Columns normalized, then transposed — the inverse of an orthonormal basis.
	const ux = a / sx;
	const uy = c / sx;
	const vx = b / sy;
	const vy = d / sy;
	const dx = x - tx;
	const dy = y - ty;
	return { x: ux * dx + uy * dy, y: vx * dx + vy * dy };
}
