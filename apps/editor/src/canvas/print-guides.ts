import {
	hasInsets,
	type Sides,
	safeAreaIssues,
	type Template,
	templateBleed,
	templateSafeArea,
} from "@freshcoat-js/coatfile";
import { useSyncExternalStore } from "react";
import { keyOf } from "~/doc/path";
import { type EditorState, present } from "~/state/store";

// A CR80 card is 85.60 x 53.98 mm with corners cut to a 3.18 mm radius, and
// the printer keeps 3 mm inside the trim clear of anything that must survive
// the cut. The guides are sized from the template's own long side, so a
// portrait card or a 1013-wide design gets the same physical insets.
export const CR80_LONG_MM = 85.6;
export const CR80_CORNER_MM = 3.18;
export const CR80_SAFE_MM = 3;

export type PrintGuideMetrics = {
	/** Trim corner radius, in template units. */
	corner: number;
	/** Safe-area inset from every edge, in template units. */
	safe: number;
};

export function printGuideMetrics(
	t: Pick<Template, "width" | "height">,
): PrintGuideMetrics {
	const perMm = Math.max(t.width, t.height) / CR80_LONG_MM;
	return { corner: CR80_CORNER_MM * perMm, safe: CR80_SAFE_MM * perMm };
}

/** Whether a template is one the print guides describe. */
export function isPrintedCard(t: Pick<Template, "product">): boolean {
	return t.product === "card_cr80";
}

type GuideSource = Pick<
	Template,
	"width" | "height" | "product" | "bleed" | "safeArea"
>;

export type PrintGuideSet = {
	/** Trim corner radius, in template units; 0 for square corners. */
	corner: number;
	/** Safe-area inset from each edge, in template units. */
	safe: Sides | null;
	/** Bleed past each edge, in template units. */
	bleed: Sides;
};

/** The guides a template shows: its own safe area and bleed, and for a CR80
 *  card the trim corners and, unless it sets its own, the printer's safe
 *  area. */
export function printGuidesFor(t: GuideSource): PrintGuideSet {
	const cr80 = isPrintedCard(t) ? printGuideMetrics(t) : null;
	const own = templateSafeArea(t);
	const safe = hasInsets(own)
		? own
		: cr80
			? { top: cr80.safe, right: cr80.safe, bottom: cr80.safe, left: cr80.safe }
			: null;
	return { corner: cr80?.corner ?? 0, safe, bleed: templateBleed(t) };
}

/** Whether a template has any guides to show. */
export function hasPrintGuides(t: GuideSource): boolean {
	return (
		isPrintedCard(t) ||
		hasInsets(templateBleed(t)) ||
		hasInsets(templateSafeArea(t))
	);
}

// ── The toggle ───────────────────────────────────────────────────────────────

// Each template in a workspace keeps its own choice for the session; one never
// touched follows its product.
const choices = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

export function printGuidesOn(
	templateId: string | undefined,
	t: GuideSource | null,
): boolean {
	if (!t) return false;
	const chosen = templateId === undefined ? undefined : choices.get(templateId);
	return chosen ?? hasPrintGuides(t);
}

export function setPrintGuides(templateId: string, on: boolean): void {
	choices.set(templateId, on);
	version++;
	for (const fn of listeners) fn();
}

/** View > Print guides: flips the active template's guides. */
export function togglePrintGuides(s: EditorState): void {
	const id = s.workspace?.activeTemplateId;
	const t = present(s);
	if (!id || !t) return;
	setPrintGuides(id, !printGuidesOn(id, t));
}

/** Re-renders when any template's choice changes. */
export function usePrintGuidesVersion(): number {
	return useSyncExternalStore(
		subscribe,
		() => version,
		() => version,
	);
}

// ── Safe-area hints ──────────────────────────────────────────────────────────

export type SafeAreaHint = {
	/** Layer key, for selecting it. */
	key: string;
	side: number;
	id: string;
	message: string;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Top-level layers too close to the trim, as hints. Only a template with a
 *  safe area gets hints. */
export function safeAreaHints(t: Template): SafeAreaHint[] {
	const { safe } = printGuidesFor(t);
	if (!safe) return [];
	const even =
		safe.left === safe.top &&
		safe.right === safe.top &&
		safe.bottom === safe.top;
	const where = even ? `, ${Math.round(safe.top)} units in from the trim` : "";
	return safeAreaIssues(t, { safe }).map(({ side, index, id, edges }) => ({
		key: keyOf({ side, path: [index] }),
		side,
		id,
		message: `${capitalize(edges.join(" and "))} edge${edges.length > 1 ? "s cross" : " crosses"} the safe area${where}`,
	}));
}
