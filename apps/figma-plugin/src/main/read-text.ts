import type { FigmaTextNode, FigmaTextStyle } from "~/lib/figma/types";
import { type AnySceneNode, readBaseFields } from "~/main/read-base";
import { type AnyPaint, readPaints } from "~/main/read-paint";

type AnyLetterSpacing = { value: number; unit: "PIXELS" | "PERCENT" };
type AnyLineHeight =
	| { value: number; unit: "PIXELS" | "PERCENT" }
	| { unit: "AUTO" };

// Fallbacks when a font property is mixed and the text has no styled runs to
// borrow from — a degenerate case, but the payload still has to be numbers.
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = "Inter";

function isItalic(style: string): boolean {
	return /italic/i.test(style);
}

function letterSpacingPx(
	ls: AnyLetterSpacing | undefined,
	fontSize: number,
): number | undefined {
	if (!ls) return undefined;
	if (ls.unit === "PERCENT") return (ls.value / 100) * fontSize;
	return ls.value;
}

function lineHeightFields(
	lh: AnyLineHeight | undefined,
	_fontSize: number,
): Partial<FigmaTextStyle> {
	if (!lh || lh.unit === "AUTO") return {};
	if (lh.unit === "PERCENT") return { lineHeightPercentFontSize: lh.value };
	return { lineHeightPx: lh.value };
}

type AnyTextSegment = {
	start: number;
	end: number;
	fontName: { family: string; style: string };
	fontSize: number;
	fontWeight: number;
	letterSpacing?: AnyLetterSpacing;
	lineHeight?: AnyLineHeight;
	fills?: readonly AnyPaint[];
	textDecoration?: string;
};

// Every font property below is typed `unknown` on purpose: Figma returns
// figma.mixed (a symbol) for any of them when the value varies across the
// string. Typing them as their happy-path shape is what let a symbol reach
// postMessage. Read them through the plain* guards.
type AnyTextNode = AnySceneNode & {
	characters: string;
	fontName: unknown;
	fontSize: unknown;
	fontWeight: unknown;
	letterSpacing?: unknown;
	lineHeight?: unknown;
	textAlignHorizontal: unknown;
	textAlignVertical: unknown;
	textAutoResize?: unknown;
	textCase?: unknown;
	leadingTrim?: unknown;
	openTypeFeatures?: unknown;
	paragraphSpacing?: unknown;
	textDecoration?: unknown;
	fills: readonly AnyPaint[] | typeof figma.mixed;
	getStyledTextSegments: (fields: string[]) => AnyTextSegment[];
};

// Any text property that varies across the string reads back as `figma.mixed`,
// which is a SYMBOL. A symbol cannot cross figma.ui.postMessage — it fails the
// whole message with "Cannot unwrap symbol" — so nothing read off a node may
// reach the payload unchecked. These two narrow a value to a usable primitive,
// returning undefined for mixed (or anything else unexpected).
function plainNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function plainString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** letterSpacing is an object, so `mixed` has to be rejected structurally. */
function plainLetterSpacing(value: unknown): AnyLetterSpacing | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const ls = value as Partial<AnyLetterSpacing>;
	return typeof ls.value === "number" && typeof ls.unit === "string"
		? (ls as AnyLetterSpacing)
		: undefined;
}

/** openTypeFeatures is an object of booleans; `mixed` is a symbol. */
function plainFeatures(value: unknown): Record<string, boolean> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const out: Record<string, boolean> = {};
	for (const [tag, on] of Object.entries(value))
		if (typeof on === "boolean") out[tag] = on;
	return Object.keys(out).length > 0 ? out : undefined;
}

function plainLineHeight(value: unknown): AnyLineHeight | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const lh = value as { unit?: unknown };
	return typeof lh.unit === "string" ? (value as AnyLineHeight) : undefined;
}

/** Build the base FigmaTextStyle from the node-level font props, falling back
 *  to `primary` — the text's first styled run — for anything the node reports
 *  as mixed. A paragraph with a bold phrase in it has mixed fontName/fontSize/
 *  fontWeight at the node level, so on that text every font field here would
 *  otherwise be a symbol; the per-run styles are captured separately in
 *  styleOverrideTable, and run 0 is what the base is meant to describe anyway. */
