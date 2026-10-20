import {
	codepointLabel,
	describeRasterized,
	type GlyphIssue,
	type JobItemResult,
	type PresetBlock,
	type PresetNotice,
	type RasterizedSide,
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
	id:
		| "blocked"
		| "unbound"
		| "unfilled"
		| "glyphs"
		| "failed"
		| "warnings"
		| "spots"
		| "rasterized"
		| PresetNotice["reason"];
	/** an error stops the export; a warning lets it run; info only tells */
	severity: "error" | "warning" | "info";
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

const NOTICE_TARGET: Record<PresetNotice["reason"], CheckTarget> = {
	print_raster: { kind: "section", id: "print" },
	spot_raster: { kind: "section", id: "format" },
};

const WARNING_TITLE: Record<string, string> = {
	image_low_dpi: "Low resolution image",
	small_text: "Small text",
	hairline_stroke: "Hairline stroke",
	rich_black_text: "Rich black text",
	short_of_bleed: "Short of bleed",
	qr_low_contrast: "Low contrast QR code",
	qr_inverted: "Inverted QR code",
	qr_quiet_zone: "QR code quiet zone",
	qr_logo_large: "Large QR code logo",
	image_load_failed: "Image not loaded",
	font_load_failed: "Font not loaded",
	svg_unsupported: "SVG feature skipped",
	effect_unsupported: "Effect skipped",
	pattern_unsupported: "Pattern painted solid",
};

export function warningTitle(code: string): string {
	const title = WARNING_TITLE[code] ?? code.replaceAll("_", " ");
	return title.charAt(0).toUpperCase() + title.slice(1);
}

export type WarningGroup = {
	code: string;
	/** the exported files that warned of it */
	count: number;
	items: { recordId: string; side: string; message: string }[];
};

/** A job's render warnings by code, the most frequent first. A spot ink
 *  drawn as an image is left to the spots check. */
export function warningGroups(
	items: readonly Pick<JobItemResult, "recordId" | "side" | "warnings">[],
): WarningGroup[] {
	const groups = new Map<string, WarningGroup>();
	for (const item of items) {
		const counted = new Set<string>();
		for (const w of item.warnings ?? []) {
			if (w.code === "spot_rasterized") continue;
			let group = groups.get(w.code);
			if (!group) {
				group = { code: w.code, count: 0, items: [] };
				groups.set(w.code, group);
			}
			if (!counted.has(w.code)) {
				counted.add(w.code);
				group.count++;
			}
			group.items.push({
				recordId: item.recordId,
				side: item.side,
				message: w.message,
			});
		}
	}
	return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Everything that stands between a preset and a good export, in the order
 *  to deal with it: what stops the export, then what spoils it. */
export function exportChecks(input: {
	blocked: PresetBlock | null;
	unbound: boolean;
	unfilled: number;
	glyphs: readonly GlyphIssue[] | null;
	failed: number;
	/** what the last export's items warned about */
	warnings?: readonly WarningGroup[];
	notices?: readonly PresetNotice[];
	/** what the last export's vector pages drew as images */
	rasterized?: readonly RasterizedSide[];
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
	for (const notice of input.notices ?? [])
		checks.push({
			id: notice.reason,
			severity: "warning",
			message: notice.message,
			...(notice.detail ? { detail: notice.detail } : {}),
			action: { label: "Show", target: NOTICE_TARGET[notice.reason] },
		});
	if (input.failed > 0)
		checks.push({
			id: "failed",
			severity: "warning",
			message: `${plural(input.failed, "record")} failed in the last export`,
			action: { label: "Show failed", target: { kind: "failed" } },
		});
	const groups = input.warnings ?? [];
	if (groups.length > 0) {
		const summary = groups
			.map((g) => `${warningTitle(g.code)} ×${g.count}`)
			.join(", ");
		checks.push({
			id: "warnings",
			severity: "warning",
			message: `Warnings in the last export: ${summary}`,
			...(input.canPick
				? {
						items: groups
							.flatMap((g) =>
								g.items.map((item, i) => ({
									key: `${g.code}:${item.recordId}:${item.side}:${i}`,
									label: input.labelFor(item.recordId),
									note: [
										warningTitle(g.code),
										input.showSide ? item.side : null,
										item.message,
									]
										.filter(Boolean)
										.join(" · "),
									target: {
										kind: "record" as const,
										recordId: item.recordId,
									},
								})),
							)
							.slice(0, SHOWN_ITEMS),
					}
				: {}),
		});
	}
	const rasterized = input.rasterized ?? [];
	const lost = rasterized.flatMap((side) =>
		side.layers.flatMap((l) =>
			l.spots.map((spot) => ({ side: side.side, layer: l.layer, spot })),
		),
	);
	if (lost.length > 0)
		checks.push({
			id: "spots",
			severity: "warning",
			message: `Spot colors lost in the last PDF, drawn as images: ${lost.map((l) => `${l.spot} (${l.layer ?? "a layer"})`).join(", ")}`,
			detail:
				"A shadow, blur, grain or other effect on a spot layer draws it as an image, which prints without the separation",
		});
	const lines = rasterized.flatMap((side) => {
		const line = describeRasterized(side);
		return line ? [input.showSide ? `${side.side}: ${line}` : line] : [];
	});
	if (lines.length > 0)
		checks.push({
			id: "rasterized",
			severity: "info",
			message: lines.join(" · "),
		});
	return checks;
}

export function checksSummary(checks: readonly Check[]): string {
	const issues = checks.filter((c) => c.severity !== "info").length;
	if (issues === 0) return "All clear";
	return plural(issues, "issue");
}
