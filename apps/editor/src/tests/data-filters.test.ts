import type { Dataset } from "@freshcoat-js/workspace";
import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_VIEW } from "~/data/data-view";
import {
	type ColumnFilter,
	filterActive,
	filterByColumns,
	selectedInView,
} from "~/data/gallery-model";

function people(): Dataset {
	return {
		id: "d_people",
		name: "People",
		columns: [
			{ key: "name", type: "text" },
			{ key: "tier", type: "text" },
			{ key: "points", type: "integer" },
		],
		records: [
			{
				id: "r_1",
				values: { name: "Ada", tier: "Gold", points: 100 },
				status: "pending",
			},
			{
				id: "r_2",
				values: { name: "Grace", tier: "Gold leaf", points: 10 },
				status: "pending",
			},
			{ id: "r_3", values: { name: "Alan", tier: "" }, status: "pending" },
		],
		assets: [],
	};
}

const f = (
	column: string,
	op: ColumnFilter["op"],
	value = "",
): ColumnFilter => ({
	id: `${column}-${op}`,
	column,
	op,
	value,
});

const ids = (d: Dataset, filters: ColumnFilter[]) =>
	filterByColumns(d.records, d, filters).map((r) => r.id);

describe("column filters", () => {
	it("tests a column for containing, equaling or being empty", () => {
		const d = people();
		expect(ids(d, [f("tier", "contains", "gold")])).toEqual(["r_1", "r_2"]);
		expect(ids(d, [f("tier", "equals", " gold ")])).toEqual(["r_1"]);
		expect(ids(d, [f("points", "equals", "10")])).toEqual(["r_2"]);
		expect(ids(d, [f("tier", "empty")])).toEqual(["r_3"]);
		expect(ids(d, [f("points", "empty")])).toEqual(["r_3"]);
	});

	it("needs every filter, and ignores ones without a value", () => {
		const d = people();
		expect(
			ids(d, [f("tier", "contains", "gold"), f("name", "contains", "a")]),
		).toEqual(["r_1", "r_2"]);
		expect(
			ids(d, [f("tier", "contains", "gold"), f("points", "equals", "100")]),
		).toEqual(["r_1"]);
		expect(filterByColumns(d.records, d, [f("tier", "contains")])).toBe(
			d.records,
		);
		expect(filterActive(f("gone", "empty"), d.columns)).toBe(false);
	});
});

describe("selection in a view", () => {
	it("resolves to dataset order, and all to what the view shows", () => {
		const d = people();
		expect(
			selectedInView(d, {
				...DEFAULT_DATA_VIEW,
				selection: new Set(["r_3", "r_1", "r_9"]),
			}),
		).toEqual(["r_1", "r_3"]);
		expect(
			selectedInView(d, {
				...DEFAULT_DATA_VIEW,
				query: "gold",
				sort: { column: "name", direction: "descending" },
				selection: "all",
			}),
		).toEqual(["r_1", "r_2"]);
		expect(selectedInView(d, undefined)).toEqual([]);
	});
});
