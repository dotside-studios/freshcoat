import type {
	CornerRadius,
	FontFeatures,
	FontVariations,
	Stroke,
} from "./types";

// The variation axes a text style instantiates its face at. The weight goes
// first as `wght`: `fontStyle.weight` only PICKS among registered faces, and a
// variable font registers as its default instance, so without the axis a 700
// span would get that instance under synthetic bold. A static face has no axes
// and ignores all of them. Shared by the Paragraph engine and the painter, which
// must shape identically.
export function fontVariationList(
	weight: number | undefined,
	variations: FontVariations | undefined,
): { axis: string; value: number }[] {
	const axes: Record<string, number> = { wght: weight || 400, ...variations };
	return Object.entries(axes).map(([axis, value]) => ({ axis, value }));
}

export function fontFeatureList(
	features: FontFeatures | undefined,
): { name: string; value: number }[] {
	return Object.entries(features ?? {}).map(([name, value]) => ({
		name,
		value,
	}));
}

// Source/dest rects for object-fit.
export function fitRect(
	iw: number,
	ih: number,
	dx: number,
	dy: number,
	dw: number,
	dh: number,
	fit: "cover" | "contain" | "fill",
): {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
	dx: number;
	dy: number;
	dw: number;
	dh: number;
} {
	if (fit === "fill") return { sx: 0, sy: 0, sw: iw, sh: ih, dx, dy, dw, dh };
	const ir = iw / ih;
	const dr = dw / dh;
	if (fit === "cover") {
		if (ir > dr) {
			const sw = ih * dr;
			return { sx: (iw - sw) / 2, sy: 0, sw, sh: ih, dx, dy, dw, dh };
		}
		const sh = iw / dr;
		return { sx: 0, sy: (ih - sh) / 2, sw: iw, sh, dx, dy, dw, dh };
	}
	// contain
	if (ir > dr) {
		const h = dw / ir;
		return {
			sx: 0,
			sy: 0,
			sw: iw,
			sh: ih,
			dx,
			dy: dy + (dh - h) / 2,
			dw,
			dh: h,
		};
	}
	const w = dh * ir;
	return { sx: 0, sy: 0, sw: iw, sh: ih, dx: dx + (dw - w) / 2, dy, dw: w, dh };
}

// Stroke-edge offset for alignment: +w/2 pulls it inside, -w/2 outside, 0 center.
export function strokeInset(stroke: Stroke): number {
	if (stroke.align === "inside") return stroke.width / 2;
	if (stroke.align === "outside") return -stroke.width / 2;
	return 0;
}

// Shrink (or grow) corner radii to match an inset/outset stroke rect.
export function insetCorner(
	cr: CornerRadius | undefined,
	inset: number,
): CornerRadius {
	if (cr === undefined) return 0;
	if (typeof cr === "number") return Math.max(0, cr - inset);
	return [
		Math.max(0, cr[0] - inset),
		Math.max(0, cr[1] - inset),
		Math.max(0, cr[2] - inset),
		Math.max(0, cr[3] - inset),
	];
}

// Underline/strike geometry from the alphabetic baseline + font size. Kept in
// lockstep between both painters so they draw the same line.
export function decorationLine(
	size: number,
	decoration: string,
	baseline: number,
): { top: number; thickness: number } {
	const thickness = Math.max(1, size * 0.06);
	const center =
		decoration === "line-through"
			? baseline - size * 0.28
			: baseline + size * 0.1;
	return { top: center - thickness / 2, thickness };
}
