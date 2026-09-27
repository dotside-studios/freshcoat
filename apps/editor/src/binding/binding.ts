import type { Template } from "@freshcoat-js/coatfile";
import type {
	Binding,
	Dataset,
	FieldSource,
	VariantSource,
} from "@freshcoat-js/workspace";
import { autoBinding } from "@freshcoat-js/workspace";

export type SourceKind = FieldSource["kind"] | "default";

export const SOURCE_KINDS: { id: SourceKind; label: string }[] = [
	{ id: "column", label: "Column" },
	{ id: "constant", label: "Fixed" },
	{ id: "serial", label: "Serial" },
	{ id: "default", label: "Default" },
];

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
	const keep = variant && variant.kind !== "column" ? variant : undefined;
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
			const columns = dataset?.columns ?? [];
			const match =
				columns.find((c) => c.key === field) ??
				columns.find((c) => c.key.toLowerCase() === field.toLowerCase()) ??
				columns[0];
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
	if (kind === "all") return { kind: "all" };
	if (kind === "fixed")
		return { kind: "fixed", id: template.variants?.[0]?.id };
	const columns = dataset?.columns ?? [];
	const column =
		columns.find((c) => /^variant$/i.test(c.key)) ??
		columns.find((c) => c.type === "text") ??
		columns[0];
	return { kind: "column", column: column?.key ?? "" };
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
