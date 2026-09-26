import type { Template } from "@freshcoat/coatfile";
import type { Binding, ExportPreset } from "@freshcoat/workspace";
import { exportSize } from "@freshcoat/workspace";

/** What the Export preview shows: the rendered output, the photo it was made
 *  from, both either side of a divider, or a whole sheet of paper. */
export type PreviewMode = "output" | "source" | "split" | "sheet";

export const PREVIEW_MODE_LABEL: Record<PreviewMode, string> = {
	output: "Output",
	source: "Source",
	split: "Split",
	sheet: "Sheet",
};

/**
 * The template field whose photo Source and Split show: the one a
 * size-from-image preset follows, else the first image field bound to a
 * column. Null when no image field reads from the data.
 */
export function sourceField(
	template: Pick<Template, "fields"> | undefined,
	binding: Pick<Binding, "fields"> | undefined,
	preset?: ExportPreset,
): string | null {
	if (!template || !binding) return null;
	const bound = Object.entries(template.fields.properties ?? {})
		.filter(
			([key, field]) =>
				field.format === "image" && binding.fields[key]?.kind === "column",
		)
		.map(([key]) => key);
	const size = preset ? exportSize(preset) : null;
	if (size?.kind === "image" && bound.includes(size.field)) return size.field;
	return bound[0] ?? null;
}

/** The modes a preview offers: Output, Source and Split when an image field
 *  is bound, and Sheet when the preset lays cards out on sheets. */
export function previewModes(
	field: string | null,
	sheets = false,
): PreviewMode[] {
	const modes: PreviewMode[] = field
		? ["output", "source", "split"]
		: ["output"];
	if (sheets) modes.push("sheet");
	return modes;
}

/** The mode to show: the chosen one when it is offered, Output otherwise. */
export function effectiveMode(
	chosen: PreviewMode,
	offered: readonly PreviewMode[],
): PreviewMode {
	return offered.includes(chosen) ? chosen : "output";
}

/** A divider position, as a fraction of the width from the left. */
export function clampSplit(value: number): number {
	if (!Number.isFinite(value)) return 0.5;
	return Math.max(0, Math.min(1, value));
}

/** The divider position under a pointer at `clientX` over `rect`. */
export function splitAt(
	clientX: number,
	rect: { left: number; width: number },
): number {
	return rect.width > 0 ? clampSplit((clientX - rect.left) / rect.width) : 0.5;
}

/** Where a key moves the divider: 1% a press, 10% with Shift. Null for a
 *  key the divider does not use. */
export function stepSplit(
	value: number,
	key: string,
	shift = false,
): number | null {
	const by = shift ? 0.1 : 0.01;
	switch (key) {
		case "ArrowLeft":
		case "ArrowDown":
			return clampSplit(value - by);
		case "ArrowRight":
		case "ArrowUp":
			return clampSplit(value + by);
		case "Home":
			return 0;
		case "End":
			return 1;
		default:
			return null;
	}
}
