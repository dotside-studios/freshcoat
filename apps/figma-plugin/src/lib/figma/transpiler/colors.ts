import { linearGradientAngle } from "@freshcoat-js/coatfile";
import type { FigmaColor, FigmaPaint } from "../types";
import {
	angularPlacement,
	channel,
	figmaColorToHex,
	type PaintBox,
	round4,
} from "./paint";

export type { PaintBox } from "./paint";
export { compositeSolids, figmaColorToHex, isMappablePaint } from "./paint";

type SolidFillResult = { kind: "solid"; hex: string; opacity: number };
type GradientFillResult = {
	kind: "fill";
	value:
		| {
				kind: "linear";
				angle: number;
				from?: [number, number];
				to?: [number, number];
				stops: Array<{ offset: number; color: string }>;
		  }
		| {
				kind: "radial";
				center: [number, number];
				radius: number;
				radiusY?: number;
				rotation?: number;
				stops: Array<{ offset: number; color: string }>;
		  }
		| {
				kind: "angular";
				center: [number, number];
				rotation?: number;
				stops: Array<{ offset: number; color: string }>;
		  };
};

export type FillResult = SolidFillResult | GradientFillResult;

function colorWithoutAlpha(c: FigmaColor): string {
	return `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
}

type RadialShape = { radius: number; radiusY: number; rotation: number };

// A radial gradient's handles are its center and the ends of its two axes, so
// those axes ARE its radii — and they are rarely equal. The certificate's fog is
// a tall narrow ellipse reaching far above the card and barely past its sides;
// collapsing that to a circle spreads the glow sideways across the whole design.
//
// Each handle is normalized per axis (x by the width, y by the height), so the
// two only compare as lengths once scaled back into the box; coatfile then
// measures both against the LONGEST side, so one number means the same distance
// whichever axis it describes. The longer axis leads, which keeps `radius` the
// gradient's reach and `rotation` the angle it reaches along.
//
// Without a box the handles are taken as already isotropic — exact for a square
// drawable, and the best available guess otherwise.
function radialShape(
	handles: Array<{ x: number; y: number }>,
	box: PaintBox | undefined,
): RadialShape {
	const w = box?.width ?? 1;
	const h = box?.height ?? 1;
	const longest = Math.max(w, h);
	if (!(longest > 0)) return { radius: 0.5, radiusY: 0.5, rotation: 0 };
	const [center, ...axes] = handles;
	const vectors = axes
		.filter((a) => a !== undefined)
		.map((a) => ({ x: (a.x - center.x) * w, y: (a.y - center.y) * h }));
	// A paint with no axis handles at all says nothing about its reach; the
	// gradient that just fills its shape is the only sensible reading.
	if (vectors.length === 0) return { radius: 0.5, radiusY: 0.5, rotation: 0 };
	const lengths = vectors.map((v) => Math.hypot(v.x, v.y));
	const primary = lengths[1] > lengths[0] ? 1 : 0;
	const secondary = primary === 0 ? 1 : 0;
	const degrees =
		(Math.atan2(vectors[primary].y, vectors[primary].x) * 180) / Math.PI;
	return {
		radius: lengths[primary] / longest,
		radiusY: (lengths[secondary] ?? lengths[primary]) / longest,
		rotation: ((degrees % 360) + 360) % 360,
	};
}

// Degrees. Figma's transforms carry float noise — a gradient authored square to
// its shape arrives with matrix entries like 2.19e-16, which come back out as
// 179.99999999999932 rather than 180.
const ROTATION_EPSILON = 1e-6;

// An ellipse is symmetric about its center, so a half turn lands it back on
// itself: only the angle modulo 180 means anything, and 180 itself is no
// rotation at all. Folding without a tolerance leaves every axis-aligned
// gradient claiming to be turned, which is noise in the output and costs the
// painter its no-transform path.
function foldRotation(degrees: number): number {
	const folded = ((degrees % 180) + 180) % 180;
	return folded < ROTATION_EPSILON || 180 - folded < ROTATION_EPSILON
		? 0
		: folded;
}

// The smallest separation between a linear gradient's ends, in fractions of the
// box, that still gives it a direction. Closer than this, the handles say
// nothing reliable about which way it runs.
const DEGENERATE_HANDLES = 1e-4;

// Figma's first two handles are the gradient's start and end, already in
// fractions of the layer's own box, which is exactly how coatfile places
// `from` and `to`. They keep the gradient's length and offset, which an angle
// alone (always centred and reaching the box's edges) loses. `angle` says the
// same direction for a reader that predates the points. Handles that coincide
// have no direction, and coatfile refuses equal points, so those fall back to
// the angle only.
function linearPlacement(paint: {
	gradientHandlePositions: Array<{ x: number; y: number }>;
}): { angle: number; from?: [number, number]; to?: [number, number] } {
	const [start, end] = paint.gradientHandlePositions;
	if (!start || !end) return { angle: 0 };
	const from: [number, number] = [round4(start.x), round4(start.y)];
	const to: [number, number] = [round4(end.x), round4(end.y)];
	const angle = Math.round(linearGradientAngle(from, to) * 100) / 100;
	if (Math.hypot(to[0] - from[0], to[1] - from[1]) < DEGENERATE_HANDLES) {
		return { angle: 0 };
	}
	return { angle: angle === 360 ? 0 : angle, from, to };
}

export function figmaPaintToFill(
	paint: FigmaPaint,
	box?: PaintBox,
): FillResult {
	if (paint.type === "SOLID") {
		const paintOpacity = paint.opacity ?? 1;
		const channelAlpha = paint.color.a;
		return {
			kind: "solid",
			hex: colorWithoutAlpha(paint.color),
			opacity: paintOpacity * channelAlpha,
		};
	}
	if (
		paint.type === "GRADIENT_LINEAR" ||
		paint.type === "GRADIENT_RADIAL" ||
		paint.type === "GRADIENT_ANGULAR"
	) {
		// A gradient has no single colour to hang the paint's own opacity on, so
		// it folds into every stop's alpha — the same thing Figma composites. A
		// coatfile gradient stop carries its colour and nothing else, so
		// dropping it renders a half-faded wash at full strength.
		const paintOpacity = paint.opacity ?? 1;
		const stops = paint.gradientStops.map((s) => ({
			offset: s.position,
			color: figmaColorToHex({ ...s.color, a: s.color.a * paintOpacity }),
		}));
		if (paint.type === "GRADIENT_LINEAR") {
			return {
				kind: "fill",
				value: { kind: "linear", ...linearPlacement(paint), stops },
			};
		}
		if (paint.type === "GRADIENT_ANGULAR") {
			const placed = angularPlacement(paint.gradientHandlePositions, box);
			if (!placed) throw new Error("unsupported paint type: uneven angular");
			return {
				kind: "fill",
				value: {
					kind: "angular",
					center: placed.center,
					...(placed.rotation !== 0 ? { rotation: placed.rotation } : {}),
					stops,
				},
			};
		}
		const handles = paint.gradientHandlePositions;
		const center: [number, number] = [handles[0].x, handles[0].y];
		const shape = radialShape(handles, box);
		// A circular, unrotated gradient needs neither field; leaving them off
		// keeps the common case reading as the plain circle it is.
		const elliptical = Math.abs(shape.radiusY - shape.radius) > 1e-6;
		const rotation = foldRotation(shape.rotation);
		return {
			kind: "fill",
			value: {
				kind: "radial",
				center,
				radius: round4(shape.radius),
				...(elliptical ? { radiusY: round4(shape.radiusY) } : {}),
				...(elliptical && rotation !== 0 ? { rotation: round4(rotation) } : {}),
				stops,
			},
		};
	}
	throw new Error(`unsupported paint type: ${paint.type}`);
}

// Figma stroke-cap enum → coatfile. Returns undefined for the canvas
// default (butt) so callers can omit it and keep output lean. Arrow caps
// (ARROW_*) and NONE are unsupported → butt → undefined.
export function mapStrokeCap(
	figmaCap: string | undefined,
): "round" | "square" | undefined {
	if (figmaCap === "ROUND") return "round";
	if (figmaCap === "SQUARE") return "square";
	return undefined;
}

// Figma stroke-join enum → coatfile. Returns undefined for the canvas
// default (miter) so callers can omit it.
export function mapStrokeJoin(
	figmaJoin: string | undefined,
): "round" | "bevel" | undefined {
	if (figmaJoin === "ROUND") return "round";
	if (figmaJoin === "BEVEL") return "bevel";
	return undefined;
}

// Figma stroke-alignment enum → coatfile. Figma centres a stroke on the
// path only for an open one; a closed shape or a frame defaults to INSIDE, so a
// 4px border sits entirely within the box rather than straddling it. Returns
// undefined for CENTER (the painter's own default) so an unaligned stroke stays
// out of the emitted element.
export function mapStrokeAlign(
	figmaAlign: string | undefined,
): "inside" | "outside" | undefined {
	if (figmaAlign === "INSIDE") return "inside";
	if (figmaAlign === "OUTSIDE") return "outside";
	return undefined;
}

/** A shape's visible paints as its coatfile `fill`: one fill, or the stack
 *  bottom-up. A lone solid's alpha rides as the element's opacity, as it always
 *  has; in a stack each solid keeps its own. */
export function fillsToElement(
	paints: FigmaPaint[] | undefined,
	box: PaintBox,
): { fill?: unknown; opacity?: number } {
	const visible = (paints ?? []).filter((f) => f.visible !== false);
	if (visible.length === 0) return {};
	if (visible.length === 1) {
		const result = figmaPaintToFill(visible[0], box);
		if (result.kind === "fill") return { fill: result.value };
		return result.opacity < 1
			? { fill: result.hex, opacity: result.opacity }
			: { fill: result.hex };
	}
	return {
		fill: visible.map((f) => {
			const r = figmaPaintToFill(f, box);
			if (r.kind === "fill") return r.value;
			return r.opacity < 1
				? `${r.hex}${Math.round(r.opacity * 255)
						.toString(16)
						.padStart(2, "0")}`
				: r.hex;
		}),
	};
}