function baseTextStyle(
	node: AnyTextNode,
	primary: AnyTextSegment | undefined,
): FigmaTextStyle {
	const fontName = (
		typeof node.fontName === "object" && node.fontName !== null
			? node.fontName
			: primary?.fontName
	) as { family?: unknown; style?: unknown } | undefined;
	const fontSize =
		plainNumber(node.fontSize) ?? primary?.fontSize ?? DEFAULT_FONT_SIZE;
	const letterSpacing =
		plainLetterSpacing(node.letterSpacing) ?? primary?.letterSpacing;
	// Mixed on the node means the runs disagree; the first run is what the base
	// describes, same as it is for size and weight. Without this fallback a node
	// whose runs differ in line height reports AUTO for all of them.
	const lineHeight = plainLineHeight(node.lineHeight) ?? primary?.lineHeight;

	return {
		fontFamily: plainString(fontName?.family) ?? DEFAULT_FONT_FAMILY,
		fontSize,
		fontWeight: plainNumber(node.fontWeight) ?? primary?.fontWeight ?? 400,
		italic: isItalic(plainString(fontName?.style) ?? ""),
		letterSpacing: letterSpacingPx(letterSpacing, fontSize),
		textAlignHorizontal: plainString(
			node.textAlignHorizontal,
		) as FigmaTextStyle["textAlignHorizontal"],
		textAlignVertical: plainString(
			node.textAlignVertical,
		) as FigmaTextStyle["textAlignVertical"],
		textAutoResize: plainString(
			node.textAutoResize,
		) as FigmaTextStyle["textAutoResize"],
		...(plainString(node.textCase)
			? { textCase: node.textCase as FigmaTextStyle["textCase"] }
			: {}),
		// Absent on older API versions, and mixed when it varies across the string
		// — both read as unset, which is Figma's own default (STANDARD).
		...(plainString(node.leadingTrim)
			? { leadingTrim: node.leadingTrim as FigmaTextStyle["leadingTrim"] }
			: {}),
		...(plainNumber(node.paragraphSpacing)
			? { paragraphSpacing: plainNumber(node.paragraphSpacing) }
			: {}),
		...(plainFeatures(node.openTypeFeatures)
			? { openTypeFeatures: plainFeatures(node.openTypeFeatures) }
			: {}),
		...decorationField(
			plainString(node.textDecoration) ?? primary?.textDecoration,
		),
		...lineHeightFields(lineHeight, fontSize),
	};
}

function decorationField(
	value: string | undefined,
): Pick<FigmaTextStyle, "textDecoration"> {
	return value === "UNDERLINE" || value === "STRIKETHROUGH"
		? { textDecoration: value }
		: {};
}

/** A stable signature for a segment's style, used to allocate override keys. */
function segSignature(s: AnyTextSegment): string {
	return JSON.stringify([
		s.fontName.family,
		s.fontName.style,
		s.fontSize,
		s.fontWeight,
		s.letterSpacing?.value ?? 0,
		s.letterSpacing?.unit ?? "PIXELS",
		// Line height varies per segment as freely as size does — a signature
		// block whose first line is set to 132% and whose rest is Auto is one
		// text node with two line boxes.
		s.lineHeight?.unit ?? "AUTO",
		s.lineHeight && s.lineHeight.unit !== "AUTO" ? s.lineHeight.value : 0,
		s.textDecoration ?? "NONE",
		readPaints(s.fills),
	]);
}

export function readTextNode(node: AnyTextNode): FigmaTextNode {
	const base = readBaseFields(node);

	// Segments come first: they're what the base style falls back to when the
	// node reports a font property as mixed.
	const segments = node.getStyledTextSegments([
		"fontName",
		"fontSize",
		"fontWeight",
		"letterSpacing",
		"lineHeight",
		"fills",
		"textDecoration",
	]);
	const style = baseTextStyle(node, segments[0]);
	// Fills that vary across the string read back as mixed; the first run's are
	// the base, as its font is.
	const fills = readPaints(
		Array.isArray(node.fills) ? node.fills : segments[0]?.fills,
	);
	const charCount = [...node.characters].length;
	const overrides = new Array<number>(charCount).fill(0);
	const table: Record<string, Partial<FigmaTextStyle>> = {};

	// The dominant (first) segment's style is the base (key 0); each *other*
	// distinct style gets an incrementing key.
	const baseSig = segments.length > 0 ? segSignature(segments[0]) : "";
	const keyBySig = new Map<string, number>([[baseSig, 0]]);
	let nextKey = 1;

	for (const seg of segments) {
		const sig = segSignature(seg);
		let key = keyBySig.get(sig);
		if (key === undefined) {
			key = nextKey++;
			keyBySig.set(sig, key);
			table[String(key)] = {
				fontFamily: seg.fontName.family,
				fontSize: seg.fontSize,
				fontWeight: seg.fontWeight,
				italic: isItalic(seg.fontName.style),
				letterSpacing: letterSpacingPx(seg.letterSpacing, seg.fontSize),
				textDecoration:
					seg.textDecoration === "UNDERLINE" ||
					seg.textDecoration === "STRIKETHROUGH"
						? seg.textDecoration
						: "NONE",
				...(seg.fills ? { fills: readPaints(seg.fills) } : {}),
				// AUTO contributes no fields, exactly as it does on the base style,
				// and the transpiler reads that absence as "auto".
				...lineHeightFields(seg.lineHeight, seg.fontSize),
			};
		}
		for (let i = seg.start; i < seg.end && i < charCount; i++)
			overrides[i] = key;
	}

	return {
		...base,
		type: "TEXT",
		characters: node.characters,
		style,
		fills,
		characterStyleOverrides: overrides,
		styleOverrideTable: table,
	};
}
