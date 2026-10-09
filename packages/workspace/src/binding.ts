import {
	type Template,
	type Variant,
	variantSize,
} from "@freshcoat-js/coatfile";
import { assetRef } from "./assets";
import { isEmptyValue, toTemplateValue } from "./columns";
import { orientedSize } from "./image-info";
import { normalizeName } from "./mapping";
import type {
	Binding,
	Column,
	DataRecord,
	Dataset,
	FieldSource,
} from "./types";

/** A dataset's columns by key, the first of any that share one. */
export function columnsByKey(dataset: Dataset): Map<string, Column> {
	const columns = new Map<string, Column>();
	for (const column of dataset.columns) {
		if (!columns.has(column.key)) columns.set(column.key, column);
	}
	return columns;
}

function columnOf(
	dataset: Dataset | undefined,
	key: string,
	columns: ReadonlyMap<string, Column> | undefined,
): Column | undefined {
	if (dataset === undefined) return undefined;
	return columns !== undefined
		? columns.get(key)
		: dataset.columns.find((c) => c.key === key);
}

/** Each template field bound to the column with the same key, exactly or
 *  ignoring case, then to a column whose key or title matches the field's
 *  key or title ignoring case and punctuation. Fields with no such column are
 *  left to their default. When the template's variants differ in shape, the
 *  variant follows the first bound photo field. */
export function autoBinding(template: Template, dataset: Dataset): Binding {
	const fields: Record<string, FieldSource> = {};
	const entries = Object.entries(template.fields.properties);
	for (const [key] of entries) {
		const column =
			dataset.columns.find((c) => c.key === key) ??
			dataset.columns.find((c) => c.key.toLowerCase() === key.toLowerCase());
		if (column) fields[key] = { kind: "column", column: column.key };
	}
	const claimed = new Set(
		Object.values(fields).map((s) => (s.kind === "column" ? s.column : "")),
	);
	for (const [key, field] of entries) {
		if (fields[key] !== undefined) continue;
		const wanted = new Set(
			[key, field.title ?? ""].map(normalizeName).filter((n) => n !== ""),
		);
		const column = dataset.columns.find(
			(c) =>
				!claimed.has(c.key) &&
				[c.key, c.title ?? ""].some((n) => wanted.has(normalizeName(n))),
		);
		if (column) {
			claimed.add(column.key);
			fields[key] = { kind: "column", column: column.key };
		}
	}
	const photo = Object.entries(template.fields.properties).find(
		([key, field]) => field.format === "image" && fields[key] !== undefined,
	)?.[0];
	return {
		datasetId: dataset.id,
		fields,
		...(photo !== undefined && hasShapedVariants(template)
			? { variant: { kind: "image" as const, field: photo } }
			: {}),
	};
}

/** Whether a variant's size differs in aspect from the template's. */
export function hasShapedVariants(template: Template): boolean {
	const aspect = template.width / template.height;
	return (template.variants ?? []).some(
		(v) =>
			v.size !== undefined &&
			Math.abs(v.size.width / v.size.height - aspect) > 1e-6,
	);
}

export function serialValue(
	source: Extract<FieldSource, { kind: "serial" }>,
	index: number,
): string {
	const n = source.start + index * source.step;
	const digits = String(Math.abs(n)).padStart(source.pad, "0");
	return `${source.prefix ?? ""}${n < 0 ? "-" : ""}${digits}${source.suffix ?? ""}`;
}

/**
 * The value of every template field for one record. `index` is the record's
 * position in the export plan, which is what a serial counts from. Without a
 * binding, a dataset or a record, each field has its default.
 */
export function resolveValues(
	template: Template,
	binding: Binding | undefined,
	dataset: Dataset | undefined,
	record: DataRecord | undefined,
	index: number,
	columns?: ReadonlyMap<string, Column>,
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const [key, field] of Object.entries(template.fields.properties)) {
		const fallback = field.default ?? "";
		const source = binding?.fields[key];
		if (source === undefined) values[key] = fallback;
		else if (source.kind === "constant") values[key] = source.value;
		else if (source.kind === "serial") {
			values[key] = serialValue(source, index);
		} else {
			const column = columnOf(dataset, source.column, columns);
			const cell = record?.values[source.column] ?? null;
			values[key] =
				column === undefined || isEmptyValue(cell)
					? fallback
					: toTemplateValue(column, cell);
		}
	}
	return values;
}

