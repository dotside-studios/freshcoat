// Automatic line height — the "AUTO" a design tool shows when nobody typed a
// number. It is not a constant: it is the FONT's own line box, its typo ascent +
// descent + line gap. Vend Sans is 1.48; Geist is not; a template that hard-codes
// 1.2 for both renders neither the way its source did.
//
// A font carries `autoLineHeight` when the authored value was AUTO. `lineHeight`
// still holds a usable number (the fallback below), so every consumer that never
// learned about this — a bare resolveLayout, the approx engine, an older
// painter — keeps laying text out instead of producing NaN. compileScene
// substitutes the real value once, before layout and baking, for the families it
// has metrics for.
import { getFontMetrics } from "./font-metrics";
import type { Node, TextNode } from "./node";
import type { FontVMetrics, ResolvedFont } from "./types";

// What an unresolvable AUTO falls back to: the value coatfile has always
// written for it, so a family with no metrics renders exactly as it did before.
export const FALLBACK_LINE_HEIGHT = 1.2;

// A font's own line box, per em. The sum a design tool uses for AUTO.
export function autoLineHeight(metrics: FontVMetrics | undefined): number {
	if (!metrics) return FALLBACK_LINE_HEIGHT;
	const height = metrics.ascent + metrics.descent + metrics.lineGap;
	return height > 0 ? height : FALLBACK_LINE_HEIGHT;
}

// Where a family's vertical metrics come from: an explicit map (what
// deriveFontMetrics builds from font bytes), else the global registry, else
// nothing. A caller with a live text engine passes `engine.metricsFor` as
// `probe` — the sfnt reader can't parse woff2, which is exactly what a browser
// is served, and the engine's backend already has the decoded face.
export type MetricsLookup = (family: string) => FontVMetrics | undefined;

export function metricsLookup(
	explicit?: Record<string, FontVMetrics>,
	probe?: MetricsLookup,
): MetricsLookup {
	return (family) =>
		explicit?.[family] ?? getFontMetrics(family) ?? probe?.(family);
}

// Replace every AUTO line height in the tree with the font's own. Returns the
// same node when nothing is marked AUTO, so a tree that never used it is not
// copied. Idempotent: a resolved font is no longer marked.
export function resolveAutoLineHeights(
	root: Node,
	lookup: MetricsLookup,
): Node {
	return hasAuto(root) ? rewrite(root, lookup) : root;
}

function hasAuto(node: Node): boolean {
	switch (node.kind) {
		case "text":
			return (
				!!node.font.autoLineHeight ||
				!!node.spans?.some((s) => s.font?.autoLineHeight)
			);
		case "group":
			return node.children.some(hasAuto);
		case "mask":
			return hasAuto(node.mask) || node.children.some(hasAuto);
		default:
			return false;
	}
}

function rewrite(node: Node, lookup: MetricsLookup): Node {
	switch (node.kind) {
		case "text":
			return rewriteText(node, lookup);
		case "group":
			return {
				...node,
				children: node.children.map((c) => rewrite(c, lookup)),
			};
		case "mask":
			return {
				...node,
				mask: rewrite(node.mask, lookup),
				children: node.children.map((c) => rewrite(c, lookup)),
			};
		default:
			return node;
	}
}

function rewriteText(node: TextNode, lookup: MetricsLookup): TextNode {
	const font = resolveFont(node.font, node.font.family, lookup) as ResolvedFont;
	const spans = node.spans?.map((span) =>
		span.font
			? {
					...span,
					// A span inherits the element's family unless it names its own.
					font: resolveFont(
						span.font,
						span.font.family ?? node.font.family,
						lookup,
					),
				}
			: span,
	);
	return { ...node, font, ...(spans ? { spans } : {}) };
}

function resolveFont<T extends Partial<ResolvedFont>>(
	font: T,
	family: string,
	lookup: MetricsLookup,
): T {
	if (!font.autoLineHeight) return font;
	const { autoLineHeight: _, ...rest } = font;
	return { ...rest, lineHeight: autoLineHeight(lookup(family)) } as T;
}
