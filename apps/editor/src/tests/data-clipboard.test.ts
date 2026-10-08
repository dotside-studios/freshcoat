import type { Dataset } from "@freshcoat-js/workspace";
import { describe, expect, it } from "vitest";
import {
	copyCells,
	parseTsv,
	pasteBlock,
	pasteInto,
	toTsv,
	writeCells,
} from "~/data/clipboard";

function people(): Dataset {
	return {
		id: "d_people",
		name: "People",
		columns: [
			{ key: "name", type: "text", required: true },
			{ key: "age", type: "integer" },
			{ key: "member", type: "boolean" },
		],
		records: [
			{ id: "r_1", values: { name: "Ada", age: 36 }, status: "pending" },
			{ id: "r_2", values: { name: "Grace", age: 85 }, status: "pending" },
			{ id: "r_3", values: { name: "Alan" }, status: "pending" },
		],
		assets: [],
	};
}

describe("TSV", () => {
	it("parses spreadsheet clipboard text, quotes and all", () => {
		expect(parseTsv("a\tb\r\nc\td\r\n")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(parseTsv('"two\nlines"\t"say ""hi"""\n\tx')).toEqual([
			["two\nlines", 'say "hi"'],
			["", "x"],
		]);
		expect(parseTsv("one")).toEqual([["one"]]);
		expect(parseTsv("")).toEqual([]);
	});

	it("round-trips through toTsv", () => {
		const rows = [
			["a\tb", 'q"uote'],
			["line\nbreak", ""],
		];
		expect(parseTsv(toTsv(rows))).toEqual(rows);
	});
});

describe("copy and paste", () => {
	it("copies records' cells in the order given", () => {
		const d = people();
		expect(copyCells(d, ["r_2", "r_1"], ["name", "age"])).toBe(
			"Grace\t85\nAda\t36",
		);
		expect(copyCells(d, ["r_3"], ["age"])).toBe("");
	});

	it("pastes a block down the shown records, parsing each value", () => {
		const d = people();
		const out = pasteBlock(
			d,
			["r_3", "r_1", "r_2"],
			{ row: "r_1", col: "age" },
			[
				["40", "yes"],
				["old", "no"],
			],
		);
		expect(out.cells).toBe(4);
		expect(out.misfits).toBe(1);
		expect(out.added).toBe(0);
		const [ada, grace, alan] = out.dataset.records;
		expect(ada?.values).toEqual({ name: "Ada", age: 40, member: true });
		expect(grace?.values).toEqual({ name: "Grace", age: "old", member: false });
		expect(alan).toBe(d.records[2]);
	});

	it("adds records past the last one and leaves out extra columns", () => {
		const d = people();
		const out = pasteBlock(
			d,
			["r_1", "r_2", "r_3"],
			{ row: "r_3", col: "member" },
			[
				["yes", "x"],
				["no", "y"],
			],
		);
		expect(out.added).toBe(1);
		expect(out.clipped).toBe(1);
		expect(out.dataset.records).toHaveLength(4);
		expect(out.dataset.records[3]?.values.member).toBe(false);
		expect(out.misfits).toBe(0);
	});

	it("clears a cell for empty text and fills several records with one value", () => {
		const d = people();
		const cleared = pasteBlock(d, ["r_1"], { row: "r_1", col: "age" }, [[""]]);
		expect(cleared.dataset.records[0]?.values).toEqual({ name: "Ada" });
		const filled = pasteInto(d, ["r_1", "r_3"], "age", "7");
		expect(filled.dataset.records.map((r) => r.values.age)).toEqual([7, 85, 7]);
		const blank = pasteInto(d, ["r_1"], "name", " ");
		expect(blank.misfits).toBe(1);
	});

	it("keeps the dataset when nothing changes", () => {
		const d = people();
		expect(writeCells(d, [{ id: "r_1", key: "name", value: "Ada" }])).toBe(d);
		expect(
			pasteBlock(d, ["r_1"], { row: "r_9", col: "age" }, [["1"]]).dataset,
		).toBe(d);
	});
});
