import type {
	CornerRadius,
	FontFeatures,
	FontVariations,
	ImageCrop,
	Stroke,
	Vec2,
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

export type FitOptions = { focus?: Vec2; crop?: ImageCrop };

// Source/dest rects for object-fit. `crop` narrows the source first (fractions
// of it, clamped to it); `focus` then picks which part of that region `cover`
// keeps.
export function fitRect(
	iw: number,
	ih: number,
	dx: number,
	dy: number,
	dw: number,
	dh: number,
	fit: "cover" | "contain" | "fill",
	opts?: FitOptions,
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
	const { ox, oy, cw, ch } = cropRegion(iw, ih, opts?.crop);
	if (fit === "fill")
		return { sx: ox, sy: oy, sw: cw, sh: ch, dx, dy, dw, dh };
	const ir = cw / ch;
	const dr = dw / dh;
	if (fit === "cover") {
		const focus = opts?.focus;
		if (ir > dr) {
			const sw = ch * dr;
			const sx = ox + focusOffset(cw, sw, focus?.x);
			return { sx, sy: oy, sw, sh: ch, dx, dy, dw, dh };
		}
		const sh = cw / dr;
		const sy = oy + focusOffset(ch, sh, focus?.y);
		return { sx: ox, sy, sw: cw, sh, dx, dy, dw, dh };
	}
	// contain
	if (ir > dr) {
		const h = dw / ir;
		return {
			sx: ox,
			sy: oy,
			sw: cw,
			sh: ch,
			dx,
			dy: dy + (dh - h) / 2,
			dw,
			dh: h,
		};
	}
	const w = dh * ir;
	return {
		sx: ox,
		sy: oy,
		sw: cw,
		sh: ch,
		dx: dx + (dw - w) / 2,
		dy,
		dw: w,
		dh,
	};
}

function cropRegion(
	iw: number,
	ih: number,
	crop: ImageCrop | undefined,
): { ox: number; oy: number; cw: number; ch: number } {
	if (!crop) return { ox: 0, oy: 0, cw: iw, ch: ih };
	const x = clamp01(crop.x);
	const y = clamp01(crop.y);
	const w = Math.min(clamp01(crop.width), 1 - x);
	const h = Math.min(clamp01(crop.height), 1 - y);
	if (!(w > 0 && h > 0)) return { ox: 0, oy: 0, cw: iw, ch: ih };
	return { ox: x * iw, oy: y * ih, cw: w * iw, ch: h * ih };
}

// Where a window of `part` starts within `total` so the focal fraction sits at
// its middle, held inside the source.
function focusOffset(total: number, part: number, focus?: number): number {
	if (focus === undefined || !Number.isFinite(focus)) return (total - part) / 2;
	return Math.min(Math.max(focus * total - part / 2, 0), total - part);
}

function clamp01(v: number): number {
	return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0;
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
