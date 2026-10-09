import type { DataRecord } from "@freshcoat-js/workspace";
import { describe, expect, it } from "vitest";
import { INDEX_COLUMN, STATUS_COLUMN, sortGridRecords } from "~/data/model";

const records: DataRecord[] = [
	{ id: "r_1", values: { name: "Grace" }, status: "pending" },
	{ id: "r_2", values: { name: "ada" }, status: "exported" },
	{ id: "r_3", values: { name: "Alan" }, status: "pending" },
	{ id: "r_4", values: {}, status: "failed" },
];
const columns = [{ key: "name", type: "text" as const }];
const ids = (rs: readonly DataRecord[]) => rs.map((r) => r.id);
const indexOf = (id: string) => records.findIndex((r) => r.id === id);

describe("grid sort", () => {
	it("sorts by status, by dataset position, by a column, and is off without a descriptor", () => {
		expect(
			ids(
				sortGridRecords(
					records,
					columns,
					{ column: STATUS_COLUMN, direction: "ascending" },
					indexOf,
				),
			),
		).toEqual(["r_1", "r_3", "r_2", "r_4"]);
		expect(
			ids(
				sortGridRecords(
					records,
					columns,
					{ column: INDEX_COLUMN, direction: "descending" },
					indexOf,
				),
			),
		).toEqual(["r_4", "r_3", "r_2", "r_1"]);
		expect(
			ids(
				sortGridRecords(
					records,
					columns,
					{ column: "name", direction: "ascending" },
					indexOf,
				),
			),
		).toEqual(["r_2", "r_3", "r_1", "r_4"]);
		expect(sortGridRecords(records, columns, undefined, indexOf)).toBe(records);
	});
});
