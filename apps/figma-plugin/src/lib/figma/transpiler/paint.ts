import type { FigmaColor, FigmaPaint } from "../types";

/** The drawable a paint is being read for. Figma normalizes a gradient handle
 *  per axis (x by the width, y by the height) while coatfile carries one
 *  radius as a fraction of the LONGEST side, so converting between them needs
 *  the box. Only its aspect ratio matters, so any consistent unit works. */
export type PaintBox = { width: number; height: number };

export const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export const channel = (v: number): string =>
	Math.round(Math.max(0, Math.min(1, v)) * 255)
		.toString(16)
		.padStart(2, "0");

export function figmaColorToHex(c: FigmaColor): string {
	const base = `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
	return c.a >= 1 ? base : `${base}${channel(c.a)}`;
}

// Figma sweeps an angular gradient in its own gradient space, so on the layer
// the sweep is even only when that space maps onto the box without stretching
// or mirroring: both axes the same length and a quarter turn apart, clockwise.
// Otherwise the colours bunch up along one axis, which coatfile's even sweep
// cannot draw. Rotation is measured from the top, as coatfile measures it.
const CONFORMAL_TOLERANCE = 0.01;

export function angularPlacement(
	handles: Array<{ x: number; y: number }>,
	box: PaintBox | undefined,
): { center: [number, number]; rotation: number } | null {
	const [center, a, b] = handles;
	if (!center || !a || !b) return null;
	const w = box?.width ?? 1;
	const h = box?.height ?? 1;
	const u = { x: (a.x - center.x) * w, y: (a.y - center.y) * h };
	const v = { x: (b.x - center.x) * w, y: (b.y - center.y) * h };
	const lu = Math.hypot(u.x, u.y);
	const lv = Math.hypot(v.x, v.y);
	if (!(lu > 0) || !(lv > 0)) return null;
	const cross = (u.x * v.y - u.y * v.x) / (lu * lv);
	if (Math.abs(lu - lv) / Math.max(lu, lv) > CONFORMAL_TOLERANCE) return null;
	if (1 - cross > CONFORMAL_TOLERANCE) return null;
	const degrees = (Math.atan2(u.y, u.x) * 180) / Math.PI + 90;
	const rotation = round4(((degrees % 360) + 360) % 360);
	return {
		center: [round4(center.x), round4(center.y)],
		rotation: rotation === 360 ? 0 : rotation,
	};
}

/** Whether a paint has a coatfile fill of its own: a solid, a linear or radial
 *  gradient, or an angular one whose sweep is even on the box. */
export function isMappablePaint(paint: FigmaPaint, box?: PaintBox): boolean {
	if (paint.blendMode && paint.blendMode !== "NORMAL") return false;
	if (
		paint.type === "SOLID" ||
		paint.type === "GRADIENT_LINEAR" ||
		paint.type === "GRADIENT_RADIAL"
	)
		return true;
	if (paint.type === "GRADIENT_ANGULAR")
		return angularPlacement(paint.gradientHandlePositions, box) !== null;
	return false;
}

/** A stack of solid paints composited into the one colour it shows, or null
 *  when any paint in it is not a plain solid. No visible paint is transparent. */
export function compositeSolids(paints: FigmaPaint[]): string | null {
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	for (const p of paints) {
		if (p.visible === false) continue;
		if (p.type !== "SOLID") return null;
		if (p.blendMode && p.blendMode !== "NORMAL") return null;
		const pa = p.color.a * (p.opacity ?? 1);
		const out = pa + a * (1 - pa);
		if (out > 0) {
			r = (p.color.r * pa + r * a * (1 - pa)) / out;
			g = (p.color.g * pa + g * a * (1 - pa)) / out;
			b = (p.color.b * pa + b * a * (1 - pa)) / out;
		}
		a = out;
	}
	return figmaColorToHex({ r, g, b, a });
}
