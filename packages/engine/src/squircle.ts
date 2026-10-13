// Figma corner smoothing ("squircle") — an SVG path for a rounded rect whose
// corners blend from a plain circular arc (smoothing 0) to a
// continuous-curvature superellipse (smoothing → 1), matching Figma's
// corner-smoothing control. Ported from figma-squircle (tienphaw/figma-squircle,
// MIT). Each corner takes its own radius and the shared smoothing.

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

const NONE: CornerParams = {
	a: 0,
	b: 0,
	c: 0,
	d: 0,
	p: 0,
	cornerRadius: 0,
	arcSectionLength: 0,
};

type Corner = "tl" | "tr" | "br" | "bl";

const ADJACENT: Record<Corner, [Corner, "h" | "v"][]> = {
	tl: [
		["tr", "h"],
		["bl", "v"],
	],
	tr: [
		["tl", "h"],
		["br", "v"],
	],
	br: [
		["bl", "h"],
		["tr", "v"],
	],
	bl: [
		["br", "h"],
		["tl", "v"],
	],
};

// Splits each edge between the corners on it, largest radius first: a corner
// takes its share of an edge by radius, or what a corner already placed on
// that edge left over. Its radius is clamped to that budget.
function distribute(
	radii: Record<Corner, number>,
	w: number,
	h: number,
): Record<Corner, { radius: number; budget: number }> {
	const radius = { ...radii };
	const budget: Record<Corner, number> = { tl: -1, tr: -1, br: -1, bl: -1 };
	const order = (Object.keys(radius) as Corner[]).sort(
		(x, y) => radius[y] - radius[x],
	);
	for (const corner of order) {
		const r = radius[corner];
		budget[corner] = Math.min(
			...ADJACENT[corner].map(([other, axis]) => {
				const side = axis === "h" ? w : h;
				if (budget[other] >= 0) return side - budget[other];
				const sum = r + radius[other];
				return sum > 0 ? (r / sum) * side : 0;
			}),
		);
		radius[corner] = Math.min(r, budget[corner]);
	}
	return {
		tl: { radius: radius.tl, budget: budget.tl },
		tr: { radius: radius.tr, budget: budget.tr },
		br: { radius: radius.br, budget: budget.br },
		bl: { radius: radius.bl, budget: budget.bl },
	};
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

// SVG path for a smoothed rounded rect at (x, y) sized w×h with smoothing in
// [0, 1], and a uniform radius or radii [topLeft, topRight, bottomRight,
// bottomLeft].
export function squircleSvg(
	x: number,
	y: number,
	w: number,
	h: number,
	radius: number | readonly [number, number, number, number],
	smoothing: number,
): string {
	const [tl, tr, br, bl] = (
		typeof radius === "number" ? [radius, radius, radius, radius] : radius
	).map((r) => Math.max(0, r));
	if (!(tl > 0 || tr > 0 || br > 0 || bl > 0) || w <= 0 || h <= 0)
		return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x)} Z`;
	const fit = distribute({ tl, tr, br, bl }, w, h);
	const params = (c: Corner) =>
		fit[c].radius > 0
			? getPathParamsForCorner(fit[c].radius, smoothing, fit[c].budget)
			: NONE;
	const ptl = params("tl");
	const ptr = params("tr");
	const pbr = params("br");
	const pbl = params("bl");
	return [
		`M ${n(x + w - ptr.p)} ${n(y)}`,
		ptr.p > 0 ? topRight(ptr) : "",
		`L ${n(x + w)} ${n(y + h - pbr.p)}`,
		pbr.p > 0 ? bottomRight(pbr) : "",
		`L ${n(x + pbl.p)} ${n(y + h)}`,
		pbl.p > 0 ? bottomLeft(pbl) : "",
		`L ${n(x)} ${n(y + ptl.p)}`,
		ptl.p > 0 ? topLeft(ptl) : "",
		"Z",
	]
		.filter(Boolean)
		.join(" ");
}
