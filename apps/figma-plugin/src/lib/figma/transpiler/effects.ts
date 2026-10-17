import type { GrainEffect } from "@freshcoat-js/coatfile";
import type { FigmaBlendMode, FigmaEffect } from "../types";
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
	| { type: "blur" | "backdropBlur"; radius: number; hidden?: true }
	| {
			type: "grain";
			amount: number;
			size: number;
			blendMode: GrainBlend;
			hidden?: true;
	  };

type GrainBlend = NonNullable<GrainEffect["blendMode"]>;

const NOISE_BLENDS: Partial<Record<FigmaBlendMode, GrainBlend>> = {
	NORMAL: "normal",
	OVERLAY: "overlay",
	SOFT_LIGHT: "soft-light",
	MULTIPLY: "multiply",
	SCREEN: "screen",
};

// Grain has no colour, so only a black, white or grey noise maps.
function isNeutral(c: { r: number; g: number; b: number }): boolean {
	const r = Math.round(c.r * 255);
	return Math.round(c.g * 255) === r && Math.round(c.b * 255) === r;
}

/** Whether a visible Figma noise can be drawn as grain: monotone, neutral,
 *  square cells and a blend mode grain has. */
export function isMappableNoise(e: FigmaEffect): boolean {
	if (e.type !== "NOISE" || e.noiseType !== "MONOTONE") return false;
	if (!NOISE_BLENDS[e.blendMode ?? "NORMAL"]) return false;
	if (!(e.noiseSize !== undefined && e.noiseSize > 0)) return false;
	const v = e.noiseSizeVector;
	if (v && v.x !== v.y) return false;
	return e.color === undefined || isNeutral(e.color);
}

// Figma paints a fraction `density` of cells in the noise colour at its alpha
// and leaves the rest alone; grain moves every cell toward a random grey. The
// amount is matched on the RMS change each makes to the layer, averaged over
// base tones 0.1 to 0.9: Figma's is alpha · |blend(c, colour) − c| · √density,
// grain's amount · √E[(blend(c, g) − c)²] for g uniform on [0, 1]. A noise that
// leaves every tone alone (white multiplied, grey overlaid) maps to 0.
const BASES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

const BLEND: Record<GrainBlend, (c: number, g: number) => number> = {
	normal: (_c, g) => g,
	overlay: (c, g) => (c < 0.5 ? 2 * c * g : 1 - 2 * (1 - c) * (1 - g)),
	"soft-light": (c, g) => (1 - 2 * g) * c * c + 2 * g * c,
	multiply: (c, g) => c * g,
	screen: (c, g) => 1 - (1 - c) * (1 - g),
};

// E[(blend(c, g) − c)²] for g uniform on [0, 1].
const GRAIN_VARIANCE: Record<GrainBlend, (c: number) => number> = {
	normal: (c) => 1 / 3 - c + c * c,
	overlay: (c) => (c < 0.5 ? c * c : (1 - c) ** 2) / 3,
	"soft-light": (c) => (c * (1 - c)) ** 2 / 3,
	multiply: (c) => (c * c) / 3,
	screen: (c) => (1 - c) ** 2 / 3,
};

export function noiseAmount(
	tone: number,
	alpha: number,
	density: number,
	blend: GrainBlend,
): number {
	let figma = 0;
	let grain = 0;
	for (const c of BASES) {
		figma += (BLEND[blend](c, tone) - c) ** 2;
		grain += GRAIN_VARIANCE[blend](c);
	}
	const d = Math.min(1, Math.max(0, density));
	const a = Math.min(1, Math.max(0, alpha));
	return Math.min(1, a * Math.sqrt(d) * Math.sqrt(figma / grain));
}

function noiseGrain(e: FigmaEffect, scale: number): ExtractedEffect {
	const blendMode = NOISE_BLENDS[e.blendMode ?? "NORMAL"] ?? "normal";
	const color = e.color ?? { r: 0, g: 0, b: 0, a: 1 };
	return {
		type: "grain",
		amount: round3(noiseAmount(color.r, color.a, e.density ?? 0, blendMode)),
		size: round3((e.noiseSize ?? 1) * scale),
		blendMode,
	};
}

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
// blur radius maps like its layer blur radius. A visible noise classify let
// through becomes grain.
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
	let grainSeen = false;
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
		if (
			e.type === "NOISE" &&
			e.visible !== false &&
			!grainSeen &&
			isMappableNoise(e)
		) {
			grainSeen = true;
			out.push(noiseGrain(e, scale));
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
