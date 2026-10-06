import type {
	Binding,
	Column,
	DataRecord,
	Dataset,
} from "@freshcoat-js/workspace";
import { describe, expect, it } from "vitest";
import { guessDateOrder } from "~/data/ImportWizard";
import {
	addRecords,
	applySchema,
	changeColumnType,
	columnsFromTemplate,
	conversionFailures,
	deleteColumn,
	deleteRecords,
	displayText,
	duplicateRecords,
	filterRecords,
	INDEX_COLUMN,
	issueCount,
	keyProblem,
	moveColumn,
	rebindColumn,
	recordByIdMap,
	recordIndexMap,
	recordIssues,
	renameColumn,
	STATUS_COLUMN,
	schemaChanges,
	setCell,
	sortRecords,
	templatesUsing,
	uniqueName,
	updateColumn,
	valueFromText,
} from "~/data/model";
import { doc } from "./doc-fixture";

function rec(
	id: string,
	values: DataRecord["values"],
	status: DataRecord["status"] = "pending",
): DataRecord {
	return { id, values, status };
}

function people(): Dataset {
	return {
		id: "d_people",
		name: "People",
		columns: [
			{ key: "name", type: "text", required: true },
			{ key: "age", type: "integer" },
			{ key: "photo", type: "image" },
			{ key: "vip", type: "boolean" },
		],
		records: [
			rec("r_1", { name: "Grace", age: 85, vip: true }),
			rec("r_2", { name: "ada", age: 36, photo: "ws:abc" }, "exported"),
			rec("r_3", { name: "Alan", age: "forty" }),
			rec("r_4", { age: 7 }, "failed"),
		],
		assets: [
			{
				sha256: "abc",
				contentType: "image/png",
				name: "Ada Portrait.png",
				size: 1,
				blob: new Blob([new Uint8Array([1])]),
			},
		],
	};
}

const ids = (records: readonly DataRecord[]) => records.map((r) => r.id);
const indexOf = (d: Dataset) => (id: string) =>
	d.records.findIndex((r) => r.id === id);

describe("search", () => {
	it("matches any cell, ignoring case", () => {
		const d = people();
		expect(ids(filterRecords(d.records, d, "GRACE"))).toEqual(["r_1"]);
		expect(ids(filterRecords(d.records, d, "3"))).toEqual(["r_2"]);
		expect(ids(filterRecords(d.records, d, "  "))).toEqual(ids(d.records));
	});

	it("finds an image cell by its photo's name, not its key", () => {
		const d = people();
		expect(ids(filterRecords(d.records, d, "portrait"))).toEqual(["r_2"]);
		expect(ids(filterRecords(d.records, d, "ws:abc"))).toEqual([]);
		expect(displayText(d.columns[2] as Column, "ws:abc", new Map())).toBe(
			"ws:abc",
		);
	});

	it("sees an edited record, since records are immutable", () => {
		const d = people();
		expect(filterRecords(d.records, d, "lovelace")).toHaveLength(0);
		const next = setCell(d, "r_2", "name", "Ada Lovelace");
		expect(ids(filterRecords(next.records, next, "lovelace"))).toEqual(["r_2"]);
	});
});

