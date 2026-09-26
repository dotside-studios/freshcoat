import type { Element, Template } from "@freshcoat/coatfile";
import { useSyncExternalStore } from "react";
import { worldCorners } from "~/doc/geometry";
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
	t: Pick<Template, "product"> | null,
): boolean {
	if (!t) return false;
	const chosen = templateId === undefined ? undefined : choices.get(templateId);
	return chosen ?? isPrintedCard(t);
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

type Box = { left: number; top: number; right: number; bottom: number };

function boxOf(el: Element): Box | null {
	if (!el.size) return null;
	const pts = worldCorners({
		x: el.pos?.x ?? 0,
		y: el.pos?.y ?? 0,
		width: el.size.width,
		height: el.size.height,
		rotation: el.rotation ?? 0,
	});
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);
	return {
		left: Math.min(...xs),
		top: Math.min(...ys),
		right: Math.max(...xs),
		bottom: Math.max(...ys),
	};
}

const EDGE_NAMES = ["left", "top", "right", "bottom"] as const;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Top-level layers with an edge between the trim and the safe line: close
 * enough to the cut that it may take part of them. A layer that runs to the
 * trim or past it is bleed, drawn to be cut, and is left alone. Only a
 * template the guides describe gets hints.
 */
export function safeAreaHints(t: Template): SafeAreaHint[] {
	if (!isPrintedCard(t)) return [];
	const { safe } = printGuideMetrics(t);
	const eps = 0.5;
	const inBand = (d: number) => d > eps && d < safe - eps;
	const out: SafeAreaHint[] = [];
	t.template_data.forEach((frame, side) => {
		frame.elements.forEach((el, index) => {
			const b = boxOf(el);
			if (!b) return;
			const gaps = [b.left, b.top, t.width - b.right, t.height - b.bottom];
			const edges = EDGE_NAMES.filter((_, i) => inBand(gaps[i] as number));
			if (edges.length === 0) return;
			out.push({
				key: keyOf({ side, path: [index] }),
				side,
				id: el.id,
				message: `${capitalize(edges.join(" and "))} edge${edges.length > 1 ? "s cross" : " crosses"} the safe area, ${Math.round(safe)} units in from the trim`,
			});
		});
	});
	return out;
}
