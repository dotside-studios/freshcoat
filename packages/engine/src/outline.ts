// The one geometry construction behind fills, aligned strokes, clips and
// predicted bounds, so a shape covers the same pixels whichever draws it.

import { insetCorner } from "./paint-helpers";
import { squircleSvg } from "./squircle";
import type { CornerRadius, ShapeMask } from "./types";

// What draws or clips the outline: a plain rect, a Skia RRect (exact for
// circular corners, radii [topLeft, topRight, bottomRight, bottomLeft]), or an
// SVG path for everything else.
export type OutlineGeometry =
	| { kind: "rect"; ltrb: [number, number, number, number] }
	| {
			kind: "rrect";
			ltrb: [number, number, number, number];
			radii: [number, number, number, number];
	  }
	| { kind: "path"; d: string };

// The shape a rect draws with `cornerRadius` and `cornerSmoothing`. Smoothing
// applies to a uniform radius; per-corner radii stay circular.
export function rectShape(
	cornerRadius: CornerRadius | undefined,
	cornerSmoothing: number | undefined,
): ShapeMask {
	const cr = cornerRadius ?? 0;
	if (typeof cr === "number" ? cr <= 0 : !cr.some((r) => r > 0))
		return { kind: "rect" };
	const smoothing = cornerSmoothing ?? 0;
	return smoothing > 0 && typeof cr === "number"
		? { kind: "rounded-rect", radius: cr, smoothing }
		: { kind: "rounded-rect", radius: cr };
}

// Whether the outline needs a path rather than a rect or RRect, whatever the
// box. Paths are not origin invariant inside a layer.
export function outlineIsPath(shape: ShapeMask): boolean {
	if (shape.kind === "rect") return false;
	if (shape.kind === "rounded-rect") return smoothedRadius(shape) !== null;
	return true;
}

function smoothedRadius(
	shape: Extract<ShapeMask, { kind: "rounded-rect" }>,
): number | null {
	return (shape.smoothing ?? 0) > 0 && typeof shape.radius === "number"
		? shape.radius
		: null;
}

// The outline of `shape` over the box (x, y, w, h) moved in by `inset` on
// every side (out when negative), as an inside/outside stroke follows it. Null
// when insetting the box is not an offset of the outline (a polygon, an
// outset rect); such a stroke clips a doubled stroke to the uninset outline.
export function outlineGeometry(
	shape: ShapeMask,
	x: number,
	y: number,
	w: number,
	h: number,
	inset = 0,
): OutlineGeometry | null {
	const ix = x + inset;
	const iy = y + inset;
	const iw = w - 2 * inset;
	const ih = h - 2 * inset;
	switch (shape.kind) {
		case "rect": {
			if (!shape.outset)
				return { kind: "rect", ltrb: [ix, iy, ix + iw, iy + ih] };
			if (inset !== 0) return null;
			const top = shape.outset.top ?? 0;
			const bottom = shape.outset.bottom ?? 0;
			return { kind: "rect", ltrb: [x, y - top, x + w, y + h + bottom] };
		}
		case "rounded-rect": {
			const smoothR = smoothedRadius(shape);
			if (smoothR !== null)
				return {
					kind: "path",
					d: squircleSvg(
						ix,
						iy,
						iw,
						ih,
						Math.max(0, smoothR - inset),
						shape.smoothing ?? 0,
					),
				};
			const cr = insetCorner(shape.radius, inset);
			return {
				kind: "rrect",
				ltrb: [ix, iy, ix + iw, iy + ih],
				radii: typeof cr === "number" ? [cr, cr, cr, cr] : cr,
			};
		}
		case "circle": {
			const cw = Math.max(0, iw);
			const ch = Math.max(0, ih);
			const rr = Math.min(cw, ch) / 2;
			const cx = ix + cw / 2;
			const cy = iy + ch / 2;
			return {
				kind: "path",
				d: `M ${cx - rr} ${cy} A ${rr} ${rr} 0 1 0 ${cx + rr} ${cy} A ${rr} ${rr} 0 1 0 ${cx - rr} ${cy} Z`,
			};
		}
		case "ellipse": {
			const ew = Math.max(0, iw);
			const eh = Math.max(0, ih);
			const rx = ew / 2;
			const ry = eh / 2;
			const cy = iy + eh / 2;
			return {
				kind: "path",
				d: `M ${ix} ${cy} A ${rx} ${ry} 0 1 0 ${ix + ew} ${cy} A ${rx} ${ry} 0 1 0 ${ix} ${cy} Z`,
			};
		}
		case "polygon": {
			if (inset !== 0) return null;
			const cx = x + w / 2;
			const cy = y + h / 2;
			const rot = ((shape.rotation ?? 0) * Math.PI) / 180;
			let d = "";
			for (let i = 0; i < shape.sides; i++) {
				const a = -Math.PI / 2 + (i * 2 * Math.PI) / shape.sides + rot;
				d += `${i === 0 ? "M" : "L"} ${cx + (w / 2) * Math.cos(a)} ${cy + (h / 2) * Math.sin(a)} `;
			}
			return { kind: "path", d: `${d}Z` };
		}
		case "squircle": {
			const sw = Math.max(0, iw);
			const sh = Math.max(0, ih);
			if (shape.smoothing !== undefined)
				return {
					kind: "path",
					d: squircleSvg(
						ix,
						iy,
						sw,
						sh,
						Math.max(0, shape.radius - inset),
						shape.smoothing,
					),
				};
			const max = Math.min(sw, sh) / 2;
			const r = Math.min(Math.max(0, shape.radius - inset), max);
			const p = Math.min(r * 1.5, max);
			const k = p * 0.4;
			const [l, t, rt, b] = [ix, iy, ix + sw, iy + sh];
			return {
				kind: "path",
				d: `M ${l + p} ${t} L ${rt - p} ${t} C ${rt - k} ${t} ${rt} ${t + k} ${rt} ${t + p} L ${rt} ${b - p} C ${rt} ${b - k} ${rt - k} ${b} ${rt - p} ${b} L ${l + p} ${b} C ${l + k} ${b} ${l} ${b - k} ${l} ${b - p} L ${l} ${t + p} C ${l} ${t + k} ${l + k} ${t} ${l + p} ${t} Z`,
			};
		}
		default:
			return { kind: "rect", ltrb: [ix, iy, ix + iw, iy + ih] };
	}
}