describe("sort", () => {
	it("sorts text naturally, ignoring case, in both directions", () => {
		const d = people();
		const asc = sortRecords(
			d.records,
			d.columns,
			{ column: "name", direction: "ascending" },
			indexOf(d),
		);
		expect(ids(asc)).toEqual(["r_2", "r_3", "r_1", "r_4"]);
		const desc = sortRecords(
			d.records,
			d.columns,
			{ column: "name", direction: "descending" },
			indexOf(d),
		);
		// Empty cells stay last either way.
		expect(ids(desc)).toEqual(["r_1", "r_3", "r_2", "r_4"]);
	});

	it("sorts numbers by value, with values that failed to convert after them", () => {
		const d = people();
		const asc = sortRecords(
			d.records,
			d.columns,
			{ column: "age", direction: "ascending" },
			indexOf(d),
		);
		expect(ids(asc)).toEqual(["r_4", "r_2", "r_1", "r_3"]);
	});

	it("sorts by status, by dataset position, and is off without a descriptor", () => {
		const d = people();
		expect(
			ids(
				sortRecords(
					d.records,
					d.columns,
					{ column: STATUS_COLUMN, direction: "ascending" },
					indexOf(d),
				),
			),
		).toEqual(["r_1", "r_3", "r_2", "r_4"]);
		expect(
			ids(
				sortRecords(
					d.records,
					d.columns,
					{ column: INDEX_COLUMN, direction: "descending" },
					indexOf(d),
				),
			),
		).toEqual(["r_4", "r_3", "r_2", "r_1"]);
		expect(sortRecords(d.records, d.columns, undefined, indexOf(d))).toBe(
			d.records,
		);
	});

	it("keeps ties in dataset order", () => {
		const d = people();
		const sorted = sortRecords(
			d.records,
			d.columns,
			{ column: "vip", direction: "ascending" },
			indexOf(d),
		);
		expect(ids(sorted)).toEqual(["r_1", "r_2", "r_3", "r_4"]);
	});
});

describe("cell edits", () => {
	it("sets a value, clears it with null, and keeps the dataset when nothing changes", () => {
		const d = people();
		const a = setCell(d, "r_1", "name", "Grace Hopper");
		expect(a.records[0]?.values.name).toBe("Grace Hopper");
		expect(a.records[1]).toBe(d.records[1]);
		const b = setCell(a, "r_1", "name", null);
		expect("name" in (b.records[0]?.values ?? {})).toBe(false);
		expect(setCell(d, "r_1", "age", 85)).toBe(d);
	});

	it("coerces typed text by the column's type, keeping text that does not fit", () => {
		const d = people();
		const [name, age, photo, vip] = d.columns as [
			Column,
			Column,
			Column,
			Column,
		];
		expect(valueFromText(age, "1,200")).toBe(1200);
		expect(valueFromText(age, "twelve")).toBe("twelve");
		expect(valueFromText(age, "")).toBeNull();
		expect(valueFromText(vip, "yes")).toBe(true);
		expect(valueFromText(name, "")).toBeNull();
		expect(valueFromText(photo, "ada portrait", d.assets)).toBe("ws:abc");
	});

	it("adds records with the column defaults, duplicates after each, and deletes", () => {
		const d = updateColumn(people(), "age", { default: 18 });
		const added = addRecords(d, 2);
		expect(added.dataset.records).toHaveLength(6);
		expect(added.dataset.records[4]?.values).toEqual({ age: 18, vip: false });
		expect(added.ids).toHaveLength(2);

		const dup = duplicateRecords(d, ["r_2", "r_4"]);
		expect(dup.dataset.records.map((r) => r.values.name)).toEqual([
			"Grace",
			"ada",
			"ada",
			"Alan",
			undefined,
			undefined,
		]);
		expect(dup.dataset.records[2]?.status).toBe("pending");
		expect(dup.dataset.records[2]?.id).not.toBe("r_2");

		expect(ids(deleteRecords(d, ["r_1", "r_3"]).records)).toEqual([
			"r_2",
			"r_4",
		]);
		expect(deleteRecords(d, ["nope"])).toBe(d);
	});
});

describe("issues", () => {
	it("counts every failing cell and caches per record", () => {
		const d = people();
		// r_3's age is text, r_4 has no name.
		expect(issueCount(d)).toBe(2);
		const first = recordIssues(d, d.records[2] as DataRecord);
		expect(recordIssues(d, d.records[2] as DataRecord)).toBe(first);
		const fixed = setCell(d, "r_3", "age", 40);
		expect(issueCount(fixed)).toBe(1);
		// A missing photo is an issue only once the asset is gone.
		expect(issueCount({ ...fixed, assets: [] })).toBe(2);
	});
});

