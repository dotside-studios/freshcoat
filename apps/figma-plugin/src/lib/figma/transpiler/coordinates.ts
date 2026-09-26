import type { FigmaBoundingBox, FigmaTransform } from "../types";
import { applyTransform, decomposeTransform, invertRigid } from "./transform";

export type AuthorSpaceRect = {
	pos: { x: number; y: number };
	size: { width: number; height: number };
};

export function roundHalfPx(n: number): number {
	const doubled = n * 2;
	const rounded = Math.round(doubled);
	if (Math.abs(doubled - Math.floor(doubled) - 0.5) < 1e-9) {
		const floor = Math.floor(doubled);
		return (floor % 2 === 0 ? floor : floor + 1) / 2;
	}
	return rounded / 2;
}

// A raster is the node's pre-rendered pixels filling its rendered region
// (effects + clipping baked in), which Figma exports at absoluteRenderBounds —
// NOT the geometry AABB (absoluteBoundingBox). They differ when a node bleeds
// past a clip or an effect expands it; placing the cropped PNG at the geometry
// box stretches/overflows it.
//
// Render bounds are null, or flat on one axis, for a node Figma considers to
// render nothing on its own — most commonly a LINE, whose geometry box has zero
// thickness and whose paint lives entirely in its stroke. Falling through to the
// geometry box keeps such a node placeable, and a flat axis is inflated by the
// stroke that actually paints it, so a hairline rule gets a box its bitmap can
// land in instead of a zero-area element that draws nothing.
export function renderBoundsOf(node: {
	absoluteBoundingBox: FigmaBoundingBox;
	absoluteRenderBounds?: FigmaBoundingBox | null;
	strokeWeight?: number;
}): FigmaBoundingBox {
	const render = node.absoluteRenderBounds;
	if (render && render.width > 0 && render.height > 0) return render;
	return inflateFlatAxes(node.absoluteBoundingBox, node.strokeWeight ?? 0);
}

// Grow a box across whichever axis has no extent, by the half-stroke that hangs
// off each side of the geometry. A box that is flat with no stroke to inflate it
// stays flat — the caller drops it rather than emitting an invisible element.
function inflateFlatAxes(
	box: FigmaBoundingBox,
	strokeWeight: number,
): FigmaBoundingBox {
	if (box.width > 0 && box.height > 0) return box;
	const pad = Math.max(strokeWeight, 0) / 2;
	const flatX = box.width <= 0;
	const flatY = box.height <= 0;
	return {
		x: flatX ? box.x - pad : box.x,
		y: flatY ? box.y - pad : box.y,
		width: flatX ? box.width + pad * 2 : box.width,
		height: flatY ? box.height + pad * 2 : box.height,
	};
}

export function toAuthorSpace(
	worldBox: FigmaBoundingBox,
	frame: FigmaBoundingBox,
	scale: number,
): AuthorSpaceRect {
	const localX = worldBox.x - frame.x;
	const localY = worldBox.y - frame.y;
	return {
		pos: { x: roundHalfPx(localX * scale), y: roundHalfPx(localY * scale) },
		size: {
			width: roundHalfPx(worldBox.width * scale),
			height: roundHalfPx(worldBox.height * scale),
		},
	};
}

