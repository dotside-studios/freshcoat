import { wholeToken } from "@freshcoat-js/coatfile/mustache";
import type { FigmaBoundingBox, FigmaTextNode, FigmaTextStyle } from "../types";
import { compositeSolids, figmaPaintToFill } from "./colors";
import { FlattenFallbackError, placeLocal, placeWorld } from "./coordinates";

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

	// Fields are registered centrally from the node binding (see
	// binding-overlay.ts); here we only derive the element id.
	//
	// The BINDING names the element, ahead of the layer. Figma auto-names a text
	// layer after its own content until someone renames it, so a layer bound to
	// {{name}} but showing a filled-in preview arrives called "Jeanie Mosciski"
	// — and the same field then has a different element id on each side of the
	// card. Worse, a colorway instance previewing different text renames its
	// layer too, so the base and the variant stop lining up by id and the
	// override is dropped as a structure mismatch. A binding that is one whole
	// token is the field, so it is the id.
	const boundToken = wholeToken((textTemplate ?? "").trim());
	const nameToken = wholeToken(node.name.trim());

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
	// level ONLY when "Truncate text" is on (textTruncation ENDING, or the
	// deprecated textAutoResize "TRUNCATE").
	// Emitting `fit: "clip"` unconditionally cut off overflowing fixed-size
	// paragraphs (e.g. the back-of-card legal block), so we clip only for the
	// truncate case and otherwise let the overflow render. `shrink` (font
	// binary-searched down) is never what Figma does, so we don't emit it.
	const truncates =
		node.style.textTruncation === "ENDING" ||
		node.style.textAutoResize === "TRUNCATE";
	const fitMode: "clip" | undefined = truncates ? "clip" : undefined;

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
		...fontFeatures(node.style.openTypeFeatures, node.style.textCase),
	};
	const maxLines = truncates
		? truncatedLines(
				node.style.maxLines,
				size.height,
				baseFont.size,
				lineHeight,
			)
		: undefined;

	const color = compositeSolids(node.fills);
	const built = buildSpans(node, ctx.scale, baseFont, color);
	const decoration = decorationOf(node.style);
	if (decoration && !built?.decorationSplit) {
		Object.assign(baseFont, { decoration });
	}

	// Figma "Case" → coatfile applies it to the RESOLVED text (so dynamic
	// {{values}} are cased). Small caps are font features (see fontFeatures).
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
		...paintProperties(node, size, color),
		align: ALIGN[node.style.textAlignHorizontal] ?? "left",
		verticalAlign: VALIGN[node.style.textAlignVertical] ?? "top",
		// Figma's "Vertical trim". Emitted only for CAP_HEIGHT, because STANDARD is
		// both Figma's default and coatfile's: the first baseline is half the
		// leading plus the ascent. Trimming instead lifts every line by about
		// ascent − capHeight — 0.39em in Vend Sans, which reads as text floating
		// above where the layer put it.
		...(node.style.leadingTrim === "CAP_HEIGHT" ? { leadingTrim: true } : {}),
		...(fitMode ? { fit: fitMode } : {}),
		...(maxLines !== undefined ? { maxLines } : {}),
		...(node.style.paragraphSpacing
			? { paragraphSpacing: round2(node.style.paragraphSpacing * ctx.scale) }
			: {}),
		...(caseMode ? { case: caseMode } : {}),
	};
	if (built) {
		properties.spans = built.spans;
	} else {
		properties.value = node.characters;
	}

	return {
		id:
			boundToken ??
			nameToken ??
			(node.name.replace(/[^a-zA-Z0-9_]/g, "_") || node.id.replace(":", "_")),
		type: "text" as const,
		pos,
		size,
		...(rotation !== 0 ? { rotation } : {}),
		properties,
	};
}

/** Figma's "Truncate text" line cap. Without an explicit maxLines Figma keeps
 *  the lines the box holds, which needs a numeric line height to count. */
function truncatedLines(
	maxLines: number | undefined,
	boxHeight: number,
	fontSize: number,
	lineHeight: number | "auto",
): number | undefined {
	if (maxLines !== undefined && maxLines > 0) return Math.floor(maxLines);
	if (lineHeight === "auto") return undefined;
	const linePx = fontSize * lineHeight;
	if (!(linePx > 0)) return undefined;
	return Math.max(1, Math.floor(boxHeight / linePx + 0.01));
}

type TextCase = FigmaTextStyle["textCase"];

function smallCapsFeatures(textCase: TextCase): Record<string, number> {
	if (textCase === "SMALL_CAPS") return { smcp: 1 };
	if (textCase === "SMALL_CAPS_FORCED") return { smcp: 1, c2sc: 1 };
	return {};
}

/** Figma's explicitly set OpenType features, as coatfile's lowercase tags,
 *  plus the ones its small caps case turns on. */
