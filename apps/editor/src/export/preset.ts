import type { ExportPreset } from "@freshcoat-js/workspace";
import {
	DEFAULT_DPI,
	DEFAULT_FILE_NAME_PATTERN,
	newId,
	uniqueName,
} from "@freshcoat-js/workspace";

/** A preset for a template with the spec's defaults: every record but the
 *  skipped ones, every side, a PNG zip at 1×, 300 dpi, the default file name,
 *  and marking what exports. */
export function newPreset(
	templateId: string,
	existing: readonly ExportPreset[],
	id: string = newId("p"),
): ExportPreset {
	return {
		id,
		name: uniqueName(
			"New preset",
			existing.map((p) => p.name),
			{ caseInsensitive: true },
		),
		templateId,
		records: "all",
		sides: "all",
		format: "png-zip",
		scale: 1,
		dpi: DEFAULT_DPI,
		fileName: DEFAULT_FILE_NAME_PATTERN,
		markExported: true,
	};
}

export function duplicatePreset(
	preset: ExportPreset,
	existing: readonly ExportPreset[],
	id: string = newId("p"),
): ExportPreset {
	return {
		...preset,
		id,
		name: uniqueName(
			`${preset.name} copy`,
			existing.map((p) => p.name),
			{ caseInsensitive: true },
		),
		...(preset.selected ? { selected: [...preset.selected] } : {}),
	};
}
