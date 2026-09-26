// Figma corner smoothing ("squircle") — an SVG path for a rounded rect whose
// corners blend from a plain circular arc (smoothing 0) to a
// continuous-curvature superellipse (smoothing → 1), matching Figma's
// corner-smoothing control. Ported from figma-squircle (tienphaw/figma-squircle,
// MIT), specialized to a uniform radius + smoothing.

function toRadians(deg: number): number {
	return (deg * Math.PI) / 180;
}

function n(v: number): string {
	return v.toFixed(4);
}

type CornerParams = {
	a: number;
	b: number;
	c: number;
	d: number;
	p: number;
	cornerRadius: number;
	arcSectionLength: number;
};

function getPathParamsForCorner(
	cornerRadius: number,
	cornerSmoothing: number,
	budget: number,
): CornerParams {
	let p = (1 + cornerSmoothing) * cornerRadius;
	const maxCornerSmoothing = budget / cornerRadius - 1;
	const smoothing = Math.min(cornerSmoothing, maxCornerSmoothing);
	p = Math.min(p, budget);

	const arcMeasure = 90 * (1 - smoothing);
	const arcSectionLength =
		Math.sin(toRadians(arcMeasure / 2)) * cornerRadius * Math.SQRT2;
	const angleAlpha = (90 - arcMeasure) / 2;
	const p3ToP4Distance = cornerRadius * Math.tan(toRadians(angleAlpha / 2));
	const angleBeta = 45 * smoothing;
	const c = p3ToP4Distance * Math.cos(toRadians(angleBeta));
	const d = c * Math.tan(toRadians(angleBeta));
	const b = (p - arcSectionLength - c - d) / 3;
	const a = 2 * b;
	return { a, b, c, d, p, arcSectionLength, cornerRadius };
}

function topRight({
	cornerRadius: r,
	a,
	b,
	c,
	d,
	arcSectionLength: arc,
}: CornerParams) {
	return `c ${n(a)} 0 ${n(a + b)} 0 ${n(a + b + c)} ${n(d)} a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(arc)} c ${n(d)} ${n(c)} ${n(d)} ${n(b + c)} ${n(d)} ${n(a + b + c)}`;
}
function bottomRight({
	cornerRadius: r,
	a,
	b,
	c,
	d,
	arcSectionLength: arc,
}: CornerParams) {
	return `c 0 ${n(a)} 0 ${n(a + b)} ${n(-d)} ${n(a + b + c)} a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(arc)} c ${n(-c)} ${n(d)} ${n(-(b + c))} ${n(d)} ${n(-(a + b + c))} ${n(d)}`;
}
function bottomLeft({
	cornerRadius: r,
	a,
	b,
	c,
	d,
	arcSectionLength: arc,
}: CornerParams) {
	return `c ${n(-a)} 0 ${n(-(a + b))} 0 ${n(-(a + b + c))} ${n(-d)} a ${n(r)} ${n(r)} 0 0 1 ${n(-arc)} ${n(-arc)} c ${n(-d)} ${n(-c)} ${n(-d)} ${n(-(b + c))} ${n(-d)} ${n(-(a + b + c))}`;
}
function topLeft({
	cornerRadius: r,
	a,
	b,
	c,
	d,
	arcSectionLength: arc,
}: CornerParams) {
	return `c 0 ${n(-a)} 0 ${n(-(a + b))} ${n(d)} ${n(-(a + b + c))} a ${n(r)} ${n(r)} 0 0 1 ${n(arc)} ${n(-arc)} c ${n(c)} ${n(-d)} ${n(b + c)} ${n(-d)} ${n(a + b + c)} ${n(-d)}`;
}

// SVG path for a smoothed rounded rect at (x, y) sized w×h with a uniform radius
// and smoothing in [0, 1]. Corners are identical, so one param set drives all four.
export function squircleSvg(
	x: number,
	y: number,
	w: number,
	h: number,
	radius: number,
	smoothing: number,
): string {
	const budget = Math.min(w, h) / 2;
	const r = Math.min(radius, budget);
	if (r <= 0)
		return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x)} Z`;
	const cp = getPathParamsForCorner(r, smoothing, budget);
	const p = cp.p;
	return [
		`M ${n(x + w - p)} ${n(y)}`,
		topRight(cp),
		`L ${n(x + w)} ${n(y + h - p)}`,
		bottomRight(cp),
		`L ${n(x + p)} ${n(y + h)}`,
		bottomLeft(cp),
		`L ${n(x)} ${n(y + p)}`,
		topLeft(cp),
		"Z",
	].join(" ");
}
