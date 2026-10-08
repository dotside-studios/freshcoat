import { describe, expect, it } from "vitest";
import {
	applyMapping,
	columnLetter,
	detectHeaderRow,
	guessMapping,
	headersOf,
	inferType,
	previewMapping,
} from "./mapping";
import { deepFreeze, photoSha } from "./test-fixtures";
import type { Column, Dataset, ImportPlan } from "./types";

const columns: Column[] = [
	{ key: "first_name", title: "Given name", type: "text", required: true },
	{ key: "email", type: "email" },
	{ key: "points", type: "integer", default: 0 },
	{ key: "photo", type: "image" },
];

const base: Dataset = deepFreeze<Dataset>({
	id: "d",
	name: "People",
	columns,
	records: [
		{
			id: "r_a",
			values: { first_name: "Ana", email: "ana@x.co", points: 5 },
			status: "exported" as const,
		},
		{ id: "r_b", values: { first_name: "Ben" }, status: "pending" as const },
	],
	assets: [
		{
			sha256: photoSha,
			contentType: "image/png",
			name: "cy.png",
			size: 1,
			blob: new Blob([new Uint8Array([1])]),
		},
	],
});

describe("headers", () => {
	it("names columns by letter when there is no header row", () => {
		expect(columnLetter(0)).toBe("A");
		expect(columnLetter(25)).toBe("Z");
		expect(columnLetter(26)).toBe("AA");
		expect(headersOf([["x", "y"], ["1"]], -1)).toEqual(["A", "B"]);
		expect(headersOf([[" x ", "y"]], 0)).toEqual(["x", "y"]);
	});

	it("detects the first full row as the header", () => {
		expect(
			detectHeaderRow([
				["Report", "", ""],
				["", "", ""],
				["a", "b", "c"],
				["1", "2", "3"],
			]),
		).toBe(2);
		expect(detectHeaderRow([])).toBe(-1);
	});
});

describe("inferType", () => {
	it("picks the narrowest type every value fits", () => {
		expect(inferType(["1", "20", "-3", ""])).toBe("integer");
		expect(inferType(["1,234", "5"])).toBe("integer");
		expect(inferType(["1.5", "2"])).toBe("number");
		expect(inferType(["007", "008"])).toBe("text");
		expect(inferType(["yes", "No", "TRUE"])).toBe("boolean");
		expect(inferType(["2024-01-01", "31/12/2024", "12/31/2024"])).toBe("date");
		expect(inferType(["https://a.co", "http://b.co/x"])).toBe("url");
		expect(inferType(["a@b.co", "c@d.org"])).toBe("email");
		expect(inferType(["hello", "world"])).toBe("text");
		expect(inferType(["line\nbreak"])).toBe("longText");
		expect(inferType(["x".repeat(121)])).toBe("longText");
		expect(inferType(["", " "])).toBe("text");
	});

	it("infers image file names and hex colors", () => {
		expect(inferType(["ada.png", "Grace Hopper.JPG", "photos/cy.webp"])).toBe(
			"image",
		);
		expect(inferType(["ada.png", "notes.txt"])).toBe("text");
		expect(inferType(["https://a.co/ada.png"])).toBe("url");
		expect(inferType(["#fff", "#00FF7f", "#11223344"])).toBe("color");
		expect(inferType(["#fff", "red"])).toBe("text");
		expect(inferType(["#12345"])).toBe("text");
	});

	it("reads only the first 200 values", () => {
		expect(inferType([...Array(200).fill("1"), "x"])).toBe("integer");
	});
});

describe("guessMapping", () => {
	it("matches keys, then titles and loose spellings, then adds columns", () => {
		const mapping = guessMapping(
			["email", "First Name", "Points!", "", "Tier", "Joined", "email"],
			columns,
			[
				["a@b.co", "Ana", "1", "x", "gold", "2024-01-01", "z"],
				["c@d.co", "Ben", "2", "y", "silver", "2024-02-01", "z"],
			],
		);
		expect(mapping).toEqual([
			{ kind: "column", column: "email" },
			{ kind: "column", column: "first_name" },
			{ kind: "column", column: "points" },
			{ kind: "skip" },
			{ kind: "new", key: "tier", type: "text" },
			{ kind: "new", key: "joined", type: "date" },
			{ kind: "new", key: "email_2", type: "text" },
		]);
	});

	it("matches a title", () => {
		expect(guessMapping(["given name"], columns)).toEqual([
			{ kind: "column", column: "first_name" },
		]);
	});

	it("prefers an exact key over a loose match elsewhere", () => {
		const cols: Column[] = [{ key: "Name", type: "text" }];
		expect(guessMapping(["name", "Name"], cols)).toEqual([
			{ kind: "new", key: "name", type: "text" },
			{ kind: "column", column: "Name" },
		]);
	});
});

const rows = [
	["Name", "Mail", "Points", "Photo", "Tier"],
	["Cy", "cy@x.co", "1,200", "CY.PNG", "gold"],
	["", "", "", "", ""],
	["Dee", "not-an-email", "12.5", "", "silver"],
	["", "e@x.co", "3", "", ""],
];

const plan: ImportPlan = {
	headerRow: 0,
	mapping: [
		{ kind: "column", column: "first_name" },
		{ kind: "column", column: "email" },
		{ kind: "column", column: "points" },
		{ kind: "column", column: "photo" },
		{ kind: "new", key: "tier", type: "text" },
	],
	mode: "append",
	dateOrder: "dmy",
};