// The axis-aligned box a node covers in its PARENT's space: its own w×h corners
// pushed through relativeTransform. Used to give a GROUP a box of its own — a
// group has no coordinate space in Figma (its children are positioned against
// the nearest FRAME), so the only honest box for one is the extent it covers.
export function localAabb(
	node: {
		relativeTransform?: FigmaTransform;
		width?: number;
		height?: number;
		absoluteBoundingBox: { width: number; height: number };
	},
	scale: number,
): AuthorSpaceRect {
	const w = node.width ?? node.absoluteBoundingBox.width;
	const h = node.height ?? node.absoluteBoundingBox.height;
	const rt = node.relativeTransform;
	if (!rt) {
		return {
			pos: { x: 0, y: 0 },
			size: { width: roundHalfPx(w * scale), height: roundHalfPx(h * scale) },
		};
	}
	const corners = [
		applyTransform(rt, 0, 0),
		applyTransform(rt, w, 0),
		applyTransform(rt, w, h),
		applyTransform(rt, 0, h),
	];
	const xs = corners.map((c) => c.x);
	const ys = corners.map((c) => c.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return {
		pos: { x: roundHalfPx(minX * scale), y: roundHalfPx(minY * scale) },
		size: {
			width: roundHalfPx((Math.max(...xs) - minX) * scale),
			height: roundHalfPx((Math.max(...ys) - minY) * scale),
		},
	};
}

/** `t` shifted by (dx, dy) expressed in the space `t` describes — the world
 *  transform of a child box sitting at that local offset. */
export function translateLocal(
	t: FigmaTransform,
	dx: number,
	dy: number,
): FigmaTransform {
	const [[a, b, tx], [c, d, ty]] = t;
	return [
		[a, b, tx + a * dx + b * dy],
		[c, d, ty + c * dx + d * dy],
	];
}

/** The coordinate space a raster is being parked in: the box its `pos` is
 *  measured from, plus how that space sits in the world. At slot level the
 *  slot frame's own rotation is stripped (it becomes the axis-aligned card), so
 *  local space IS world space — `transform` is null and `rotation` is 0. */
export type RasterFrame = {
	box: FigmaBoundingBox;
	transform?: FigmaTransform | null;
	rotation: number;
	/** Where this space's origin sits inside the coordinate frame the placement
	 *  functions measure against, in AUTHOR units. Non-zero only inside a GROUP
	 *  given a layer of its own: its children are still positioned against the
	 *  enclosing FRAME (Figma gives a group no coordinate space), so what they
	 *  place to has to be shifted onto the group's own box. */
	originOffset?: { x: number; y: number };
};

// Where a node's exported bitmap goes. The PNG fills the node's world-axis-
// aligned RENDERED region, with rotation, effects and clipping already baked
// into the pixels, so it has to land upright in world no matter which frame it
// is emitted into.
//
// In an upright frame that is just the region re-anchored. In a ROTATED one the
// element carries the INVERSE of the frame's world rotation, so the painter's
// rotation of the group cancels back to upright — the raster stays a child of
// the frame its node belonged to, which is the only way it keeps that frame's
// z-order and clip. (Hoisting it to the card instead sinks it under every
// sibling the frame draws, since the frame element is pushed only after its
// subtree is walked.)
export function placeRasterIn(
	worldBox: FigmaBoundingBox,
	frame: RasterFrame,
	scale: number,
): {
	pos: { x: number; y: number };
	size: { width: number; height: number };
	rotation: number;
} {
	const off = frame.originOffset ?? { x: 0, y: 0 };
	if (!frame.transform || frame.rotation === 0) {
		const placed = toAuthorSpace(worldBox, frame.box, scale);
		return {
			pos: { x: placed.pos.x - off.x, y: placed.pos.y - off.y },
			size: placed.size,
			rotation: 0,
		};
	}
	const size = {
		width: roundHalfPx(worldBox.width * scale),
		height: roundHalfPx(worldBox.height * scale),
	};
	// Rotation is around the element's own centre, so the centre — not the
	// corner — is what has to land in the right place.
	const local = invertRigid(
		frame.transform,
		worldBox.x + worldBox.width / 2,
		worldBox.y + worldBox.height / 2,
	);
	return {
		pos: {
			x: roundHalfPx(local.x * scale - size.width / 2) - off.x,
			y: roundHalfPx(local.y * scale - size.height / 2) - off.y,
		},
		size,
		rotation: -frame.rotation,
	};
}

export type PlaceResult =
	| {
			pos: { x: number; y: number };
			size: { width: number; height: number };
			rotation: number;
	  }
	| { fallback: "flatten" };

// Thrown by a native leaf transpiler when placement returns { fallback: "flatten" }
// (skew / non-uniform scale — no clean pos/size/rotation). The walk catches it and
// rasterizes the node instead, exactly like a `classify` flatten. A typed error
// (not a string match) so the walk can tell it apart from real failures.
export class FlattenFallbackError extends Error {
	constructor(public readonly nodeId: string) {
		super(`placeLocal flatten fallback for ${nodeId}`);
		this.name = "FlattenFallbackError";
	}
}

// The single parent-local placement function for every node type. Decomposes
// the node's parent-relative transform into coatfile's {pos (unrotated
// top-left in PARENT space), size (unrotated w×h), rotation (around center)}.
// Returns { fallback: "flatten" } when the transform isn't a clean
// rotation+translation (skew / non-uniform scale) — caller rasterizes.
export function placeLocal(
	node: {
		relativeTransform?: FigmaTransform;
		width?: number;
		height?: number;
		absoluteBoundingBox: {
			x: number;
			y: number;
			width: number;
			height: number;
		};
	},
	scale: number,
): PlaceResult {
	const rt = node.relativeTransform;
	const w = node.width ?? node.absoluteBoundingBox.width;
	const h = node.height ?? node.absoluteBoundingBox.height;
	if (!rt) {
		return {
			pos: { x: roundHalfPx(0), y: roundHalfPx(0) },
			size: { width: roundHalfPx(w * scale), height: roundHalfPx(h * scale) },
			rotation: 0,
		};
	}
	const decomposed = decomposeTransform(rt, Math.max(w, h, 1));
	if (!decomposed.ok) return { fallback: "flatten" };
	const center = applyTransform(rt, w / 2, h / 2);
	const topLeftX = (center.x - w / 2) * scale;
	const topLeftY = (center.y - h / 2) * scale;
	return {
		pos: { x: roundHalfPx(topLeftX), y: roundHalfPx(topLeftY) },
		size: { width: roundHalfPx(w * scale), height: roundHalfPx(h * scale) },
		rotation: decomposed.rotation,
	};
}

// World placement for a slot's direct children: the slot frame's rotation is
// stripped (it becomes the axis-aligned card), so its children are placed in
// the slot's world-AABB space. Uses absoluteTransform (world) re-anchored to
// the anchor AABB origin. Mirror of placeLocal but world-based.
export function placeWorld(
	node: {
		absoluteTransform?: FigmaTransform;
		width?: number;
		height?: number;
		absoluteBoundingBox: {
			x: number;
			y: number;
			width: number;
			height: number;
		};
	},
	anchor: { x: number; y: number },
	scale: number,
): PlaceResult {
	const at = node.absoluteTransform;
	const w = node.width ?? node.absoluteBoundingBox.width;
	const h = node.height ?? node.absoluteBoundingBox.height;
	if (!at) {
		// No transform: fall back to the axis-aligned world AABB re-anchored.
		return {
			pos: {
				x: roundHalfPx((node.absoluteBoundingBox.x - anchor.x) * scale),
				y: roundHalfPx((node.absoluteBoundingBox.y - anchor.y) * scale),
			},
			size: { width: roundHalfPx(w * scale), height: roundHalfPx(h * scale) },
			rotation: 0,
		};
	}
	const decomposed = decomposeTransform(at, Math.max(w, h, 1));
	if (!decomposed.ok) return { fallback: "flatten" };
	const center = applyTransform(at, w / 2, h / 2); // world center
	const topLeftX = (center.x - anchor.x - w / 2) * scale;
	const topLeftY = (center.y - anchor.y - h / 2) * scale;
	return {
		pos: { x: roundHalfPx(topLeftX), y: roundHalfPx(topLeftY) },
		size: { width: roundHalfPx(w * scale), height: roundHalfPx(h * scale) },
		rotation: decomposed.rotation,
	};
}
