import type { Dataset, ImportPlan } from "@freshcoat-js/workspace";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	importTable,
	inPageImporter,
	setTableImporter,
} from "../data/table-import";

afterEach(() => {
	vi.restoreAllMocks();
	setTableImporter(null);
});

describe("importTable", () => {
	it("mints new ids for imported records that collide with existing ones", async () => {
		const importer = inPageImporter();
		setTableImporter(importer);
		const file = new File(["name\nAda\nBo"], "people.csv", {
			type: "text/csv",
		});
		const { id: table } = await importer.open(file, file.name);
		const dataset: Dataset = {
			id: "d_1",
			name: "People",
			columns: [{ key: "name", type: "text" }],
			records: [{ id: "r_0000000000000000", status: "pending", values: {} }],
			assets: [],
		};
		const plan: ImportPlan = {
			headerRow: 0,
			mapping: [{ kind: "column", column: "name" }],
			mode: "append",
			dateOrder: "dmy",
		};
		let n = 0;
		vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
			const uuid = n < 2 ? 0 : n;
			n++;
			return uuid.toString(16).padStart(16, "0").padEnd(32, "0") as ReturnType<
				typeof crypto.randomUUID
			>;
		});

		const out = await importTable(table, 0, dataset, plan);

		const ids = out.dataset.records.map((r) => r.id);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
		expect(ids[0]).toBe("r_0000000000000000");
		expect(out.dataset.records.slice(1).map((r) => r.values.name)).toEqual([
			"Ada",
			"Bo",
		]);
	});
});
