import {
	type Element,
	fieldTitle,
	formatImageFocus,
	type Template,
	type Vec2,
} from "@freshcoat-js/coatfile";
import {
	type Dataset,
	uniqueKey,
	withFieldSource,
} from "@freshcoat-js/workspace";
import type { EditorController } from "~/app/controller";
import { addField } from "~/doc/ops";
import { produce } from "~/state/immer";
import { addColumn, replaceDataset, setCell } from "./model";
import type { PhotoFraming } from "./photo-framing";

function setFocus(elements: Element[], id: string, focus: string): boolean {
	for (const el of elements) {
		if (el.id === id && el.type === "image") {
			el.properties.focus = focus;
			return true;
		}
		if (
			(el.type === "frame" || el.type === "mask") &&
			setFocus(el.properties.children, id, focus)
		)
			return true;
	}
	return false;
}

/** `t` with a focus field, defaulting to `fallback`, that the image `id`
 *  is cropped around. Undefined when the base has no such image. */
export function withFocusField(
	t: Template,
	id: string,
	field: string,
	fallback: Vec2,
): Template | undefined {
	const added = addField(t, field, {
		type: "string",
		title: fieldTitle(field),
		description: "The point kept in view when the photo is cropped",
		default:
			fallback.x === 0.5 && fallback.y === 0.5
				? ""
				: formatImageFocus(fallback),
	});
	if (!added.ok) return undefined;
	let found = false;
	const next = produce(added.template, (d) => {
		for (const side of d.template_data) {
			if (setFocus(side.elements, id, `{{${field}}}`)) found = true;
		}
	});
	return found ? next : undefined;
}

/**
 * Keeps the open template's focus for the photo in `photoColumn` in a
 * column, made the first time a record's photo is moved in its box: the
 * image's focus gets a field if it has none, the dataset a text column, and
 * the binding reads one from the other. The record gets `focus`. False when
 * the template is not the open one or its base lacks the image.
 */
export function keepFocusInColumn(
	controller: EditorController,
	dataset: Dataset,
	recordId: string,
	photoColumn: string,
	framing: PhotoFraming,
	focus: string,
): boolean {
	const ws = controller.state.workspace;
	const slot = ws?.templates.find((t) => t.id === ws.activeTemplateId);
	const base = controller.base;
	if (!ws || !slot?.binding || !base) return false;
	if (slot.binding.datasetId !== dataset.id) return false;

	let field = framing.image.focusField;
	if (field === undefined) {
		field = uniqueKey(
			`${framing.image.srcField}_focus`,
			Object.keys(base.fields.properties),
		);
		const next = withFocusField(
			base,
			framing.image.id,
			field,
			framing.fallback,
		);
		if (!next) return false;
		controller.edit(() => next, { scope: "base" });
	}

	const after = controller.state.workspace ?? ws;
	const binding =
		after.templates.find((t) => t.id === slot.id)?.binding ?? slot.binding;
	const current = after.datasets.find((d) => d.id === dataset.id) ?? dataset;
	const existing = current.columns.find(
		(c) => c.key === `${photoColumn}_focus` && c.type === "text",
	);
	const column =
		existing?.key ??
		uniqueKey(
			`${photoColumn}_focus`,
			current.columns.map((c) => c.key),
		);
	const withColumn = existing
		? current
		: addColumn(
				current,
				{ key: column, type: "text", title: fieldTitle(column) },
				current.columns.findIndex((c) => c.key === photoColumn) + 1,
			);
	controller.dispatch({
		type: "datasetEdit",
		datasets: replaceDataset(
			after.datasets,
			setCell(withColumn, recordId, column, focus),
		),
		bindings: {
			[slot.id]: withFieldSource(binding, field, {
				kind: "column",
				column,
			}),
		},
	});
	return true;
}
