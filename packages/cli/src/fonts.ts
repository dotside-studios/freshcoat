import {
	collectFontRequests,
	fontUsage,
	type ResolvedTemplateFonts,
	type Template,
} from "@freshcoat-js/coatfile";
import {
	codepointLabel,
	type GlyphIssue,
	summarizeGlyphs,
} from "@freshcoat-js/workspace/export";
import type { Log } from "./io";

export type FontSummary = {
	family: string;
	declared: boolean;
	weights: number[];
	italic: boolean;
};

export function summarizeFonts(template: Template): FontSummary[] {
	const usage = fontUsage(template);
	return collectFontRequests(template).map((request) => ({
		family: request.family,
		declared: "descriptor" in request,
		weights: usage.get(request.family)?.weights ?? [400],
		italic: usage.get(request.family)?.italic ?? false,
	}));
}

type FontReport = Pick<ResolvedTemplateFonts, "guessed" | "missing">;

export function warnAboutFonts(log: Log, report: FontReport): void {
	if (report.guessed.length > 0)
		log.warn(
			`fonts not declared by the template, found on Google Fonts by name: ${report.guessed.join(", ")}`,
		);
	if (report.missing.length > 0)
		log.warn(
			`no font data for ${report.missing.join(", ")}; text in them uses a fallback face`,
		);
}

export function warnAboutGlyphs(
	log: Log,
	issues: readonly GlyphIssue[],
	scope: "records" | "frames",
): void {
	if (issues.length === 0) return;
	const { records, codepoints } = summarizeGlyphs(issues);
	const where =
		scope === "records"
			? `${records} ${records === 1 ? "record" : "records"}`
			: [...new Set(issues.map((issue) => issue.side))].join(", ");
	log.warn(
		`the fonts have no glyphs for ${codepoints.map(codepointLabel).join(" ")} in ${where}; they print as boxes`,
	);
}
