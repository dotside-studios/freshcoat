import type {
	FigmaBoundingBox,
	FigmaSolidPaint,
	FigmaTextNode,
} from "../types";
import { figmaColorToHex } from "./colors";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";
import { isWholeMustacheToken } from "./fields";

export function textLayoutSizing(
	mode: FigmaTextNode["style"]["textAutoResize"] | undefined,
): { width: "fixed" | "hug"; height: "fixed" | "hug" } {
	if (mode === "WIDTH_AND_HEIGHT") return { width: "hug", height: "hug" };
	if (mode === "HEIGHT") return { width: "fixed", height: "hug" };
	return { width: "fixed", height: "fixed" };
}

export type TranspileTextContext = {
	frame: FigmaBoundingBox;
	scale: number;
	worldAnchor?: { x: number; y: number };
};

const ALIGN: Record<string, "left" | "center" | "right" | "justify"> = {
	LEFT: "left",
	CENTER: "center",
	RIGHT: "right",
	JUSTIFIED: "justify",
};
const VALIGN: Record<string, "top" | "middle" | "bottom"> = {
	TOP: "top",
	CENTER: "middle",
	BOTTOM: "bottom",
};

/** Two decimals: enough for a font size or a line-height multiplier. */
function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

function snapWeight(w: number): FontWeight {
	return Math.min(900, Math.max(100, Math.round(w / 100) * 100)) as FontWeight;
}

/** The font fields a Figma weight becomes: the nearest step, and when the
 *  weight falls between steps (a variable font at 350) the exact value as a
 *  `wght` axis, which a variable face renders and a static one ignores. */
function weightFields(w: number): {
	weight: FontWeight;
	variations?: { wght: number };
} {
	const weight = snapWeight(w);
	return weight === w || w < 100 || w > 900
		? { weight }
		: { weight, variations: { wght: w } };
}

export function transpileText(
	node: FigmaTextNode,
	ctx: TranspileTextContext,
	// The resolved text binding's value template, e.g. "{{name}}". Names the
	// element after the FIELD it renders, the way transpileImage already does.
	textTemplate?: string,
) {
	// A rotated text node's axis-aligned bounding box is tall & narrow for
	// vertical text, so laying text out in it would wrap per character.
	// placeLocal decomposes the parent-relative transform: it uses the
	// unrotated width/height re-centered on the box and carries the rotation
	// through (coatfile rotates around the center).
	const placed = ctx.worldAnchor
		? placeWorld(node, ctx.worldAnchor, ctx.scale)
		: placeLocal(node, ctx.scale);
	if ("fallback" in placed) {
		throw new FlattenFallbackError(node.id);
	}
	const { pos, size, rotation } = placed;
	const fill = node.fills[0] as FigmaSolidPaint;

	// Fields are registered centrally from the node binding (see index.ts
	// overlay); here we only derive the element id.
	//
	// The BINDING names the element, ahead of the layer. Figma auto-names a text
	// layer after its own content until someone renames it, so a layer bound to
	// {{name}} but showing a filled-in preview arrives called "Jeanie Mosciski"
	// — and the same field then has a different element id on each side of the
	// card. Worse, a colorway instance previewing different text renames its
	// layer too, so the base and the variant stop lining up by id and the
	// override is dropped as a structure mismatch. A binding that is one whole
	// token is the field, so it is the id.
	const boundTokenMatch = isWholeMustacheToken(textTemplate ?? "");
	const nameTokenMatch = isWholeMustacheToken(node.name);

	// Figma reports neither field when the layer's line height is AUTO, and AUTO
	// is the FONT's own line box — 1.48 for Vend Sans, something else for the next
	// font — not a constant. Emitting a guess (this used to write 1.2) makes every
	// auto-height block shorter than the layer it came from and tightens its
	// leading; "auto" hands the resolution to the renderer, which has the metrics.
	const lineHeight =
		node.style.lineHeightPercentFontSize !== undefined
			? round2(node.style.lineHeightPercentFontSize / 100)
			: node.style.lineHeightPx !== undefined
				? round2(node.style.lineHeightPx / node.style.fontSize)
				: ("auto" as const);

	// Match Figma's overflow behavior. A plain text layer — fixed size,
	// auto-height, or auto-width — does NOT clip its own overflow in Figma; the
	// text simply spills past the box (only a FRAME with "clip content" clips,
	// which the transpiler handles separately). Figma clips text at the layer
	// level ONLY when "Truncate text" is on (textAutoResize "TRUNCATE").
	// Emitting `fit: "clip"` unconditionally cut off overflowing fixed-size
	// paragraphs (e.g. the back-of-card legal block), so we clip only for the
	// truncate case and otherwise let the overflow render. `shrink` (font
	// binary-searched down) is never what Figma does, so we don't emit it.
	const fitMode: "clip" | undefined =
		node.style.textAutoResize === "TRUNCATE" ? "clip" : undefined;

	const baseFont = {
		family: node.style.fontFamily,
		// Two decimals, not whole pixels: Figma sizes are routinely fractional
		// (14.11 in a scaled component), and rounding one to 14 shortens its line
		// box enough to drop a pixel per line — a three-line block lands 3px above
		// where the layer put it.
		size: round2(node.style.fontSize * ctx.scale),
		...weightFields(node.style.fontWeight),
		...(node.style.italic ? { style: "italic" as const } : {}),
		...(node.style.letterSpacing !== undefined && node.style.letterSpacing !== 0
			? { letterSpacing: node.style.letterSpacing * ctx.scale }
			: {}),
		lineHeight,
		...fontFeatures(node.style.openTypeFeatures),
	};

	const spans = buildSpans(node, ctx.scale);

	// Figma "Case" → coatfile applies it to the RESOLVED text (so dynamic
	// {{values}} are cased). SMALL_CAPS isn't a plain string transform, so it
	// (and ORIGINAL) emit nothing.
	const textCaseMap: Record<string, "upper" | "lower" | "title"> = {
		UPPER: "upper",
		LOWER: "lower",
		TITLE: "title",
	};
	const caseMode = node.style.textCase
		? textCaseMap[node.style.textCase]
		: undefined;

	const properties: Record<string, unknown> = {
		font: baseFont,
		color: figmaColorToHex(fill.color),
		align: ALIGN[node.style.textAlignHorizontal] ?? "left",
		verticalAlign: VALIGN[node.style.textAlignVertical] ?? "top",
		// Figma's "Vertical trim". Emitted only for CAP_HEIGHT, because STANDARD is
		// both Figma's default and coatfile's: the first baseline is half the
		// leading plus the ascent. Trimming instead lifts every line by about
		// ascent − capHeight — 0.39em in Vend Sans, which reads as text floating
		// above where the layer put it.
		...(node.style.leadingTrim === "CAP_HEIGHT" ? { leadingTrim: true } : {}),
		...(fitMode ? { fit: fitMode } : {}),
		...(node.style.paragraphSpacing
			? { paragraphSpacing: round2(node.style.paragraphSpacing * ctx.scale) }
			: {}),
		...(caseMode ? { case: caseMode } : {}),
	};
	if (spans) {
		properties.spans = spans;
	} else {
		properties.value = node.characters;
	}

	return {
		id: boundTokenMatch.ok
			? boundTokenMatch.id
			: nameTokenMatch.ok
				? nameTokenMatch.id
				: node.name.replace(/[^a-zA-Z0-9_]/g, "_") || node.id.replace(":", "_"),
		type: "text" as const,
		pos,
		size,
		...(rotation !== 0 ? { rotation } : {}),
		properties,
	};
}

