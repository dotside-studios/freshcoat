import {
	formatLength,
	isLengthUnit,
	type LengthUnit,
	resolveUnitSuffixes,
} from "@freshcoat-js/coatfile";
import { evaluateExpression } from "@freshcoat-js/ui/number-field";
import { DEFAULT_DPI } from "@freshcoat-js/workspace";
import { createExternalStore } from "~/state/external-store";
import { useEditor } from "~/state/hooks";
import type { EditorState } from "~/state/store";

export const UNITS_STORAGE_KEY = "freshcoat.units";

export const UNIT_LABELS: Record<LengthUnit, string> = {
	px: "Pixels",
	mm: "Millimeters",
	in: "Inches",
	pt: "Points",
};

/** An arrow-key step in each unit; Shift takes ten. */
export const UNIT_STEP: Record<LengthUnit, number> = {
	px: 1,
	mm: 1,
	in: 1 / 16,
	pt: 1,
};

/** What a dragged guide snaps to in each unit. */
export const UNIT_SNAP: Record<LengthUnit, number> = {
	px: 1,
	mm: 0.1,
	in: 1 / 32,
	pt: 0.5,
};

const unitStore = createExternalStore<LengthUnit>(() => {
	try {
		const saved = localStorage.getItem(UNITS_STORAGE_KEY);
		return isLengthUnit(saved) ? saved : "px";
	} catch {
		return "px";
	}
});

export function getDisplayUnit(): LengthUnit {
	return unitStore.get();
}

export function setDisplayUnit(next: LengthUnit) {
	try {
		if (next === "px") localStorage.removeItem(UNITS_STORAGE_KEY);
		else localStorage.setItem(UNITS_STORAGE_KEY, next);
	} catch {
		// Private windows can refuse storage; the choice still holds for the tab.
	}
	unitStore.set(next);
}

export function useDisplayUnit(): LengthUnit {
	return unitStore.useStore();
}

/** The DPI the active template prints at: its active export preset's, else
 *  its first preset's, else the default. */
export function documentDpi(s: EditorState): number {
	const ws = s.workspace;
	if (!ws) return DEFAULT_DPI;
	const own = ws.presets.filter((p) => p.templateId === ws.activeTemplateId);
	const preset = own.find((p) => p.id === ws.activePresetId) ?? own[0];
	return preset && preset.dpi > 0 ? preset.dpi : DEFAULT_DPI;
}

export function useLengthUnit(): { unit: LengthUnit; dpi: number } {
	return { unit: useDisplayUnit(), dpi: useEditor(documentDpi) };
}

/** Reads typed text as a length in `unit`, with suffixes such as `3mm` or
 *  `12pt` converted. Returns the value in `unit`, unrounded. */
export function parseLengthInput(
	text: string,
	current: number | null,
	unit: LengthUnit,
	dpi: number,
): number | null {
	let t = resolveUnitSuffixes(text.trim(), unit, dpi);
	if (/^[*/]/.test(t) && current !== null) t = `${current}${t}`;
	return evaluateExpression(t);
}

/** A width and height as `1012 × 638` in px, or `85.68 × 54.02 mm`. */
export function formatSize(
	width: number,
	height: number,
	unit: LengthUnit,
	dpi: number,
): string {
	if (unit === "px")
		return `${Math.round(width * 10) / 10} × ${Math.round(height * 10) / 10}`;
	const f = (v: number) => formatLength(v, unit, dpi, { suffix: false });
	return `${f(width)} × ${f(height)} ${unit}`;
}
