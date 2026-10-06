import { applyTransform } from "~/lib/figma/transpiler/transform";
import type {
	FigmaBlendMode,
	FigmaColor,
	FigmaImageFilters,
	FigmaPaint,
	FigmaTransform,
} from "~/lib/figma/types";

function rgbaFrom(color: {
	r: number;
	g: number;
	b: number;
	a?: number;
}): FigmaColor {
	return { r: color.r, g: color.g, b: color.b, a: color.a ?? 1 };
}

/** Invert a 2x3 affine matrix; returns identity if singular. */
function invert(t: FigmaTransform): FigmaTransform {
	const [[a, b, c], [d, e, f]] = t;
	const det = a * e - b * d;
	if (det === 0)
		return [
			[1, 0, 0],
			[0, 1, 0],
		];
	const id = 1 / det;
	return [
		[e * id, -b * id, (b * f - e * c) * id],
		[-d * id, a * id, (d * c - a * f) * id],
	];
}

/**
 * Plugin gradients carry a `gradientTransform` (gradient-space ← object-space).
 * The REST `gradientHandlePositions` live in object space, so they're the
 * inverse transform applied to the gradient's canonical handle points.
 *
 * WHICH points those are depends on the kind, because the two gradients sit
 * differently inside Figma's unit-square gradient space. A linear gradient runs
 * along the square's horizontal midline, so REST reports its start (0, 0.5), its
 * end (1, 0.5), and (0, 1), whose offset from the start sets the width. Those
 * are the handles Figma draws on the layer, which is what coatfile's `from` and
 * `to` place. A radial one is the circle centered at (0.5, 0.5) with radius 0.5, so
 * REST reports that center and its two axis ENDS — (1, 0.5) and (0.5, 1).
 * Sampling a radial gradient at the linear points hands the consumer a corner of
 * the shape as the center of a glow that belongs in its middle.
 */
export function gradientHandlesFromTransform(
	t: FigmaTransform,
	kind: "linear" | "radial",
): Array<{ x: number; y: number }> {
	const inv = invert(t);
	if (kind === "radial") {
		return [
			applyTransform(inv, 0.5, 0.5),
			applyTransform(inv, 1, 0.5),
			applyTransform(inv, 0.5, 1),
		];
	}
	return [
		applyTransform(inv, 0, 0.5),
		applyTransform(inv, 1, 0.5),
		applyTransform(inv, 0, 1),
	];
}

/** A minimal structural shape of a Plugin-API Paint (what we read off it). */
export type AnyPaint = {
	type: string;
	visible?: boolean;
	opacity?: number;
	blendMode?: string;
	color?: { r: number; g: number; b: number };
	gradientTransform?: FigmaTransform;
	gradientStops?: Array<{
		position: number;
		color: { r: number; g: number; b: number; a: number };
	}>;
	scaleMode?: string;
	imageHash?: string | null;
	imageTransform?: FigmaTransform;
	filters?: FigmaImageFilters;
};

function paintBlend(paint: AnyPaint): { blendMode?: FigmaBlendMode } {
	return paint.blendMode && paint.blendMode !== "NORMAL"
		? { blendMode: paint.blendMode as FigmaBlendMode }
		: {};
}

export function readPaint(paint: AnyPaint): FigmaPaint {
	if (paint.type === "SOLID") {
		return {
			type: "SOLID",
			visible: paint.visible,
			opacity: paint.opacity,
			...paintBlend(paint),
			color: rgbaFrom({ ...(paint.color ?? { r: 0, g: 0, b: 0 }), a: 1 }),
		};
	}
	if (paint.type === "IMAGE") {
		const mode =
			paint.scaleMode === "CROP" ? "STRETCH" : (paint.scaleMode ?? "FILL");
		return {
			type: "IMAGE",
			visible: paint.visible,
			opacity: paint.opacity,
			...paintBlend(paint),
			scaleMode: mode as "FILL" | "FIT" | "TILE" | "STRETCH",
			imageRef: paint.imageHash ?? "",
			...(paint.scaleMode === "CROP" && paint.imageTransform
				? { imageTransform: paint.imageTransform }
				: {}),
			...(paint.filters && Object.values(paint.filters).some((v) => v)
				? { filters: { ...paint.filters } }
				: {}),
		};
	}
	// Gradient (linear/radial/angular/diamond): emit REST-shaped gradient paint.
	// RADIAL, ANGULAR and DIAMOND all radiate from the gradient square's center,
	// so they share the radial sampling; only LINEAR runs along an axis.
	return {
		type: paint.type as "GRADIENT_LINEAR" | "GRADIENT_RADIAL",
		visible: paint.visible,
		opacity: paint.opacity,
		...paintBlend(paint),
		...(paint.gradientTransform
			? { gradientTransform: paint.gradientTransform }
			: {}),
		gradientHandlePositions: gradientHandlesFromTransform(
			paint.gradientTransform ?? [
				[1, 0, 0],
				[0, 1, 0],
			],
			paint.type === "GRADIENT_LINEAR" ? "linear" : "radial",
		),
		gradientStops: (paint.gradientStops ?? []).map((s) => ({
			position: s.position,
			color: rgbaFrom(s.color),
		})),
	};
}

export function readPaints(
	paints: readonly AnyPaint[] | typeof figma.mixed | undefined,
): FigmaPaint[] {
	if (!Array.isArray(paints)) return [];
	return paints.map(readPaint);
}
