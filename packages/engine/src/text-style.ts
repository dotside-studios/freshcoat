// CanvasKit styling shared by the Paragraph engine, the painter and editors
// that shape text outside a render, so all of them shape identically.

import type {
	CanvasKit,
	Color,
	FontWeight,
	FontWeightEnumValues,
	TextStyle,
} from "canvaskit-wasm";
import { parseColor } from "./color";
import { fontFeatureList, fontVariationList } from "./paint-helpers";
import type { SpanFont } from "./text-engine";

export type FontWeightName = Exclude<keyof FontWeightEnumValues, "values">;

const WEIGHTS: Record<number, FontWeightName> = {
	100: "Thin",
	200: "ExtraLight",
	300: "Light",
	400: "Normal",
	500: "Medium",
	600: "SemiBold",
	700: "Bold",
	800: "ExtraBold",
	900: "Black",
};

// The CanvasKit weight name nearest a CSS weight. Unset is 400.
export function fontWeightName(weight: number | undefined): FontWeightName {
	return WEIGHTS[Math.round((weight || 400) / 100) * 100] ?? "Normal";
}

export function fontWeight(
	ck: CanvasKit,
	weight: number | undefined,
): FontWeight {
	return ck.FontWeight[fontWeightName(weight)];
}

// A CSS color as a CanvasKit color; black when it does not parse.
export function toColor(ck: CanvasKit, input: string): Color {
	const c = parseColor(input);
	return c && c !== "none" ? ck.Color(c[0], c[1], c[2], c[3]) : ck.BLACK;
}

// The CanvasKit TextStyle for a span, without its color. CanvasKit adds
// letterSpacing after each glyph, so measuring/breaking with it matches the
// render exactly. CanvasKit only falls back to families it sees in
// `fontFamilies`, so every other registered family follows the span's own.
export function spanTextStyle(
	ck: CanvasKit,
	font: SpanFont,
	fallbackFamilies: readonly string[] = [],
): TextStyle {
	return {
		fontFamilies: [
			font.family,
			...fallbackFamilies.filter((f) => f !== font.family),
		],
		fontSize: font.size,
		fontStyle: {
			weight: fontWeight(ck, font.weight),
			slant:
				font.style === "italic" ? ck.FontSlant.Italic : ck.FontSlant.Upright,
		},
		// The same weight again as a variation axis, plus any other axes the
		// span sets. A family delivered as one variable file (what Google Fonts
		// serves a browser, one woff2 per subset reused across every weight row)
		// would otherwise shape a 700 span as the 400 instance under synthetic
		// bold: lighter strokes and 400's advances, so thin and mis-wrapped.
		fontVariations: fontVariationList(font.weight, font.variations),
		...(font.features ? { fontFeatures: fontFeatureList(font.features) } : {}),
		...(font.letterSpacing ? { letterSpacing: font.letterSpacing } : {}),
	};
}
