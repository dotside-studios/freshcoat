import { describe, expect, it } from "vitest";
import { unfilledRequired } from "./binding";
import { presetReadiness } from "./export/readiness";
import { planExport } from "./plan";
import { deepFreeze, members, preset, workspace } from "./test-fixtures";
import type {
	Binding,
	Dataset,
	DatasetAsset,
	DatasetView,
	TemplateEntry,
	ViewFilter,
	ViewJoin,
	Workspace,
} from "./types";
import {
	applyView,
	bindingView,
	boundDataset,
	formatFilter,
	parseFilter,
	withView,
} from "./view";

const clubs: Dataset = deepFreeze<Dataset>({
	id: "d_clubs",
	name: "Clubs",
	columns: [
		{ key: "code", type: "text", required: true },
		{ key: "city", type: "text" },
		{ key: "since", type: "date" },
		{ key: "name", type: "text" },
	],
	records: [
		{
			id: "c1",
			values: {
				code: "gold",
				city: "Manila",
				since: "2001-05-01",
				name: "Gold Club",
			},
			status: "pending",
		},
		{
			id: "c2",
			values: { code: " Gold Tier ", city: "Cebu" },
			status: "pending",
		},
		{ id: "c3", values: { code: "gold", city: "Davao" }, status: "pending" },
		{ id: "c4", values: { city: "Nowhere" }, status: "pending" },
	],
	assets: [],
});

const base = deepFreeze(members);
const datasets = [base, clubs];

const ids = (dataset: Dataset) => dataset.records.map((r) => r.id);
const filtered = (...filters: ViewFilter[]) =>
	applyView(base, { filters }, datasets);

describe("filters", () => {
	it("equals text ignoring case and space", () => {
		expect(
			ids(filtered({ column: "tier", op: "equals", value: " GOLD " }).dataset),
		).toEqual(["r_00000001"]);
	});

	it("contains", () => {
		expect(
			ids(filtered({ column: "name", op: "contains", value: "y" }).dataset),
		).toEqual(["r_00000002", "r_00000003", "r_00000004"]);
	});

	it("empty, and equals with no value, and not", () => {
		const empty = ids(filtered({ column: "tier", op: "empty" }).dataset);
		expect(empty).toEqual(["r_00000004", "r_00000005"]);
		expect(
			ids(filtered({ column: "tier", op: "equals", value: "" }).dataset),
		).toEqual(empty);
		expect(
			ids(filtered({ column: "tier", op: "empty", not: true }).dataset),
		).toEqual(["r_00000001", "r_00000002", "r_00000003"]);
	});

	it("compares numbers, leaving empty cells out", () => {
		expect(
			ids(filtered({ column: "points", op: "gte", value: "1,000" }).dataset),
		).toEqual(["r_00000001"]);
		expect(
			ids(filtered({ column: "points", op: "lt", value: "1000" }).dataset),
		).toEqual([]);
		expect(
			ids(filtered({ column: "points", op: "equals", value: "1200" }).dataset),
		).toEqual(["r_00000001"]);
	});

	it("compares dates, reading the value as a date", () => {
		expect(
			ids(
				filtered({ column: "joined", op: "gt", value: "2024-01-31" }).dataset,
			),
		).toEqual(["r_00000001"]);
		expect(
			ids(
				filtered({ column: "joined", op: "lte", value: "2/28/2024" }).dataset,
			),
		).toEqual([]);
		expect(
			ids(
				filtered({ column: "joined", op: "equals", value: "2024-02-29" })
					.dataset,
			),
		).toEqual(["r_00000001"]);
	});

	it("equals a boolean by yes and no, an empty cell reading as no", () => {
		expect(
			ids(filtered({ column: "vip", op: "equals", value: "yes" }).dataset),
		).toEqual(["r_00000001"]);
		expect(
			ids(filtered({ column: "vip", op: "equals", value: "no" }).dataset),
		).toEqual(["r_00000002", "r_00000003", "r_00000004", "r_00000005"]);
	});

	it("needs every filter to match", () => {
		expect(
			ids(
				filtered(
					{ column: "tier", op: "contains", value: "gold" },
					{ column: "vip", op: "equals", value: "yes" },
				).dataset,
			),
		).toEqual(["r_00000001"]);
	});

	it("keeps no record when a filter cannot apply", () => {
		for (const [filter, problem] of [
			[
				{ column: "nope", op: "equals", value: "x" },
				'No column "nope" to filter on',
			],
			[
				{ column: "points", op: "gt", value: "many" },
				'"many" is not a number, for points',
			],
			[
				{ column: "joined", op: "lt", value: "soon" },
				'"soon" is not a date, for joined',
			],
			[
				{ column: "name", op: "lt", value: "b" },
				"name is text; only numbers and dates compare",
			],
			[
				{ column: "vip", op: "equals", value: "maybe" },
				'"maybe" is not yes or no, for vip',
			],
		] as [ViewFilter, string][]) {
			const result = filtered(filter);
			expect(result.problems).toEqual([problem]);
			expect(result.dataset.records).toEqual([]);
		}
	});

	it("leaves the dataset alone with no filters or join", () => {
		expect(applyView(base, { filters: [] }, datasets).dataset).toBe(base);
		expect(applyView(base, undefined, datasets).dataset).toBe(base);
	});
});

