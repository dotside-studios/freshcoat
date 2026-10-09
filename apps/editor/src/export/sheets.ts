import type {
	ExportPreset,
	PaperName,
	SheetLayout,
} from "@freshcoat-js/workspace";
import { DEFAULT_SHEET_LAYOUT } from "@freshcoat-js/workspace";

export type PaperChoice = PaperName | "custom";

export const PAPER_LABEL: Record<PaperChoice, string> = {
	a4: "A4",
	letter: "Letter",
	legal: "Legal",
	a3: "A3",
	tabloid: "Tabloid",
	custom: "Custom",
};

export const PAPER_CHOICES: PaperChoice[] = [
	"a4",
	"letter",
	"legal",
	"a3",
	"tabloid",
	"custom",
];

export function paperChoice(layout: SheetLayout): PaperChoice {
	return typeof layout.paper === "string" ? layout.paper : "custom";
}

/** The layout a preset switches to for Sheets: its last one, else the
 *  defaults. */
export function sheetsFor(preset: ExportPreset): SheetLayout {
	return preset.layout?.kind === "sheet" ? preset.layout : DEFAULT_SHEET_LAYOUT;
}
