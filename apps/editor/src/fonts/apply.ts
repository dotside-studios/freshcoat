import type { Template, TextElement } from "@freshcoat-js/coatfile";
import { addFont, type OpResult } from "~/doc/ops";
import { getElement, walkLayers } from "~/doc/path";
import { patchLayers } from "~/panels/design/field-helpers";
import { type GoogleFontRow, googleDescriptor } from "./catalogue";

/** The families a template declares, then the ones its text uses. */
export function templateFamilies(t: Template): string[] {
	const out = new Set<string>();
	for (const f of t.fonts ?? []) out.add(f.family);
	t.template_data.forEach((_, side) => {
		for (const { element } of walkLayers(t, side)) {
			if (element.type !== "text") continue;
			out.add(element.properties.font.family);
			for (const s of element.properties.spans ?? [])
				if (s.font?.family) out.add(s.font.family);
		}
	});
	return [...out].filter(Boolean);
}

/**
 * The weights and italics a family is wanted at: the selected layers' (which
 * are about to take the family) and those of any text already set in it.
 */
export function fontUsage(
	t: Template,
	family: string,
	keys: readonly string[] = [],
): { weights: number[]; italic: boolean } {
	const weights = new Set<number>();
	let italic = false;
	const selected = new Set(keys);
	t.template_data.forEach((_, side) => {
		for (const { key, element } of walkLayers(t, side)) {
			if (element.type !== "text") continue;
			const { font, spans } = element.properties;
			const taking = selected.has(key);
			if (taking || font.family === family) {
				weights.add(font.weight ?? 400);
				if (font.style === "italic") italic = true;
			}
			for (const s of spans ?? []) {
				const spanFamily = s.font?.family ?? font.family;
				if (!(spanFamily === family || (taking && !s.font?.family))) continue;
				weights.add(s.font?.weight ?? font.weight ?? 400);
				if ((s.font?.style ?? font.style) === "italic") italic = true;
			}
		}
	});
	return { weights: [...weights].sort((a, b) => a - b), italic };
}

/**
 * Sets `keys` to `family` and, for a catalogue family the template does not
 * declare yet, adds its descriptor with the weights in use (regular and bold
 * when nothing uses it yet). One op, so one undo step.
 */
export function applyFontPick(
	t: Template,
	keys: readonly string[],
	family: string,
	row?: GoogleFontRow,
): OpResult {
	let next = t;
	if (row && !next.fonts?.some((f) => f.family === family)) {
		const { weights, italic } = fontUsage(next, family, keys);
		const added = addFont(
			next,
			googleDescriptor(row, weights.length ? weights : [400, 700], italic),
		);
		if (!added.ok) return added;
		next = added.template;
	}
	return patchLayers(
		next,
		keys,
		(el) => ({
			properties: {
				font: { ...(el as TextElement).properties.font, family },
			},
		}),
		getElement,
	);
}
