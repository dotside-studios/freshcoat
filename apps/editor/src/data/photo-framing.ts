import {
	applyVariant,
	type Element,
	parseImageFocus,
	type Template,
	type Vec2,
} from "@freshcoat-js/coatfile";
import {
	type Binding,
	type DataRecord,
	type Dataset,
	variantFor,
} from "@freshcoat-js/workspace";

/** How a template crops one of a record's photos: the box's aspect, and the
 *  column the focal point is kept in. */
export type PhotoFraming = {
	aspect: number;
	focusColumn: string;
};

/** A part of a photo, as fractions of it. */
export type Crop = { x: number; y: number; width: number; height: number };

const WHOLE_TOKEN = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/;

function boundColumn(binding: Binding, value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const field = WHOLE_TOKEN.exec(value)?.[1];
	const source = field === undefined ? undefined : binding.fields[field];
	return source?.kind === "column" ? source.column : undefined;
}

function* images(elements: Element[]): Generator<Element> {
	for (const el of elements) {
		if (el.type === "image") yield el;
		if (el.type === "frame") yield* images(el.properties.children);
		if (el.type === "mask") yield* images(el.properties.children);
	}
}

/**
 * How `template`, in the variant `record` renders in, crops the photo in
 * `photoColumn`: the first `cover` image drawing it whose focus is bound to a
 * column. Undefined when none does.
 */
export function photoFraming(
	template: Template,
	binding: Binding,
	dataset: Dataset,
	record: DataRecord,
	photoColumn: string,
): PhotoFraming | undefined {
	const variantId = variantFor(template, binding, dataset, record);
	const t =
		variantId === undefined ? template : applyVariant(template, variantId);
	for (const frame of t.template_data) {
		for (const el of images(frame.elements)) {
			if (el.type !== "image" || el.properties.fit !== "cover") continue;
			if (el.properties.crop || !el.size) continue;
			if (boundColumn(binding, el.properties.src) !== photoColumn) continue;
			const focusColumn = boundColumn(binding, el.properties.focus);
			if (
				focusColumn === undefined ||
				!dataset.columns.some((c) => c.key === focusColumn)
			)
				continue;
			if (!(el.size.width > 0 && el.size.height > 0)) continue;
			return { aspect: el.size.width / el.size.height, focusColumn };
		}
	}
	return undefined;
}

/** The focal point a cell holds, or the centre. */
export function cellFocus(value: unknown): Vec2 {
	return parseImageFocus(value) ?? { x: 0.5, y: 0.5 };
}

/** What `cover` shows of a photo of `photoAspect` in a box of `boxAspect`,
 *  kept around `focus` as the engine keeps it. */
export function visibleCrop(
	photoAspect: number,
	boxAspect: number,
	focus: Vec2,
): Crop {
	const width = photoAspect > boxAspect ? boxAspect / photoAspect : 1;
	const height = photoAspect > boxAspect ? 1 : photoAspect / boxAspect;
	const at = (f: number, part: number) =>
		Math.min(Math.max(f - part / 2, 0), 1 - part);
	return { x: at(focus.x, width), y: at(focus.y, height), width, height };
}

/** The focal point that puts `crop`'s centre at its own, after moving it by
 *  `dx`, `dy` fractions of the photo, kept inside the photo. An axis the crop
 *  fills keeps `focus`'s value. */
export function movedFocus(
	crop: Crop,
	focus: Vec2,
	dx: number,
	dy: number,
): Vec2 {
	const along = (start: number, part: number, by: number, own: number) =>
		part >= 1 ? own : Math.min(Math.max(start + by, 0), 1 - part) + part / 2;
	return {
		x: along(crop.x, crop.width, dx, focus.x),
		y: along(crop.y, crop.height, dy, focus.y),
	};
}