/** Figma's explicitly set OpenType features, as coatfile's lowercase tags. */
function fontFeatures(features: Record<string, boolean> | undefined): {
	features?: Record<string, number>;
} {
	const entries = Object.entries(features ?? {}).filter(([tag]) =>
		/^[A-Za-z0-9]{4}$/.test(tag),
	);
	if (entries.length === 0) return {};
	return {
		features: Object.fromEntries(
			entries.map(([tag, on]) => [tag.toLowerCase(), on ? 1 : 0]),
		),
	};
}

// Walk characters + characterStyleOverrides; group consecutive chars that
// share an override key into a single span. Returns undefined when the
// node has no overrides (caller falls back to the simpler `value` path).
function buildSpans(
	node: FigmaTextNode,
	scale: number,
): Array<Record<string, unknown>> | undefined {
	const overrides = node.characterStyleOverrides;
	if (!overrides || overrides.length === 0) return undefined;
	if (!overrides.some((k) => k !== 0)) return undefined;

	const table = node.styleOverrideTable ?? {};
	const chars = [...node.characters];

	type Group = { key: number; text: string };
	const groups: Group[] = [];
	for (let i = 0; i < chars.length; i++) {
		const key = overrides[i] ?? 0;
		const last = groups[groups.length - 1];
		if (last && last.key === key) last.text += chars[i];
		else groups.push({ key, text: chars[i] });
	}

	return groups.map((g) => {
		const span: Record<string, unknown> = { text: g.text };
		if (g.key === 0) return span;
		const styleOverride = table[String(g.key)];
		if (!styleOverride) return span;
		const fontOverride: Record<string, unknown> = {};
		if (styleOverride.fontFamily !== undefined)
			fontOverride.family = styleOverride.fontFamily;
		if (styleOverride.fontSize !== undefined)
			fontOverride.size = round2(styleOverride.fontSize * scale);
		if (styleOverride.fontWeight !== undefined)
			Object.assign(fontOverride, weightFields(styleOverride.fontWeight));
		if (styleOverride.italic !== undefined)
			fontOverride.style = styleOverride.italic ? "italic" : "normal";
		// A segment's own line height, in the same shape the base style uses: a
		// percent or a px value, and nothing at all for AUTO — which is the font's
		// line box, so it says "auto" rather than inheriting the element's number.
		if (styleOverride.lineHeightPercentFontSize !== undefined)
			fontOverride.lineHeight = round2(
				styleOverride.lineHeightPercentFontSize / 100,
			);
		else if (
			styleOverride.lineHeightPx !== undefined &&
			styleOverride.fontSize !== undefined
		)
			fontOverride.lineHeight = round2(
				styleOverride.lineHeightPx / styleOverride.fontSize,
			);
		else if (styleOverride.fontSize !== undefined)
			fontOverride.lineHeight = "auto";
		if (
			styleOverride.letterSpacing !== undefined &&
			styleOverride.letterSpacing !== 0
		) {
			fontOverride.letterSpacing = styleOverride.letterSpacing * scale;
		}
		if (Object.keys(fontOverride).length > 0) span.font = fontOverride;
		return span;
	});
}
