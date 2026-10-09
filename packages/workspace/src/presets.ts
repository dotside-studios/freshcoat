import { newId, uniqueName } from "./ids";
import { DEFAULT_DPI, DEFAULT_FILE_NAME_PATTERN } from "./plan";
import type { ExportPreset } from "./types";

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
		name: presetName("New preset", existing),
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

/** A copy of `preset` under a fresh id and a `<name> copy` name. */
export function duplicatePreset(
	preset: ExportPreset,
	existing: readonly ExportPreset[],
	id: string = newId("p"),
): ExportPreset {
	return {
		...preset,
		id,
		name: presetName(`${preset.name} copy`, existing),
		...(preset.selected ? { selected: [...preset.selected] } : {}),
	};
}

function presetName(name: string, existing: readonly ExportPreset[]): string {
	return uniqueName(
		name,
		existing.map((p) => p.name),
		{ caseInsensitive: true },
	);
}
