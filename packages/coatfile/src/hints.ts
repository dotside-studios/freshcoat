import { printGuidesFor, type SafeAreaEdge, safeAreaIssues } from "./bleed";
import {
	formatMinor,
	formatVersionStatus,
	minimumFormatVersion,
} from "./format";
import type { Sides, Template } from "./types";
import { checkVariants, type VariantIssue } from "./variants";

export type SafeAreaHint = {
	kind: "safe_area";
	/** Frame index in `template_data`. */
	side: number;
	/** The frame's name. */
	sideName: string;
	/** Index of the top-level layer in its frame. */
	index: number;
	/** The layer's id. */
	id: string;
	/** The edges that lie between the trim and the safe line. */
	edges: SafeAreaEdge[];
	/** The safe area the layer was checked against, in template units. */
	safe: Sides;
};

export type TemplateHint =
	/** A variant change that changes nothing or names a layer that is gone. */
	| { kind: "variant"; issue: VariantIssue }
	| SafeAreaHint
	/** Written by a newer 1.x kit than this one reads. */
	| { kind: "format_newer"; declared: string }
	/** Uses fields from a later minor than the version it declares. */
	| { kind: "format_low"; declared: string; needed: string };

/** Top-level layers too close to the trim. Checked against the template's
 *  own safe area, or the printer's 3 mm for a CR80 card with none. */
export function safeAreaHints(t: Template): SafeAreaHint[] {
	const { safe } = printGuidesFor(t);
	if (!safe) return [];
	return safeAreaIssues(t, { safe }).map(({ side, index, id, edges }) => ({
		kind: "safe_area",
		side,
		sideName: t.template_data[side]?.name ?? String(side),
		index,
		id,
		edges,
		safe,
	}));
}

/**
 * What is worth telling an author about a template that is valid: variant
 * issues, layers inside the safe area, and a format version that does not
 * match the file. Each hint carries its data; wording is the caller's.
 */
export function templateHints(t: Template): TemplateHint[] {
	const hints: TemplateHint[] = checkVariants(t).map((issue) => ({
		kind: "variant",
		issue,
	}));
	hints.push(...safeAreaHints(t));
	const declared = t.format_version;
	if (formatVersionStatus(declared) === "newer")
		hints.push({ kind: "format_newer", declared });
	const needed = minimumFormatVersion(t);
	if (formatMinor(needed) > formatMinor(declared))
		hints.push({ kind: "format_low", declared, needed });
	return hints;
}
