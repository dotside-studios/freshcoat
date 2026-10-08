import { compile, type Template, variantSize } from "@freshcoat-js/coatfile";
import { findMissingGlyphs } from "@freshcoat-js/coatfile/render";
import type { Renderer } from "@freshcoat-js/engine";
import type { ExportItem } from "@freshcoat-js/workspace";

export type GlyphCheckItem = Pick<
	ExportItem,
	"recordId" | "side" | "values" | "variantId"
>;

export type GlyphIssue = {
	recordId: string;
	side: string;
	variantId?: string;
	elementId?: string;
	text: string;
	codepoints: number[];
};

export function checkGlyphs(
	template: Template,
	item: GlyphCheckItem,
	renderer: Renderer,
): GlyphIssue[] {
	const variantId =
		item.variantId && template.variants?.some((v) => v.id === item.variantId)
			? item.variantId
			: undefined;
	const compiled = compile(template, item.values, {
		...variantSize(template, variantId),
		...(variantId ? { variantId } : {}),
		frameNames: [item.side],
	});
	return findMissingGlyphs(renderer, compiled, {
		frameNames: [item.side],
	}).map((m) => ({
		recordId: item.recordId,
		side: item.side,
		...(item.variantId ? { variantId: item.variantId } : {}),
		...(m.id ? { elementId: m.id } : {}),
		text: m.text,
		codepoints: m.codepoints,
	}));
}

const CHUNK = 25;

/** Checks every item, yielding between chunks so a newer request can stop
 *  this one. Resolves null when `stale` turns true. */
export async function checkAllGlyphs(
	template: Template,
	items: readonly GlyphCheckItem[],
	renderer: Renderer,
	stale: () => boolean = () => false,
): Promise<GlyphIssue[] | null> {
	const out: GlyphIssue[] = [];
	for (let i = 0; i < items.length; i += CHUNK) {
		if (i > 0) await new Promise((resolve) => setTimeout(resolve, 0));
		if (stale()) return null;
		for (const item of items.slice(i, i + CHUNK))
			out.push(...checkGlyphs(template, item, renderer));
	}
	return out;
}

export type GlyphSummary = {
	records: number;
	codepoints: number[];
};

export function summarizeGlyphs(issues: readonly GlyphIssue[]): GlyphSummary {
	const records = new Set<string>();
	const codepoints = new Set<number>();
	for (const issue of issues) {
		records.add(issue.recordId);
		for (const cp of issue.codepoints) codepoints.add(cp);
	}
	return { records: records.size, codepoints: [...codepoints] };
}

export function codepointLabel(cp: number): string {
	return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}