function fontFeatures(
	features: Record<string, boolean> | undefined,
	textCase?: TextCase,
): {
	features?: Record<string, number>;
} {
	const entries = Object.entries(features ?? {}).filter(([tag]) =>
		/^[A-Za-z0-9]{4}$/.test(tag),
	);
	const merged = {
		...Object.fromEntries(
			entries.map(([tag, on]) => [tag.toLowerCase(), on ? 1 : 0]),
		),
		...smallCapsFeatures(textCase),
	};
	return Object.keys(merged).length > 0 ? { features: merged } : {};
}

/** The small caps features a run sets where its case differs from the base. */
function runSmallCaps(
	runCase: TextCase,
	baseCase: TextCase,
): Record<string, number> {
	const run = smallCapsFeatures(runCase);
	const base = smallCapsFeatures(baseCase);
	const out: Record<string, number> = {};
	for (const tag of ["smcp", "c2sc"])
		if ((run[tag] ?? 0) !== (base[tag] ?? 0)) out[tag] = run[tag] ?? 0;
	return out;
}

type Decoration = "underline" | "line-through";

function decorationOf(
	style: Partial<FigmaTextStyle> | undefined,
): Decoration | undefined {
	if (style?.textDecoration === "UNDERLINE") return "underline";
	if (style?.textDecoration === "STRIKETHROUGH") return "line-through";
	return undefined;
}

// The text's colour, or for a gradient-filled text its `fill` over the whole
// box. classify() only lets a text through when its paints are one of the two.
function paintProperties(
	node: FigmaTextNode,
	size: { width: number; height: number },
	color: string | null,
): Record<string, unknown> {
	if (color !== null) return { color };
	const paint = node.fills.find((f) => f.visible !== false);
	if (!paint) return {};
	const result = figmaPaintToFill(paint, size);
	return result.kind === "fill" ? { fill: result.value } : {};
}

// Walk characters + characterStyleOverrides; group consecutive chars that
// share an override key into a single span, carrying only what differs from
// the element's own font and colour. Returns undefined when the node has no
// overrides (caller falls back to the simpler `value` path).
//
// A span cannot turn off a decoration the element sets, so when runs disagree
// on it the element sets none and each decorated span carries its own.
function buildSpans(
	node: FigmaTextNode,
	scale: number,
	baseFont: Record<string, unknown>,
	baseColor: string | null,
):
	| { spans: Array<Record<string, unknown>>; decorationSplit: boolean }
	| undefined {
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

	const baseDecoration = decorationOf(node.style);
	const decorationFor = (key: number) => {
		const o = key === 0 ? undefined : table[String(key)];
		return o?.textDecoration !== undefined ? decorationOf(o) : baseDecoration;
	};
	const split = groups.some((g) => decorationFor(g.key) !== baseDecoration);

	const spans = groups.map((g) => {
		const span: Record<string, unknown> = { text: g.text };
		const fontOverride: Record<string, unknown> = {};
		const decoration = decorationFor(g.key);
		if (split && decoration) fontOverride.decoration = decoration;
		const styleOverride = g.key === 0 ? undefined : table[String(g.key)];
		if (styleOverride) {
			Object.assign(
				fontOverride,
				runFont(styleOverride, scale, baseFont, node.style.textCase),
			);
			if (styleOverride.fills) {
				const color = compositeSolids(styleOverride.fills);
				if (color !== null && color !== baseColor) span.color = color;
			}
		}
		if (Object.keys(fontOverride).length > 0) span.font = fontOverride;
		return span;
	});
	return { spans, decorationSplit: split };
}

function runFont(
	styleOverride: Partial<FigmaTextStyle>,
	scale: number,
	baseFont: Record<string, unknown>,
	baseCase: TextCase,
): Record<string, unknown> {
	const fontOverride: Record<string, unknown> = {};
	if (styleOverride.textCase !== undefined) {
		const caps = runSmallCaps(styleOverride.textCase, baseCase);
		if (Object.keys(caps).length > 0) fontOverride.features = caps;
	}
	if (styleOverride.fontFamily !== undefined)
		fontOverride.family = styleOverride.fontFamily;
	if (styleOverride.fontSize !== undefined)
		fontOverride.size = round2(styleOverride.fontSize * scale);
	if (styleOverride.fontWeight !== undefined) {
		const fields = weightFields(styleOverride.fontWeight);
		Object.assign(fontOverride, fields);
		if (!fields.variations && baseFont.variations)
			fontOverride.variations = { wght: fields.weight };
	}
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
	if (styleOverride.letterSpacing !== undefined) {
		const spacing = styleOverride.letterSpacing * scale;
		if (spacing !== ((baseFont.letterSpacing as number | undefined) ?? 0))
			fontOverride.letterSpacing = spacing;
	}
	for (const key of Object.keys(fontOverride)) {
		if (JSON.stringify(fontOverride[key]) === JSON.stringify(baseFont[key]))
			delete fontOverride[key];
	}
	if (fontOverride.style === "normal" && baseFont.style === undefined)
		delete fontOverride.style;
	return fontOverride;
}
