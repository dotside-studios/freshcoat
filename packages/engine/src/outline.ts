// The one geometry construction behind fills, aligned strokes, clips and
// predicted bounds, so a shape covers the same pixels whichever draws it.

import type { CanvasKit, Path } from "canvaskit-wasm";
import { insetCorner } from "./paint-helpers";
import { roundCorners } from "./round-corners";
import { squircleSvg } from "./squircle";
import type { CornerRadius, ShapeMask, Stroke, StrokeSides } from "./types";

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

// The shape a rect draws with `cornerRadius` and `cornerSmoothing`.
export function rectShape(
	cornerRadius: CornerRadius | undefined,
	cornerSmoothing: number | undefined,
): ShapeMask {
	const cr = cornerRadius ?? 0;
	if (typeof cr === "number" ? cr <= 0 : !cr.some((r) => r > 0))
		return { kind: "rect" };
	const smoothing = cornerSmoothing ?? 0;
	return smoothing > 0
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
): CornerRadius | null {
	return (shape.smoothing ?? 0) > 0 ? shape.radius : null;
}

// The outline of `shape` over the box (x, y, w, h) moved in by `inset` on
// every side (out when negative), as an inside/outside stroke follows it. Null
// when insetting the box is not an offset of the outline (a polygon, an
// outset rect); such a stroke clips a doubled stroke to the uninset outline.
// `fromTop` starts a circle or ellipse at its top, running clockwise, as a
// trimmed stroke measures it.
export function outlineGeometry(
	shape: ShapeMask,
	x: number,
	y: number,
	w: number,
	h: number,
	inset = 0,
	fromTop = false,
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
						insetCorner(smoothR, inset),
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
			if (fromTop) return { kind: "path", d: ellipseFromTop(cx, cy, rr, rr) };
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
			if (fromTop)
				return { kind: "path", d: ellipseFromTop(ix + rx, cy, rx, ry) };
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
			return {
				kind: "path",
				d: roundCorners(`${d}Z`, shape.cornerRadius ?? 0),
			};
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

export function ellipseFromTop(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
): string {
	return `M ${cx} ${cy - ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy + ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy - ry} Z`;
}

/** An ellipse filling a `width` by `height` box, as two half-ellipse arcs. */
export function ellipsePath(width: number, height: number): string {
	const rx = fmt(width / 2);
	const ry = fmt(height / 2);
	return `M0 ${ry}A${rx} ${ry} 0 1 0 ${fmt(width)} ${ry}A${rx} ${ry} 0 1 0 0 ${ry}Z`;
}

function fmt(n: number): string {
	return String(Math.round(n * 1000) / 1000);
}

const ELLIPSE =
	/^M\s*(\S+)[\s,]+(\S+)\s*A\s*(\S+)[\s,]+(\S+)[\s,]+0[\s,]+1[\s,]+0[\s,]+(\S+)[\s,]+(\S+)\s*A\s*(\S+)[\s,]+(\S+)[\s,]+0[\s,]+1[\s,]+0[\s,]+(\S+)[\s,]+(\S+)\s*Z$/i;

/** Whether `d` is the ellipse `ellipsePath` draws across a `width` by `height`
 *  box. */
export function isEllipsePath(
	d: string,
	width: number,
	height: number,
): boolean {
	const m = ELLIPSE.exec(d.trim());
	if (!m) return false;
	const n = m.slice(1).map(Number);
	const w = width;
	const h = height;
	const want = [0, h / 2, w / 2, h / 2, w, h / 2, w / 2, h / 2, 0, h / 2];
	return want.every((v, i) => Math.abs((n[i] as number) - v) < 0.01);
}

// The outline over the box (0, 0, w, h) as a path, for hit testing. The caller
// owns and deletes it.
export function outlinePath(
	ck: CanvasKit,
	shape: ShapeMask,
	w: number,
	h: number,
	inset = 0,
	fromTop = false,
): Path | null {
	const g = outlineGeometry(shape, 0, 0, w, h, inset, fromTop);
	if (!g) return null;
	if (g.kind === "path") return ck.Path.MakeFromSVGString(g.d);
	return boxPath(ck, g.ltrb, g.kind === "rrect" ? g.radii : undefined);
}

// A rect, or a rect with circular corners [topLeft, topRight, bottomRight,
// bottomLeft], as a clockwise path from the top left. The caller owns and
// deletes it.
export function boxPath(
	ck: CanvasKit,
	ltrb: readonly [number, number, number, number],
	radii?: readonly [number, number, number, number],
): Path {
	const builder = new ck.PathBuilder();
	const [l, t, r, b] = ltrb;
	if (!radii) builder.addRect(ck.LTRBRect(l, t, r, b));
	else {
		const [tl, tr, br, bl] = fitRadii(ltrb, radii);
		const w = Math.SQRT1_2;
		builder.moveTo(l + tl, t);
		builder.lineTo(r - tr, t);
		if (tr > 0) builder.conicTo(r, t, r, t + tr, w);
		builder.lineTo(r, b - br);
		if (br > 0) builder.conicTo(r, b, r - br, b, w);
		builder.lineTo(l + bl, b);
		if (bl > 0) builder.conicTo(l, b, l, b - bl, w);
		builder.lineTo(l, t + tl);
		if (tl > 0) builder.conicTo(l, t, l + tl, t, w);
		builder.close();
	}
	const path = builder.detach();
	builder.delete();
	return path;
}

// Corner radii scaled down together until neighbouring corners fit their edge.
function fitRadii(
	[l, t, r, b]: readonly [number, number, number, number],
	radii: readonly [number, number, number, number],
): [number, number, number, number] {
	const fit = Math.min(
		1,
		(r - l) / (radii[0] + radii[1]) || 1,
		(b - t) / (radii[1] + radii[2]) || 1,
		(r - l) / (radii[2] + radii[3]) || 1,
		(b - t) / (radii[3] + radii[0]) || 1,
	);
	const [tl, tr, br, bl] = radii.map((v) => Math.max(0, v) * fit);
	return [tl as number, tr as number, br as number, bl as number];
}

/** An outline as SVG path data, with `boxPath`'s corners as circular arcs. */
export function outlineSvg(g: OutlineGeometry): string {
	if (g.kind === "path") return g.d;
	const [l, t, r, b] = g.ltrb;
	if (g.kind === "rect") return `M ${l} ${t} H ${r} V ${b} H ${l} Z`;
	const [tl, tr, br, bl] = fitRadii(g.ltrb, g.radii);
	const arc = (rad: number, x: number, y: number) =>
		rad > 0 ? ` A ${rad} ${rad} 0 0 1 ${x} ${y}` : "";
	return (
		`M ${l + tl} ${t} H ${r - tr}${arc(tr, r, t + tr)}` +
		` V ${b - br}${arc(br, r - br, b)}` +
		` H ${l + bl}${arc(bl, l, b - bl)}` +
		` V ${t + tl}${arc(tl, l + tl, t)} Z`
	);
}

type Insets = [left: number, top: number, right: number, bottom: number];

/** A per-side stroke on a rect: `band` is the painted area as two contours,
 *  filled even-odd; `mid` runs down the middle of the band, where a dashed or
 *  trimmed stroke is drawn `midWidth` wide and cut to the band; `ltrb` is the
 *  band's outer edge. Null when no side has a width. */
export type SideStrokeGeometry = {
	band: string;
	mid: string;
	midWidth: number;
	ltrb: [number, number, number, number];
};

// The band between the outline moved out and the outline moved in, by each
// side's width as `align` places it (inside: all in, outside: all out, center:
// half each way). A corner's radius shrinks or grows by its two adjacent
// widths, so an unsmoothed corner is elliptical where they differ; a smoothed
// one keeps a circular radius moved by their mean. A sharp corner stays sharp.
export function sideStrokeGeometry(
	x: number,
	y: number,
	w: number,
	h: number,
	cornerRadius: CornerRadius | undefined,
	cornerSmoothing: number | undefined,
	stroke: Pick<Stroke, "align"> & { sides: StrokeSides },
): SideStrokeGeometry | null {
	const { top, right, bottom, left } = stroke.sides;
	const widths: Insets = [left, top, right, bottom].map((v) =>
		Number.isFinite(v) ? Math.max(0, v) : 0,
	) as Insets;
	const widest = Math.max(...widths);
	if (!(widest > 0) || !(w > 0) || !(h > 0)) return null;
	const k =
		stroke.align === "inside" ? 0 : stroke.align === "outside" ? 1 : 0.5;
	const outer = widths.map((v) => -v * k) as Insets;
	const inner = widths.map((v, i) => outer[i] + v) as Insets;
	const mid = widths.map((v, i) => outer[i] + v / 2) as Insets;
	const cr = cornerRadius ?? 0;
	const base = fitRadii(
		[x, y, x + w, y + h],
		typeof cr === "number" ? [cr, cr, cr, cr] : cr,
	);
	const smoothing = cornerSmoothing ?? 0;
	const contour = (d: Insets) => insetContour(x, y, w, h, base, smoothing, d);
	const outerD = contour(outer) as string;
	const innerD = contour(inner);
	return {
		band: innerD ? `${outerD} ${innerD}` : outerD,
		mid: contour(mid) ?? outerD,
		midWidth: widest * 2,
		ltrb: [x + outer[0], y + outer[1], x + w - outer[2], y + h - outer[3]],
	};
}

// The rect outline moved in by `d` per side (out where negative), or null
// when nothing is left of it.
function insetContour(
	x: number,
	y: number,
	w: number,
	h: number,
	radii: [number, number, number, number],
	smoothing: number,
	[dl, dt, dr, db]: Insets,
): string | null {
	const l = x + dl;
	const t = y + dt;
	const r = x + w - dr;
	const b = y + h - db;
	if (!(r - l > 0) || !(b - t > 0)) return null;
	const move = (base: number, by: number) =>
		base > 0 ? Math.max(0, base - by) : 0;
	const [tl, tr, br, bl] = radii;
	if (smoothing > 0)
		return squircleSvg(
			l,
			t,
			r - l,
			b - t,
			[
				move(tl, (dl + dt) / 2),
				move(tr, (dr + dt) / 2),
				move(br, (dr + db) / 2),
				move(bl, (dl + db) / 2),
			],
			smoothing,
		);
	const ellipse = (base: number, dx: number, dy: number): [number, number] =>
		base > 0 ? [Math.max(0, base - dx), Math.max(0, base - dy)] : [0, 0];
	const c = [
		ellipse(tl, dl, dt),
		ellipse(tr, dr, dt),
		ellipse(br, dr, db),
		ellipse(bl, dl, db),
	];
	const [cw, ch] = [r - l, b - t];
	const fit = Math.min(
		1,
		cw / (c[0][0] + c[1][0]) || 1,
		ch / (c[1][1] + c[2][1]) || 1,
		cw / (c[2][0] + c[3][0]) || 1,
		ch / (c[3][1] + c[0][1]) || 1,
	);
	const [[tlx, tly], [trx, try_], [brx, bry], [blx, bly]] = c.map(
		([rx, ry]) => [rx * fit, ry * fit],
	) as [number, number][];
	const arc = (rx: number, ry: number, ex: number, ey: number) =>
		rx > 0 && ry > 0
			? ` A ${rx} ${ry} 0 0 1 ${ex} ${ey}`
			: rx > 0 || ry > 0
				? ` L ${ex} ${ey}`
				: "";
	return (
		`M ${l + tlx} ${t} H ${r - trx}${arc(trx, try_, r, t + try_)}` +
		` V ${b - bry}${arc(brx, bry, r - brx, b)}` +
		` H ${l + blx}${arc(blx, bly, l, b - bly)}` +
		` V ${t + tly}${arc(tlx, tly, l + tlx, t)} Z`
	);
}
