import {
	describePrintIssue,
	imageDpiHints as coatImageDpiHints,
	printHints as coatPrintHints,
	type PrintIssueCode,
	safeAreaHints as coatSafeAreaHints,
	DEFAULT_MIN_IMAGE_DPI,
	hasInsets,
	isPrintedCard,
	type Template,
	templateBleed,
	templateSafeArea,
} from "@freshcoat-js/coatfile";
import { DEFAULT_DPI, presetImageDpi } from "@freshcoat-js/workspace";
import { keyOf, walkLayers } from "~/doc/path";
import { useEditor } from "~/state/hooks";
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

export type PrintHint = {
	/** Layer key, for selecting it. */
	key: string;
	side: number;
	id: string;
	message: string;
	code: "safe_area" | "image_dpi" | PrintIssueCode;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Top-level layers too close to the trim, as hints. Only a template with a
 *  safe area gets hints. */
export function safeAreaHints(t: Template): PrintHint[] {
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
			code: "safe_area",
		};
	});
}

// ── Image resolution hints ───────────────────────────────────────────────────

/** The resolution check the active template's export presets call for. */
export function useImageDpi(): { dpi: number; min: number } {
	const dpi = useEditor((s) =>
		s.workspace
			? presetImageDpi(s.workspace.presets, s.workspace.activeTemplateId).dpi
			: DEFAULT_DPI,
	);
	const minDpi = useEditor((s) =>
		s.workspace
			? presetImageDpi(s.workspace.presets, s.workspace.activeTemplateId).min
			: DEFAULT_MIN_IMAGE_DPI,
	);
	return { dpi, min: minDpi };
}

/** Image layers whose own image prints below `min` at `dpi` design units to
 *  the inch. An image bound to a field is checked by the render instead. */
export function imageDpiHints(
	t: Template,
	check: { dpi: number; min: number },
): PrintHint[] {
	return coatImageDpiHints(t, check).flatMap(({ side, id, dpi, min }) => {
		for (const entry of walkLayers(t, side))
			if (entry.element.id === id && entry.element.type === "image")
				return [
					{
						key: entry.key,
						side,
						id,
						message: `Prints at ${dpi} DPI, under ${min}`,
						code: "image_dpi" as const,
					},
				];
		return [];
	});
}

// ── Print check hints ────────────────────────────────────────────────────────

/** Layers that may not print as they look at `dpi` design units to the inch:
 *  small text, hairline strokes, rich-black small text and art short of the
 *  bleed. Text bound to a field is checked again by the render. */
export function printCheckHints(t: Template, dpi: number): PrintHint[] {
	return coatPrintHints(t, { dpi }).map(({ side, path, id, issue }) => ({
		key: keyOf({ side, path }),
		side,
		id,
		message: describePrintIssue(issue),
		code: issue.code,
	}));
}
