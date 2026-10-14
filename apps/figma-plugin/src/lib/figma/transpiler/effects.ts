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

export type ExtractedEffect =
	| {
			type: "shadow";
			color: string;
			dx: number;
			dy: number;
			blur: number;
			spread?: number;
			inset?: boolean;
			hidden?: true;
	  }
	| { type: "blur" | "backdropBlur"; radius: number; hidden?: true };

export type ExtractedEffects = {
	/** The node's effects in Figma's order; absent when it has none. */
	effects?: ExtractedEffect[];
};

/** Whether any of the effects is drawn. */
export function hasVisibleEffect(fx: ExtractedEffects): boolean {
	return fx.effects?.some((e) => !e.hidden) ?? false;
}

// Extract DROP_SHADOW / INNER_SHADOW / LAYER_BLUR / BACKGROUND_BLUR effects from
// a Figma node into coatfile's element-shell `effects` list. Figma's background
// blur radius maps like its layer blur radius.
//
// Figma stacks effects the way it stacks fills, first entry bottom-most, and
// coatfile's shadows paint in that same order, so the list is carried across in
// Figma's order. An effect Figma has switched off stays in the list as
// `hidden`, so the designer can turn it back on. Only the first layer blur and
// the first background blur are kept, since an element takes one of each.
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
	const out: ExtractedEffect[] = [];
	let blurSeen = false;
	let backdropSeen = false;
	for (const e of effects) {
		const hidden = e.visible === false ? { hidden: true as const } : {};
		if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
			const dx = (e.offset?.x ?? 0) * scale;
			const dy = (e.offset?.y ?? 0) * scale;
			const spread = (e.spread ?? 0) * scale;
			out.push({
				type: "shadow",
				color: e.color ? shadowColor(e.color) : "#000000",
				dx: round3(dx * cos + dy * sin),
				dy: round3(-dx * sin + dy * cos),
				blur: (e.radius ?? 0) * scale,
				...(spread !== 0 ? { spread: round3(spread) } : {}),
				...(e.type === "INNER_SHADOW" ? { inset: true } : {}),
				...hidden,
			});
		}
		if (e.type === "LAYER_BLUR" && !blurSeen) {
			blurSeen = true;
			out.push({ type: "blur", radius: (e.radius ?? 0) * scale, ...hidden });
		}
		if (e.type === "BACKGROUND_BLUR" && !backdropSeen) {
			backdropSeen = true;
			out.push({
				type: "backdropBlur",
				radius: (e.radius ?? 0) * scale,
				...hidden,
			});
		}
	}
	return out.length > 0 ? { effects: out } : {};
}

// Un-rotating an offset by a right angle leaves floating-point dust
// (4 → 4.000000000000001); three decimals is well under a printed pixel.
function round3(n: number): number {
	const r = Math.round(n * 1000) / 1000;
	return r === 0 ? 0 : r;
}
