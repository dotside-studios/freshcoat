import type { Template } from "@freshcoat-js/coatfile";
import type { Binding, Dataset } from "@freshcoat-js/workspace";
import { describe, expect, test } from "vitest";
import {
	bindingForDataset,
	NO_DATASET,
	readsDataset,
	rebindDataset,
	sourceOfKind,
	sourceProblem,
	templateFields,
	unboundBinding,
	unmatchedRequired,
	variantSourceOfKind,
	withFieldSource,
	withVariantSource,
} from "~/binding/binding";
import { doc } from "./doc-fixture";

function dataset(): Dataset {
	return {
		id: "d_people",
		name: "People",
		columns: [
			{ key: "Name", type: "text" },
			{ key: "role", type: "text" },
			{ key: "variant", type: "text" },
		],
		records: [],
		assets: [],
	};
}

function withVariants(): Template {
	return {
		...doc(),
		variants: [{ id: "dark", label: "Dark", overrides: [] }],
	} as Template;
}

describe("binding helpers", () => {
	test("template fields carry title, required and default", () => {
		expect(templateFields(doc())).toEqual([
			{ key: "name", title: "Name", required: true, defaultValue: "Ada" },
			{ key: "title", title: "title", required: true, defaultValue: "" },
			{ key: "show", title: "show", required: false, defaultValue: "true" },
		]);
	});

	test("choosing a dataset matches fields by key, ignoring case", () => {
		expect(bindingForDataset(doc(), dataset())).toEqual({
			datasetId: "d_people",
			fields: { name: { kind: "column", column: "Name" } },
		});
		expect(bindingForDataset(doc(), undefined)).toBeUndefined();
	});

	test("each source kind starts from something usable", () => {
		const ds = dataset();
		expect(sourceOfKind("column", "name", ds)).toEqual({
			kind: "column",
			column: "Name",
		});
		expect(sourceOfKind("column", "zzz", ds)).toEqual({
			kind: "column",
			column: "Name",
		});
		expect(sourceOfKind("constant", "name", ds)).toEqual({
			kind: "constant",
			value: "",
		});
		expect(sourceOfKind("serial", "name", ds)).toEqual({
			kind: "serial",
			start: 1,
			step: 1,
			pad: 4,
		});
		expect(sourceOfKind("default", "name", ds)).toBeUndefined();
		const kept = { kind: "constant" as const, value: "x" };
		expect(sourceOfKind("constant", "name", ds, kept)).toBe(kept);
	});

	test("a field source is replaced or removed", () => {
		const b: Binding = {
			datasetId: "d",
			fields: { name: { kind: "column", column: "Name" } },
		};
		expect(
			withFieldSource(b, "title", { kind: "constant", value: "Dr" }).fields,
		).toEqual({
			name: { kind: "column", column: "Name" },
			title: { kind: "constant", value: "Dr" },
		});
		expect(withFieldSource(b, "name", undefined).fields).toEqual({});
		expect(b.fields.name).toBeDefined();
	});

	test("the variant source is set and cleared", () => {
		const b: Binding = { datasetId: "d", fields: {} };
		const fixed = variantSourceOfKind("fixed", withVariants(), dataset());
		expect(fixed).toEqual({ kind: "fixed", id: "dark" });
		const column = variantSourceOfKind("column", withVariants(), dataset());
		expect(column).toEqual({ kind: "column", column: "variant" });
		expect(withVariantSource(b, column)).toEqual({ ...b, variant: column });
		expect(
			withVariantSource({ ...b, variant: column }, undefined),
		).not.toHaveProperty("variant");
		expect(variantSourceOfKind("none", withVariants(), dataset())).toBe(
			undefined,
		);
	});

	test("All variants is its own source, not a column", () => {
		expect(variantSourceOfKind("all", withVariants(), dataset())).toEqual({
			kind: "all",
		});
		expect(variantSourceOfKind("all", withVariants(), undefined)).toEqual({
			kind: "all",
		});
		const fixed = { kind: "fixed" as const, id: "dark" };
		expect(
			variantSourceOfKind("all", withVariants(), dataset(), fixed),
		).toEqual({ kind: "all" });
	});

	test("a template with no dataset keeps its variant choice alone", () => {
		expect(unboundBinding(undefined)).toBeUndefined();
		const all = unboundBinding({ kind: "all" });
		expect(all).toEqual({
			datasetId: NO_DATASET,
			fields: {},
			variant: { kind: "all" },
		});
		expect(readsDataset(all)).toBe(false);
		expect(readsDataset(undefined)).toBe(false);
		expect(readsDataset({ datasetId: "gone", fields: {} })).toBe(true);
	});

	test("choosing a dataset keeps the variant choice a new binding can honour", () => {
		const ds = dataset();
		const t = withVariants();
		expect(rebindDataset(t, ds, unboundBinding({ kind: "all" }))).toEqual({
			...bindingForDataset(t, ds),
			variant: { kind: "all" },
		});
		const byColumn: Binding = {
			datasetId: ds.id,
			fields: {},
			variant: { kind: "column", column: "variant" },
		};
		expect(rebindDataset(t, undefined, byColumn)).toBeUndefined();
		expect(
			rebindDataset(t, undefined, {
				...byColumn,
				variant: { kind: "fixed", id: "dark" },
			}),
		).toEqual(unboundBinding({ kind: "fixed", id: "dark" }));
		expect(rebindDataset(t, ds, undefined)).toEqual(bindingForDataset(t, ds));
	});

	test("required fields with no working source are unmatched", () => {
		const ds = dataset();
		const b: Binding = {
			datasetId: ds.id,
			fields: {
				name: { kind: "column", column: "gone" },
				show: { kind: "constant", value: "true" },
			},
		};
		expect(sourceProblem(b.fields.name, ds)).toBe('No column "gone"');
		expect(unmatchedRequired(doc(), b, ds)).toEqual(["name", "title"]);
		expect(
			unmatchedRequired(
				doc(),
				{
					...b,
					fields: {
						name: { kind: "column", column: "Name" },
						title: { kind: "serial", start: 1, step: 1, pad: 0 },
					},
				},
				ds,
			),
		).toEqual([]);
		expect(unmatchedRequired(doc(), undefined, ds)).toEqual([]);
	});
});
