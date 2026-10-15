import {
	codepointLabel,
	type GlyphIssue,
	type PresetBlock,
	summarizeGlyphs,
} from "@freshcoat-js/workspace/export";
import { BINDING, plural } from "~/app/copy";
import type { SettingsSectionId } from "./collapsed";

const SHOWN_CHARS = 12;
const SHOWN_ITEMS = 50;

export type CheckTarget =
	| { kind: "binding" }
	| { kind: "record"; recordId: string }
	| { kind: "failed" }
	| { kind: "section"; id: SettingsSectionId };

export type Check = {
	id: "blocked" | "unbound" | "unfilled" | "glyphs" | "failed";
	/** an error stops the export; a warning lets it run */
	severity: "error" | "warning";
	message: string;
	/** the whole of a short message, for its hover */
	detail?: string;
	action?: { label: string; target: CheckTarget };
	/** the records behind the check, each a link */
	items?: {
		key: string;
		label: string;
		note: string;
		target: CheckTarget;
	}[];
};

const BLOCK_TARGET: Partial<Record<PresetBlock["reason"], CheckTarget>> = {
	sheets: { kind: "section", id: "print" },
};

/** Everything that stands between a preset and a good export, in the order
 *  to deal with it: what stops the export, then what spoils it. */
export function exportChecks(input: {
	blocked: PresetBlock | null;
	unbound: boolean;
	unfilled: number;
	glyphs: readonly GlyphIssue[] | null;
	failed: number;
	labelFor: (recordId: string) => string;
	showSide: boolean;
	canPick: boolean;
}): Check[] {
	const checks: Check[] = [];
	const { blocked } = input;
	if (blocked) {
		const target = BLOCK_TARGET[blocked.reason];
		checks.push({
			id: "blocked",
			severity: "error",
			message: blocked.message,
			...(blocked.detail ? { detail: blocked.detail } : {}),
			...(target ? { action: { label: "Show", target } } : {}),
		});
	}
	if (input.unbound)
		checks.push({
			id: "unbound",
			severity: "warning",
			message: "Not bound to a dataset, exporting defaults",
			action: { label: "Bind a dataset", target: { kind: "binding" } },
		});
	if (input.unfilled > 0)
		checks.push({
			id: "unfilled",
			severity: "warning",
			message: BINDING.unfilled(input.unfilled),
			action: { label: "Show binding", target: { kind: "binding" } },
		});
	if (input.glyphs && input.glyphs.length > 0) {
		const { records, codepoints } = summarizeGlyphs(input.glyphs);
		const chars = codepoints.slice(0, SHOWN_CHARS);
		const shown = chars.map((cp) => String.fromCodePoint(cp)).join(" ");
		checks.push({
			id: "glyphs",
			severity: "warning",
			message: `${plural(records, "record")} ${records === 1 ? "has" : "have"} characters the fonts can't draw: ${shown}${codepoints.length > chars.length ? " …" : ""}`,
			...(input.canPick
				? {
						items: input.glyphs.slice(0, SHOWN_ITEMS).map((issue, i) => ({
							key: `${issue.recordId}:${issue.side}:${issue.elementId}:${i}`,
							label: input.labelFor(issue.recordId),
							note: [
								input.showSide ? issue.side : null,
								issue.elementId,
								issue.codepoints
									.map(
										(cp) => `${String.fromCodePoint(cp)} ${codepointLabel(cp)}`,
									)
									.join(", "),
							]
								.filter(Boolean)
								.join(" · "),
							target: { kind: "record" as const, recordId: issue.recordId },
						})),
					}
				: {}),
		});
	}
	if (input.failed > 0)
		checks.push({
			id: "failed",
			severity: "warning",
			message: `${plural(input.failed, "record")} failed in the last export`,
			action: { label: "Show failed", target: { kind: "failed" } },
		});
	return checks;
}

export function checksSummary(checks: readonly Check[]): string {
	if (checks.length === 0) return "All clear";
	return plural(checks.length, "issue");
}
