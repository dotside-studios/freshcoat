import {
	safeAreaHints as coatSafeAreaHints,
	hasInsets,
	isPrintedCard,
	type Template,
	templateBleed,
	templateSafeArea,
} from "@freshcoat-js/coatfile";
import { keyOf } from "~/doc/path";
import { createExternalStore } from "~/state/external-store";
import { type EditorState, present } from "~/state/store";

export {
	type PrintGuideMetrics,
	type PrintGuideSet,
	printGuideMetrics,
	printGuidesFor,
} from "@freshcoat-js/coatfile";

type GuideSource = Pick<
	Template,
	"width" | "height" | "product" | "bleed" | "safeArea"
>;

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
const version = createExternalStore(0);

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
	version.set((v) => v + 1);
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
	return version.useStore();
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
	return coatSafeAreaHints(t).map(({ side, index, id, edges, safe }) => {
		const even =
			safe.left === safe.top &&
			safe.right === safe.top &&
			safe.bottom === safe.top;
		const where = even
			? `, ${Math.round(safe.top)} units in from the trim`
			: "";
		return {
			key: keyOf({ side, path: [index] }),
			side,
			id,
			message: `${capitalize(edges.join(" and "))} edge${edges.length > 1 ? "s cross" : " crosses"} the safe area${where}`,
		};
	});
}