const join: ViewJoin = {
	datasetId: "d_clubs",
	on: "tier",
	key: "code",
	prefix: "club_",
};

describe("joins", () => {
	const view: DatasetView = { filters: [], join };

	it("adds the first matching record's cells under the prefix", () => {
		const { dataset, duplicateKeys, unmatched } = applyView(
			base,
			view,
			datasets,
		);
		expect(dataset.id).toBe(base.id);
		expect(dataset.columns.map((c) => c.key)).toEqual([
			...base.columns.map((c) => c.key),
			"club_city",
			"club_since",
			"club_name",
		]);
		expect(dataset.columns.at(-1)?.required).toBeUndefined();
		expect(dataset.records[0]?.values).toMatchObject({
			name: "Ana Cruz",
			club_city: "Manila",
			club_since: "2001-05-01",
			club_name: "Gold Club",
		});
		expect(dataset.records[1]?.values.club_city).toBe("Cebu");
		expect(duplicateKeys).toEqual(["gold"]);
		expect(unmatched).toEqual(["r_00000003", "r_00000004", "r_00000005"]);
	});

	it("keeps unmatched records with empty joined cells, or drops them when inner", () => {
		const left = applyView(base, view, datasets).dataset;
		expect(ids(left)).toEqual(ids(base));
		expect(left.records[2]?.values.club_city).toBeUndefined();
		const inner = applyView(
			base,
			{ ...view, join: { ...join, inner: true } },
			datasets,
		).dataset;
		expect(ids(inner)).toEqual(["r_00000001", "r_00000002"]);
	});

	it("keeps record ids and statuses", () => {
		const { dataset } = applyView(base, view, datasets);
		expect(dataset.records.map((r) => r.status)).toEqual(
			base.records.map((r) => r.status),
		);
	});

	it("filters on joined columns", () => {
		const { dataset } = applyView(
			base,
			{
				...view,
				filters: [{ column: "club_since", op: "lt", value: "2010-01-01" }],
			},
			datasets,
		);
		expect(ids(dataset)).toEqual(["r_00000001"]);
	});

	it("leaves out joined columns the bound dataset already has", () => {
		const result = applyView(
			base,
			{ filters: [], join: { ...join, prefix: "" } },
			datasets,
		);
		expect(result.clashes).toEqual(["name"]);
		expect(result.dataset.records[0]?.values.name).toBe("Ana Cruz");
		expect(result.dataset.records[0]?.values.city).toBe("Manila");
	});

	it("matches numbers and text by their trimmed text", () => {
		const numbers: Dataset = {
			...clubs,
			id: "d_numbers",
			records: [
				{ id: "n1", values: { code: 7, city: "Iloilo" }, status: "pending" },
			],
		};
		const withNumber: Dataset = {
			...base,
			records: [{ id: "r1", values: { number: " 7 " }, status: "pending" }],
		};
		const { dataset } = applyView(
			withNumber,
			{
				filters: [],
				join: {
					datasetId: "d_numbers",
					on: "number",
					key: "code",
					prefix: "j_",
				},
			},
			[withNumber, numbers],
		);
		expect(dataset.records[0]?.values.j_city).toBe("Iloilo");
	});

	it("names what is missing, and keeps no record", () => {
		const problems = (changed: ViewJoin) =>
			applyView(base, { filters: [], join: changed }, datasets);
		const gone = problems({ ...join, datasetId: "d_gone" });
		expect(gone.problems).toEqual([
			"The joined dataset is not in the workspace",
		]);
		expect(gone.dataset.records).toEqual([]);
		expect(problems({ ...join, on: "nope" }).problems).toEqual([
			'No column "nope" to join on',
		]);
		expect(problems({ ...join, key: "nope" }).problems).toEqual([
			'Clubs has no column "nope"',
		]);
		expect(problems({ ...join, prefix: "1-" }).problems).toEqual([
			'"1-" cannot start a column key',
		]);
	});

	it("carries the joined dataset's photos", () => {
		const [photo] = base.assets as [DatasetAsset];
		const asset = { ...photo, sha256: "f".repeat(64) };
		const withPhoto = { ...clubs, assets: [asset, photo] };
		const { dataset } = applyView(base, view, [base, withPhoto]);
		expect(dataset.assets.map((a) => a.sha256)).toEqual([
			photo.sha256,
			asset.sha256,
		]);
	});
});

