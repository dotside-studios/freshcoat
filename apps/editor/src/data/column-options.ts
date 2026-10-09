import type { Template } from "@freshcoat-js/coatfile";
import {
	type Binding,
	type CellValue,
	type Column,
	type ColumnOptions,
	DEFAULT_VARIANT,
	matchVariant,
	type VariantFallback,
} from "@freshcoat-js/workspace";
import { useMemo, useRef } from "react";
import { VARIANT_EXPORT } from "~/app/copy";
import { useEditor } from "~/state/hooks";

export type Choice = { value: string; label: string };

/** What a column's cells pick from, and what an empty one means. */
export type ColumnChoices = { options: Choice[]; empty: string };

export type TemplateSlot = {
	id: string;
	fileName: string;
	template: Template;
	binding?: Binding;
};

function fallbackLabel(template: Template, fallback: VariantFallback): string {
	if (fallback.kind === "image") return VARIANT_EXPORT.kinds.image;
	return (
		template.variants?.find((v) => v.id === fallback.id)?.label ??
		VARIANT_EXPORT.default
	);
}

function variantChoices(
	slot: TemplateSlot,
	datasetId: string,
	column: string,
): ColumnChoices {
	const options = (slot.template.variants ?? []).map((v) => ({
		value: v.id,
		label: v.label,
	}));
	const source = slot.binding?.variant;
	const fallback =
		slot.binding?.datasetId === datasetId &&
		source?.kind === "column" &&
		source.column === column
			? source.fallback
			: undefined;
	if (!fallback) return { options, empty: VARIANT_EXPORT.default };
	return {
		options: [
			{ value: DEFAULT_VARIANT, label: VARIANT_EXPORT.default },
			...options,
		],
		empty: `Auto: ${fallbackLabel(slot.template, fallback)}`,
	};
}

/** The values `options` offers, or undefined when what it names is gone. */
export function choicesFor(
	options: ColumnOptions,
	slots: readonly TemplateSlot[],
	datasetId: string,
	column: string,
): ColumnChoices | undefined {
	switch (options.kind) {
		case "variants": {
			const slot = slots.find((s) => s.id === options.templateId);
			return slot ? variantChoices(slot, datasetId, column) : undefined;
		}
	}
}

/** The choice a cell holds, matched by value, then label, ignoring case. */
export function choiceOf(
	choices: ColumnChoices,
	value: CellValue | undefined,
): Choice | undefined {
	if (value === null || value === undefined || value === "") return undefined;
	return matchVariant(choices.options, String(value), (o) => o.value);
}

export function columnChoices(
	columns: readonly Column[],
	slots: readonly TemplateSlot[],
	datasetId: string,
): Map<string, ColumnChoices> {
	const out = new Map<string, ColumnChoices>();
	for (const column of columns) {
		if (!column.options) continue;
		const choices = choicesFor(column.options, slots, datasetId, column.key);
		if (choices) out.set(column.key, choices);
	}
	return out;
}

/** The workspace's templates as edited. */
export function useTemplateSlots(): TemplateSlot[] {
	const ws = useEditor((s) => s.workspace);
	const live = useEditor((s) => s.doc?.history.present);
	return useMemo(
		() =>
			(ws?.templates ?? []).map((t) => ({
				id: t.id,
				fileName: t.fileName,
				...(t.binding ? { binding: t.binding } : {}),
				template:
					t.id === ws?.activeTemplateId && live
						? live
						: (t.parked?.doc.history.present ?? t.template),
			})),
		[ws, live],
	);
}

/** The choices of each of the dataset's columns that has options, the same
 *  Map until they change, so an edit to the open template does not redraw
 *  the grid. */
export function useColumnChoices(
	columns: readonly Column[],
	datasetId: string,
): ReadonlyMap<string, ColumnChoices> {
	const slots = useTemplateSlots();
	const next = useMemo(
		() => columnChoices(columns, slots, datasetId),
		[columns, slots, datasetId],
	);
	const key = JSON.stringify([...next]);
	const kept = useRef({ key, map: next });
	if (kept.current.key !== key) kept.current = { key, map: next };
	return kept.current.map;
}
