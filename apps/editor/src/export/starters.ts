import {
	DEFAULT_SHEET_LAYOUT,
	type ExportPreset,
	newPreset,
} from "@freshcoat-js/workspace";

export type PresetStarter = {
	id: string;
	group: "print" | "digital";
	name: string;
	patch: Partial<ExportPreset>;
};

const SHEETS = { ...DEFAULT_SHEET_LAYOUT, cropMarks: true };

export const PRESET_STARTERS: PresetStarter[] = [
	{
		id: "press-pdf",
		group: "print",
		name: "Press PDF",
		patch: {
			format: "pdf",
			pdfPageImage: "vector",
			bleed: true,
			layout: SHEETS,
		},
	},
	{
		id: "proof-pdf",
		group: "print",
		name: "Proof PDF",
		patch: {
			format: "pdf",
			pdfPageImage: "png",
			dpi: 150,
			layout: { kind: "single" },
		},
	},
	{
		id: "sheets",
		group: "print",
		name: "Sheets",
		patch: { format: "pdf", pdfPageImage: "png", layout: SHEETS },
	},
	{
		id: "png-web",
		group: "digital",
		name: "PNG for web",
		patch: { format: "png-zip", scale: 2 },
	},
];

function uniqueName(base: string, existing: readonly ExportPreset[]): string {
	const taken = new Set(existing.map((p) => p.name));
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}

export function presetFromStarter(
	starter: PresetStarter | undefined,
	templateId: string,
	existing: readonly ExportPreset[],
): ExportPreset {
	const blank = newPreset(templateId, existing);
	if (!starter) return blank;
	return {
		...blank,
		...starter.patch,
		name: uniqueName(starter.name, existing),
	};
}