/**
 * The variant a record renders in, or undefined for the default. Under `all`
 * a record has no single variant, so this is Default, the first of the ones
 * `variantsFor` lists: what a preview of the record shows.
 */
export function variantFor(
	template: Template,
	binding: Binding | undefined,
	dataset: Dataset | undefined,
	record: DataRecord | undefined,
	columns?: ReadonlyMap<string, Column>,
): string | undefined {
	const variants = template.variants ?? [];
	const source = binding?.variant;
	if (source === undefined || source.kind === "all") return undefined;
	if (source.kind === "fixed") {
		return variants.some((v) => v.id === source.id) ? source.id : undefined;
	}
	if (source.kind === "image") {
		const values = resolveValues(
			template,
			binding,
			dataset,
			record,
			0,
			columns,
		);
		const ref = values[source.field] ?? "";
		const asset = dataset?.assets.find((a) => assetRef(a.sha256) === ref);
		if (!asset?.width || !asset.height) return undefined;
		const seen = orientedSize({
			width: asset.width,
			height: asset.height,
			orientation: asset.orientation,
		});
		return closestVariant(template, seen.width / seen.height);
	}
	const column = columnOf(dataset, source.column, columns);
	const cell = record?.values[source.column] ?? null;
	if (column === undefined || isEmptyValue(cell)) return undefined;
	const wanted = toTemplateValue(column, cell).trim().toLowerCase();
	return (
		variants.find((v) => v.id.toLowerCase() === wanted) ??
		variants.find((v) => v.label.trim().toLowerCase() === wanted)
	)?.id;
}

/** The variant, or undefined for Default, whose size is closest to
 *  `aspect`. Default wins a tie, then the first in list order. */
export function closestVariant(
	template: Template,
	aspect: number,
): string | undefined {
	const distance = (id?: string) => {
		const size = variantSize(template, id);
		return Math.abs(Math.log(size.width / size.height / aspect));
	};
	let best: string | undefined;
	let bestDistance = distance(undefined);
	for (const v of template.variants ?? []) {
		const d = distance(v.id);
		if (d < bestDistance - 1e-9) {
			best = v.id;
			bestDistance = d;
		}
	}
	return best;
}

/**
 * Every variant a record renders in, in export order; undefined is Default.
 * Under `all` that is Default, then each variant in list order that changes
 * something. Any other source gives the one `variantFor` gives.
 */
export function variantsFor(
	template: Template,
	binding: Binding | undefined,
	dataset: Dataset | undefined,
	record: DataRecord | undefined,
	columns?: ReadonlyMap<string, Column>,
): (string | undefined)[] {
	if (binding?.variant?.kind !== "all") {
		return [variantFor(template, binding, dataset, record, columns)];
	}
	const changed = (template.variants ?? []).filter((v) => !isEmptyVariant(v));
	return [undefined, ...changed.map((v) => v.id)];
}

/** Whether a variant renders exactly as Default: no override replaces a
 *  background, and no element delta carries anything beyond its id and an
 *  empty `properties`. */
export function isEmptyVariant(variant: Variant): boolean {
	return variant.overrides.every(
		(override) =>
			override.background === undefined &&
			(override.elements ?? []).every((delta) =>
				Object.entries(delta).every(
					([key, value]) =>
						key === "id" ||
						value === undefined ||
						(key === "properties" &&
							Object.values(value as Record<string, unknown>).every(
								(v) => v === undefined,
							)),
				),
			),
	);
}

/** `ws:<sha>` to the Blob of every dataset photo. A renderer reads the bytes
 *  of the ones a record uses, when it uses them. */
export function imagesFor(dataset: Dataset): Map<string, Blob> {
	return new Map(dataset.assets.map((a) => [assetRef(a.sha256), a.blob]));
}