describe("bindings", () => {
	const view: DatasetView = {
		filters: [{ column: "club_city", op: "equals", value: "manila" }],
		join,
	};
	const [member, plain] = workspace.templates as [TemplateEntry, TemplateEntry];
	const memberBinding = member.binding as Binding;
	const binding: Binding = {
		...memberBinding,
		fields: {
			...memberBinding.fields,
			number: { kind: "column", column: "club_city" },
		},
		view,
	};
	const bound: Workspace = deepFreeze({
		...workspace,
		datasets,
		templates: [{ ...member, binding }, plain],
	});

	it("plans the records the view keeps, with joined values", () => {
		const plan = planExport(bound, preset);
		expect([...new Set(plan.map((i) => i.recordId))]).toEqual(["r_00000001"]);
		expect(plan[0]?.values.number).toBe("Manila");
	});

	it("reads joined columns as bound", () => {
		expect(unfilledRequired(member.template, binding, datasets)).toEqual([]);
	});

	it("blocks a preset whose view has problems", () => {
		const broken: Workspace = { ...bound, datasets: [base] };
		const readiness = presetReadiness(broken, preset);
		expect(readiness.plan).toEqual([]);
		expect(readiness.viewProblems).toEqual([
			"The joined dataset is not in the workspace",
			'No column "club_city" to filter on',
		]);
		expect(readiness.blocked?.reason).toBe("view");
	});

	it("gives the same result while its inputs stay the same", () => {
		const first = bindingView(binding, datasets);
		expect(bindingView(binding, [...datasets])).toBe(first);
		expect(bindingView(binding, [base, { ...clubs }])).not.toBe(first);
		expect(
			boundDataset({ datasetId: "d_gone", fields: {} }, datasets),
		).toBeUndefined();
	});

	it("drops an empty view", () => {
		expect(withView(binding, { filters: [] })).not.toHaveProperty("view");
		expect(withView(binding, view).view).toBe(view);
	});
});

describe("filter text", () => {
	it.each([
		["tier=gold", { column: "tier", op: "equals", value: "gold" }],
		["tier!=gold", { column: "tier", op: "equals", value: "gold", not: true }],
		["tier=", { column: "tier", op: "empty" }],
		["tier!=", { column: "tier", op: "empty", not: true }],
		["name~an", { column: "name", op: "contains", value: "an" }],
		["name!~an", { column: "name", op: "contains", value: "an", not: true }],
		["points<10", { column: "points", op: "lt", value: "10" }],
		["points<=10", { column: "points", op: "lte", value: "10" }],
		["points>10", { column: "points", op: "gt", value: "10" }],
		[
			"joined>=2024-01-01",
			{ column: "joined", op: "gte", value: "2024-01-01" },
		],
		["not points>10", { column: "points", op: "gt", value: "10", not: true }],
		[
			"city=San Juan = 2",
			{ column: "city", op: "equals", value: "San Juan = 2" },
		],
	] as [string, ViewFilter][])("%s", (text, filter) => {
		expect(parseFilter(text)).toEqual(filter);
		expect(parseFilter(formatFilter(filter))).toEqual(filter);
	});

	it("refuses text with no column or op", () => {
		for (const text of ["", "tier", "=gold", "1st=x", "not"])
			expect(() => parseFilter(text)).toThrow(/<column><op><value>/);
	});
});
