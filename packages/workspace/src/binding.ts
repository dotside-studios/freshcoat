import type { Template, Variant } from "@freshcoat/coatfile";
import { assetRef } from "./assets";
import { isEmptyValue, toTemplateValue } from "./columns";
import type { Binding, DataRecord, Dataset, FieldSource } from "./types";

/** Each template field bound to the column with the same key, exactly or
 *  ignoring case. Fields with no such column are left to their default. */
export function autoBinding(template: Template, dataset: Dataset): Binding {
	const fields: Record<string, FieldSource> = {};
	for (const key of Object.keys(template.fields.properties)) {
		const column =
			dataset.columns.find((c) => c.key === key) ??
			dataset.columns.find((c) => c.key.toLowerCase() === key.toLowerCase());
		if (column) fields[key] = { kind: "column", column: column.key };
	}
	return { datasetId: dataset.id, fields };
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
			const column = dataset?.columns.find((c) => c.key === source.column);
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
): string | undefined {
	const variants = template.variants ?? [];
	const source = binding?.variant;
	if (source === undefined || source.kind === "all") return undefined;
	if (source.kind === "fixed") {
		return variants.some((v) => v.id === source.id) ? source.id : undefined;
	}
	const column = dataset?.columns.find((c) => c.key === source.column);
	const cell = record?.values[source.column] ?? null;
	if (column === undefined || isEmptyValue(cell)) return undefined;
	const wanted = toTemplateValue(column, cell).trim().toLowerCase();
	return (
		variants.find((v) => v.id.toLowerCase() === wanted) ??
		variants.find((v) => v.label.trim().toLowerCase() === wanted)
	)?.id;
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
): (string | undefined)[] {
	if (binding?.variant?.kind !== "all") {
		return [variantFor(template, binding, dataset, record)];
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
