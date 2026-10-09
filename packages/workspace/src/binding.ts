import {
	closestVariant,
	DEFAULT_VARIANT_ID,
	hasShapedVariants,
	isEmptyVariant,
	type Template,
} from "@freshcoat-js/coatfile";
import { orientedSize } from "@freshcoat-js/engine/image";
import { assetRef } from "./assets";
import { isEmptyValue, toTemplateValue } from "./columns";
import { normalizeName } from "./mapping";
import type {
	Binding,
	Column,
	DataRecord,
	Dataset,
	FieldSource,
	VariantSource,
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

/** The column whose key is `key`, exactly or else ignoring case. */
export function columnForKey(
	columns: readonly Column[],
	key: string,
): Column | undefined {
	return (
		columns.find((c) => c.key === key) ??
		columns.find((c) => c.key.toLowerCase() === key.toLowerCase())
	);
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
		const column = columnForKey(dataset.columns, key);
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

/** The option whose id, then label, is `text`, ignoring case and
 *  surrounding space. */
export function matchVariant<T extends { label: string }>(
	options: readonly T[],
	text: string,
	idOf: (option: T) => string,
): T | undefined {
	const wanted = text.trim().toLowerCase();
	return (
		options.find((o) => idOf(o).toLowerCase() === wanted) ??
		options.find((o) => o.label.trim().toLowerCase() === wanted)
	);
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
	const wanted =
		column === undefined || isEmptyValue(cell)
			? ""
			: toTemplateValue(column, cell).trim().toLowerCase();
	const picked = wanted
		? matchVariant(variants, wanted, (v) => v.id)?.id
		: undefined;
	if (picked !== undefined || wanted === DEFAULT_VARIANT) return picked;
	if (!binding || source.fallback === undefined) return undefined;
	return variantFor(
		template,
		{ ...binding, variant: source.fallback },
		dataset,
		record,
		columns,
	);
}

/** What a variant column holds to pick Default. */
export const DEFAULT_VARIANT = DEFAULT_VARIANT_ID;

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

/** `ws:<sha>` to the Blob of every dataset photo. A renderer reads the bytes
 *  of the ones a record uses, when it uses them. */
export function imagesFor(dataset: Dataset): Map<string, Blob> {
	return new Map(dataset.assets.map((a) => [assetRef(a.sha256), a.blob]));
}

export type SourceKind = FieldSource["kind"] | "default";

export type VariantKind = "none" | VariantSource["kind"];

export type TemplateField = {
	key: string;
	title: string;
	required: boolean;
	defaultValue: string;
};

export function templateFields(template: Template): TemplateField[] {
	const required = new Set(template.fields.required ?? []);
	return Object.entries(template.fields.properties).map(([key, field]) => ({
		key,
		title: field.title ?? key,
		required: required.has(key),
		defaultValue: field.default ?? "",
	}));
}

/** The template's photo fields: those with `format: "image"`. */
export function imageFields(template: Template): TemplateField[] {
	return templateFields(template).filter(
		(f) => template.fields.properties[f.key]?.format === "image",
	);
}

/** The binding a dataset choice gives: fields matched by key, or none. */
export function bindingForDataset(
	template: Template,
	dataset: Dataset | undefined,
): Binding | undefined {
	return dataset ? autoBinding(template, dataset) : undefined;
}

/** The binding a dataset choice gives, keeping the variant choice when the
 *  new binding can honour it: a column source names a column of the dataset
 *  it came from. */
export function rebindDataset(
	template: Template,
	dataset: Dataset | undefined,
	previous: Binding | undefined,
): Binding | undefined {
	const variant = previous?.variant;
	const keep = variant?.kind === "column" ? variant.fallback : variant;
	const next = bindingForDataset(template, dataset);
	if (next) return keep ? { ...next, variant: keep } : next;
	return unboundBinding(keep);
}

/** A fresh source of `kind` for a field, carrying over what fits. */
export function sourceOfKind(
	kind: SourceKind,
	field: string,
	dataset: Dataset | undefined,
	previous?: FieldSource,
): FieldSource | undefined {
	switch (kind) {
		case "default":
			return undefined;
		case "column": {
			if (previous?.kind === "column") return previous;
			const match = columnForKey(dataset?.columns ?? [], field);
			return { kind: "column", column: match?.key ?? "" };
		}
		case "constant":
			return previous?.kind === "constant"
				? previous
				: { kind: "constant", value: "" };
		case "serial":
			return previous?.kind === "serial"
				? previous
				: { kind: "serial", start: 1, step: 1, pad: 4 };
	}
}

/** The binding with one field's source replaced; `undefined` leaves the field
 *  to its default. */
export function withFieldSource(
	binding: Binding,
	field: string,
	source: FieldSource | undefined,
): Binding {
	const { [field]: _old, ...rest } = binding.fields;
	return {
		...binding,
		fields: source ? { ...rest, [field]: source } : rest,
	};
}

/** The dataset id of a binding that holds only a variant choice: a template
 *  with no dataset can still fix its variant or export every one. No
 *  dataset has this id, so the planner treats the template as unbound. */
export const NO_DATASET = "";

/** Whether a binding reads from a dataset, found or not, rather than only
 *  holding a variant choice. */
export function readsDataset(binding: Binding | undefined): binding is Binding {
	return binding !== undefined && binding.datasetId !== NO_DATASET;
}

/** The binding of a template with no dataset: its variant choice alone, or
 *  none when that is Default. */
export function unboundBinding(
	source: VariantSource | undefined,
): Binding | undefined {
	return source
		? { datasetId: NO_DATASET, fields: {}, variant: source }
		: undefined;
}

export function withVariantSource(
	binding: Binding,
	source: VariantSource | undefined,
): Binding {
	const { variant: _v, ...rest } = binding;
	return source ? { ...rest, variant: source } : rest;
}

export function variantSourceOfKind(
	kind: VariantKind,
	template: Template,
	dataset: Dataset | undefined,
	previous?: VariantSource,
): VariantSource | undefined {
	if (kind === "none") return undefined;
	if (previous?.kind === kind) return previous;
	if (previous?.kind === "column" && previous.fallback?.kind === kind)
		return previous.fallback;
	if (kind === "all") return { kind: "all" };
	if (kind === "image")
		return { kind: "image", field: imageFields(template)[0]?.key ?? "" };
	if (kind === "fixed")
		return { kind: "fixed", id: template.variants?.[0]?.id };
	const columns = dataset?.columns ?? [];
	const column =
		columns.find((c) => /^variant$/i.test(c.key)) ??
		columns.find((c) => c.type === "text") ??
		columns[0];
	return variantColumnSource(column?.key ?? "", previous);
}

/** A column variant source, keeping a photo-shape or fixed `previous` as
 *  what it falls back to. */
export function variantColumnSource(
	column: string,
	previous: VariantSource | undefined,
): VariantSource {
	const fallback =
		previous?.kind === "column"
			? previous.fallback
			: previous?.kind === "image" ||
					(previous?.kind === "fixed" && previous.id !== undefined)
				? previous
				: undefined;
	return { kind: "column", column, ...(fallback ? { fallback } : {}) };
}

/** Why a field's source cannot produce a value, if it cannot. */
export function sourceProblem(
	source: FieldSource | undefined,
	dataset: Dataset | undefined,
): string | null {
	if (source?.kind !== "column") return null;
	if (!source.column) return "No column chosen";
	if (!dataset?.columns.some((c) => c.key === source.column))
		return `No column "${source.column}"`;
	return null;
}

/** Required fields that no source fills: unbound, or bound to a missing column. */
export function unmatchedRequired(
	template: Template,
	binding: Binding | undefined,
	dataset: Dataset | undefined,
): string[] {
	if (!binding) return [];
	return templateFields(template)
		.filter((f) => f.required)
		.filter((f) => {
			const source = binding.fields[f.key];
			return source === undefined || sourceProblem(source, dataset) !== null;
		})
		.map((f) => f.key);
}

/** The required fields a binding that reads a dataset leaves unfilled. */
export function unfilledRequired(
	template: Template,
	binding: Binding | undefined,
	datasets: readonly Dataset[],
): string[] {
	if (!readsDataset(binding)) return [];
	const dataset = datasets.find((d) => d.id === binding.datasetId);
	return unmatchedRequired(template, binding, dataset);
}
