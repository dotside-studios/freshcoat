import type { TemplateSource } from "@freshcoat-js/coatfile";
import type {
	FigmaPick,
	FigmaVariantPick,
	TranspileReport,
} from "~/lib/figma/transpiler";

/** Stamped on `template.source.kind` by every export this plugin writes. A
 *  consumer keys off it to know the rest of the object has the shape below. */
const FIGMA_SOURCE_KIND = "figma";

/** What this plugin records about an export. coatfile fixes only `kind` and
 *  round-trips the rest unread, so this module is the whole definition. */
export type FigmaSource = TemplateSource & {
	kind: typeof FIGMA_SOURCE_KIND;
	importedAt: string;
	/** Which figma node each `template_data` frame was read from, keyed by frame
	 *  name. */
	picks: Record<string, FigmaPick>;
	/** Which figma instance each `variants` entry was read from, keyed by variant
	 *  id. Absent when the card has no colorways. */
	variants?: Record<string, FigmaVariantPick>;
	report: TranspileReport;
};

export function figmaSource(input: {
	picks: Record<string, FigmaPick>;
	variants: Record<string, FigmaVariantPick>;
	report: TranspileReport;
}): FigmaSource {
	return {
		kind: FIGMA_SOURCE_KIND,
		importedAt: new Date().toISOString(),
		picks: input.picks,
		...(Object.keys(input.variants).length > 0
			? { variants: input.variants }
			: {}),
		report: input.report,
	};
}