describe("column rename", () => {
	it("moves every value to the new key and keeps the column's place", () => {
		const d = people();
		const next = renameColumn(d, "age", "years");
		expect(next?.columns.map((c) => c.key)).toEqual([
			"name",
			"years",
			"photo",
			"vip",
		]);
		expect(next?.records[0]?.values).toEqual({
			name: "Grace",
			years: 85,
			vip: true,
		});
		expect(Object.keys(next?.records[0]?.values ?? {})).toEqual([
			"name",
			"years",
			"vip",
		]);
	});

	it("refuses an invalid or taken key", () => {
		const d = people();
		expect(renameColumn(d, "age", "2nd")).toBeNull();
		expect(renameColumn(d, "age", "name")).toBeNull();
		expect(keyProblem(d, "age", "name")).toBe("taken");
		expect(keyProblem(d, "age", "age")).toBeNull();
		expect(keyProblem(d, "age", "a b")).toBe("invalid");
		expect(renameColumn(d, "age", "age")).toBe(d);
	});

	it("repoints the fields and the variant that read the column", () => {
		const binding: Binding = {
			datasetId: "d_people",
			fields: {
				display: { kind: "column", column: "name" },
				serial: { kind: "serial", start: 1, step: 1, pad: 3 },
				fixed: { kind: "constant", value: "name" },
			},
			variant: { kind: "column", column: "name" },
		};
		const next = rebindColumn(binding, "d_people", "name", "full_name");
		expect(next?.fields.display).toEqual({
			kind: "column",
			column: "full_name",
		});
		expect(next?.fields.serial).toBe(binding.fields.serial);
		expect(next?.fields.fixed).toEqual({ kind: "constant", value: "name" });
		expect(next?.variant).toEqual({ kind: "column", column: "full_name" });
		expect(rebindColumn(binding, "d_other", "name", "full_name")).toBeNull();
		expect(rebindColumn(binding, "d_people", "age", "years")).toBeNull();
	});
});

describe("column type change", () => {
	it("counts the values that will not convert before changing", () => {
		const d = people();
		expect(conversionFailures(d, "name", "integer")).toBe(3);
		expect(conversionFailures(d, "age", "text")).toBe(0);
		expect(conversionFailures(d, "age", "integer")).toBe(0);
	});

	it("re-coerces the values, keeping the text of those that fail", () => {
		const d = setCell(people(), "r_1", "name", "12");
		const { dataset, failed } = changeColumnType(d, "name", "integer");
		expect(failed).toBe(2);
		expect(dataset.columns[0]?.type).toBe("integer");
		expect(dataset.records.map((r) => r.values.name)).toEqual([
			12,
			"ada",
			"Alan",
			undefined,
		]);

		const back = changeColumnType(dataset, "name", "text");
		expect(back.failed).toBe(0);
		expect(back.dataset.records[0]?.values.name).toBe("12");
	});

	it("drops the constraints and the default the new type cannot use", () => {
		let d = updateColumn(people(), "name", {
			maxLength: 20,
			enum: ["a", "b"],
			default: "Ada",
		});
		d = changeColumnType(d, "name", "number").dataset;
		const c = d.columns[0] as Column;
		expect(c).toEqual({ key: "name", type: "number", required: true });

		let e = updateColumn(people(), "age", { minimum: 1, default: 3 });
		e = changeColumnType(e, "age", "text").dataset;
		expect(e.columns[1]).toEqual({ key: "age", type: "text", default: "3" });
	});
});