describe("applyMapping", () => {
	it("appends coerced records and new columns, reporting issues", () => {
		const result = applyMapping(base, deepFreeze(rows), plan);
		expect(result.added).toBe(3);
		expect(result.updated).toBe(0);
		expect(result.dataset.columns.map((c) => c.key)).toEqual([
			"first_name",
			"email",
			"points",
			"photo",
			"tier",
		]);
		expect(result.dataset.columns[4]).toEqual({
			key: "tier",
			type: "text",
			title: "Tier",
		});
		const added = result.dataset.records.slice(2);
		expect(added.map((r) => r.status)).toEqual([
			"pending",
			"pending",
			"pending",
		]);
		expect(added.every((r) => /^r_[0-9a-f]{16}$/.test(r.id))).toBe(true);
		expect(added[0]?.values).toEqual({
			first_name: "Cy",
			email: "cy@x.co",
			points: 1200,
			photo: `ws:${photoSha}`,
			tier: "gold",
		});
		expect(added[1]?.values).toEqual({
			first_name: "Dee",
			email: "not-an-email",
			points: "12.5",
			tier: "silver",
		});
		expect(added[2]?.values).toEqual({ email: "e@x.co", points: 3 });
		const [, dee, empty] = added;
		expect(result.issues).toEqual([
			{
				row: 3,
				record: dee?.id,
				column: "points",
				message: "Not a whole number",
			},
			{
				row: 3,
				record: dee?.id,
				column: "email",
				message: "Not an email address",
			},
			{ row: 4, record: empty?.id, column: "first_name", message: "Required" },
		]);
		expect(result.dataset.records[0]).toBe(base.records[0]);
	});

	it("gives every imported record a distinct id", () => {
		const rows = [
			["n"],
			...Array.from({ length: 40_000 }, (_, i) => [`P${i}`]),
		];
		const result = applyMapping(base, rows, {
			...plan,
			mapping: [{ kind: "column", column: "first_name" }],
		});
		expect(result.added).toBe(40_000);
		const ids = new Set(result.dataset.records.map((r) => r.id));
		expect(ids.size).toBe(result.dataset.records.length);
	});

	it("fills an unmapped or empty cell of a new record from the default", () => {
		const result = applyMapping(base, [["n"], ["Zed"]], {
			...plan,
			mapping: [{ kind: "column", column: "first_name" }],
		});
		expect(result.dataset.records[2]?.values).toEqual({
			first_name: "Zed",
			points: 0,
		});
	});

	it("replaces the records but keeps the columns", () => {
		const result = applyMapping(base, rows, { ...plan, mode: "replace" });
		expect(result.added).toBe(3);
		expect(result.dataset.records).toHaveLength(3);
		expect(result.dataset.records.some((r) => r.id === "r_a")).toBe(false);
		expect(result.dataset.columns.slice(0, 4)).toEqual(columns);
	});

	it("upserts by a matching column", () => {
		const upsert = [
			["name", "mail", "points"],
			["Ana", "", "9"],
			["ben", "ben@x.co", "x"],
			["Ben", "ben@x.co", "4"],
			["Zoe", "zoe@x.co", "1"],
			["Zoe", "zoe2@x.co", ""],
		];
		const result = applyMapping(base, upsert, {
			headerRow: 0,
			mapping: [
				{ kind: "column", column: "first_name" },
				{ kind: "column", column: "email" },
				{ kind: "column", column: "points" },
			],
			mode: "append",
			dateOrder: "mdy",
			match: { source: 0, column: "first_name" },
		});
		expect(result.updated).toBe(2);
		expect(result.added).toBe(2);
		const [ana, ben, lower, zoe] = result.dataset.records;
		expect(ana).toEqual({
			id: "r_a",
			status: "exported",
			values: { first_name: "Ana", email: "ana@x.co", points: 9 },
		});
		expect(ben).toEqual({
			id: "r_b",
			status: "pending",
			values: { first_name: "Ben", email: "ben@x.co", points: 4 },
		});
		expect(lower?.values).toMatchObject({ first_name: "ben", points: "x" });
		expect(zoe?.values).toEqual({
			first_name: "Zoe",
			email: "zoe2@x.co",
			points: 1,
		});
		expect(result.dataset.records).toHaveLength(4);
		expect(result.issues).toEqual([
			{ row: 2, record: lower?.id, column: "points", message: "Not a number" },
		]);
		expect(base.records[0]?.values.points).toBe(5);
	});

	it("reads rows with no header", () => {
		const result = applyMapping(base, [["Ann", "a@b.co"]], {
			...plan,
			headerRow: -1,
			mapping: [
				{ kind: "column", column: "first_name" },
				{ kind: "new", key: "b", type: "email" },
			],
		});
		expect(result.dataset.records[2]?.values).toEqual({
			first_name: "Ann",
			points: 0,
			b: "a@b.co",
		});
		expect(result.dataset.columns[4]).toEqual({
			key: "b",
			type: "email",
			title: "B",
		});
	});
});

describe("previewMapping", () => {
	it("coerces the first rows and marks the bad cells", () => {
		const preview = previewMapping(rows, plan, columns, 2);
		expect(preview).toHaveLength(2);
		expect(preview[0]?.row).toBe(1);
		expect(preview[0]?.cells[2]).toEqual({
			column: "points",
			raw: "1,200",
			value: 1200,
			ok: true,
		});
		expect(preview[1]?.row).toBe(3);
		const bad = preview[1]?.cells.filter((c) => !c.ok).map((c) => c.column);
		expect(bad).toEqual(["email", "points"]);
		expect(preview[1]?.cells[1]?.message).toBe("Not an email address");
	});
});
