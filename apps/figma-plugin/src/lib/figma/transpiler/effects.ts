import type { FigmaEffect } from "../types";
import { figmaColorToHex } from "./colors";

function shadowColor(c: {
	r: number;
	g: number;
	b: number;
	a: number;
}): string {
	if (c.a >= 1) return figmaColorToHex(c);
	const r = Math.round(c.r * 255);
	const g = Math.round(c.g * 255);
	const b = Math.round(c.b * 255);
	return `rgba(${r}, ${g}, ${b}, ${c.a})`;
}

export type ExtractedShadow = {
	color: string;
	dx: number;
	dy: number;
	blur: number;
	spread?: number;
	inset?: boolean;
};

export type ExtractedEffects = {
	/** One shadow, or the whole stack in paint order. */
	shadow?: ExtractedShadow | ExtractedShadow[];
	blur?: number;
};

// Extract DROP_SHADOW / INNER_SHADOW / LAYER_BLUR effects from a Figma node into
// coatfile's element-shell shadow + blur fields. BACKGROUND_BLUR is ignored
// (classify already flattens nodes carrying one, so this is just defensive —
// anything reaching here has passed the classify gate).
//
// Figma stacks effects the way it stacks fills, first entry bottom-most, and
// coatfile's shadow array paints in that same order, so the list is carried
// across as-is. A single shadow is emitted as an object rather than a one-entry
// array, which keeps the common case's output identical to what it always was.
//
// `worldRotation` is the element's total rotation in degrees once every frame
// above it has been composed. Figma measures a shadow's offset on the CANVAS —
// rotating a layer does not swing its shadow — but the painter applies the
// shadow INSIDE the rotation it wraps the element in, so the offset has to be
// expressed in the element's own frame to come out pointing the way the design
// does. On a card whose whole design sits under a 90° turn, that is the
// difference between light from above and light from the side.
export function extractEffects(
	effects: FigmaEffect[] | undefined,
	scale: number,
	worldRotation = 0,
): ExtractedEffects {
	if (!Array.isArray(effects)) return {};
	const rad = (worldRotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const out: ExtractedEffects = {};
	const shadows: ExtractedShadow[] = [];
	for (const e of effects) {
		if (e.visible === false) continue;
		if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
			const dx = (e.offset?.x ?? 0) * scale;
			const dy = (e.offset?.y ?? 0) * scale;
			const spread = (e.spread ?? 0) * scale;
			shadows.push({
				color: e.color ? shadowColor(e.color) : "#000000",
				dx: round3(dx * cos + dy * sin),
				dy: round3(-dx * sin + dy * cos),
				blur: (e.radius ?? 0) * scale,
				...(spread !== 0 ? { spread: round3(spread) } : {}),
				...(e.type === "INNER_SHADOW" ? { inset: true } : {}),
			});
		}
		if (e.type === "LAYER_BLUR" && out.blur === undefined) {
			out.blur = (e.radius ?? 0) * scale;
		}
	}
	if (shadows.length === 1) out.shadow = shadows[0];
	else if (shadows.length > 1) out.shadow = shadows;
	return out;
}

// Un-rotating an offset by a right angle leaves floating-point dust
// (4 → 4.000000000000001); three decimals is well under a printed pixel.
function round3(n: number): number {
	const r = Math.round(n * 1000) / 1000;
	return r === 0 ? 0 : r;
}