describe("columns", () => {
	it("moves, updates and deletes", () => {
		const d = people();
		expect(moveColumn(d, "vip", -1).columns.map((c) => c.key)).toEqual([
			"name",
			"age",
			"vip",
			"photo",
		]);
		expect(moveColumn(d, "name", -1)).toBe(d);
		const u = updateColumn(d, "name", { title: "Name", required: undefined });
		expect(u.columns[0]).toEqual({ key: "name", type: "text", title: "Name" });
		const del = deleteColumn(d, "age");
		expect(del.columns.map((c) => c.key)).toEqual(["name", "photo", "vip"]);
		expect(del.records.every((r) => !("age" in r.values))).toBe(true);
	});

	it("makes one column per template field, typed by its format", () => {
		const columns = columnsFromTemplate(doc());
		expect(columns).toEqual([
			{
				key: "name",
				type: "text",
				title: "Name",

				required: true,
			},
			{ key: "title", type: "text", required: true },
			{ key: "show", type: "boolean" },
		]);
	});
});

describe("JSON Schema import", () => {
	const incoming: Column[] = [
		{ key: "name", type: "text", title: "Full name" },
		{ key: "age", type: "text" },
		{ key: "email", type: "email" },
	];

	it("describes what replace and merge would do", () => {
		const d = people();
		expect(schemaChanges(d, incoming, "merge")).toEqual({
			added: ["email"],
			changed: ["name", "age"],
			removed: [],
		});
		expect(schemaChanges(d, incoming, "replace").removed).toEqual([
			"photo",
			"vip",
		]);
	});

	it("replaces the columns, dropping the values of those that are gone", () => {
		const next = applySchema(people(), incoming, "replace");
		expect(next.columns).toEqual(incoming);
		expect(next.records[0]?.values).toEqual({ name: "Grace", age: "85" });
	});

	it("merges into the columns, keeping the ones it does not name", () => {
		const next = applySchema(people(), incoming, "merge");
		expect(next.columns.map((c) => c.key)).toEqual([
			"name",
			"age",
			"photo",
			"vip",
			"email",
		]);
		expect(next.columns[0]?.title).toBe("Full name");
		expect(next.records[1]?.values.photo).toBe("ws:abc");
	});
});

describe("helpers", () => {
	it("numbers a name that is taken", () => {
		expect(uniqueName("Dataset", [])).toBe("Dataset");
		expect(uniqueName("Dataset", ["Dataset", "Dataset 2"])).toBe("Dataset 3");
	});

	it("lists the templates bound to a dataset", () => {
		const templates = [
			{
				id: "t_1",
				fileName: "a.coat",
				binding: { datasetId: "d_1", fields: {} },
			},
			{ id: "t_2", fileName: "b.coat" },
		];
		expect(templatesUsing(templates, "d_1")).toEqual([templates[0]]);
		expect(templatesUsing(templates, "d_2")).toEqual([]);
	});

	it("guesses the date order from a date only one order can read", () => {
		expect(guessDateOrder([["a"], ["31/03/2025"]])).toBe("dmy");
		expect(guessDateOrder([["03/31/2025"]])).toBe("mdy");
		expect(guessDateOrder([["03/04/2025"]])).toBe("mdy");
	});
});

describe("record lookups", () => {
	it("reuses the maps for the same records array", () => {
		const records = [rec("a", {}), rec("b", {}), rec("c", {})];
		const index = recordIndexMap(records);
		expect([...index]).toEqual([
			["a", 0],
			["b", 1],
			["c", 2],
		]);
		expect(recordIndexMap(records)).toBe(index);
		const byId = recordByIdMap(records);
		expect(byId.get("b")).toBe(records[1]);
		expect(recordByIdMap(records)).toBe(byId);
	});

	it("makes new maps for a new records array", () => {
		const records = [rec("a", {}), rec("b", {})];
		const index = recordIndexMap(records);
		const byId = recordByIdMap(records);
		const next = [records[1] as DataRecord, records[0] as DataRecord];
		expect(recordIndexMap(next)).not.toBe(index);
		expect(recordIndexMap(next).get("a")).toBe(1);
		expect(recordByIdMap(next)).not.toBe(byId);
		expect(recordIndexMap(records).get("a")).toBe(0);
	});
});
