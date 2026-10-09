import type { Dataset } from "@freshcoat-js/workspace";
import { describe, expect, it } from "vitest";
import { countMatches, replaceAll } from "~/data/find";

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
				values: { name: "Gold Ada", tier: "Gold", points: 100 },
				status: "pending",
			},
			{
				id: "r_2",
				values: { name: "Grace", tier: "gold-gold", points: 10 },
				status: "pending",
			},
			{ id: "r_3", values: { name: "Alan" }, status: "pending" },
		],
		assets: [],
	};
}

describe("find and replace", () => {
	it("counts matches and the records holding them", () => {
		const d = people();
		expect(countMatches(d, d.records, { text: "gold" })).toEqual({
			matches: 4,
			records: 2,
		});
		expect(
			countMatches(d, d.records, { text: "gold", column: "tier" }),
		).toEqual({ matches: 3, records: 2 });
		expect(
			countMatches(d, d.records, { text: "Gold", matchCase: true }),
		).toEqual({ matches: 2, records: 1 });
		expect(countMatches(d, d.records, { text: "" }).matches).toBe(0);
	});

	it("replaces every occurrence, parsing the new text by type", () => {
		const d = people();
		const out = replaceAll(
			d,
			d.records,
			{ text: "gold", column: "tier" },
			"Silver",
		);
		expect(out.matches).toBe(3);
		expect(out.dataset.records.map((r) => r.values.tier)).toEqual([
			"Silver",
			"Silver-Silver",
			undefined,
		]);
		expect(out.dataset.records[0]?.values.name).toBe("Gold Ada");

		const points = replaceAll(
			d,
			d.records,
			{ text: "0", column: "points" },
			"",
		);
		expect(points.dataset.records.map((r) => r.values.points)).toEqual([
			1,
			1,
			undefined,
		]);
		const cleared = replaceAll(d, d.records, { text: "Alan" }, "");
		expect(cleared.dataset.records[2]?.values).toEqual({});
	});

	it("only touches the records given", () => {
		const d = people();
		const out = replaceAll(
			d,
			[d.records[1] as Dataset["records"][0]],
			{ text: "gold" },
			"x",
		);
		expect(out.dataset.records[0]).toBe(d.records[0]);
		expect(out.dataset.records[1]?.values.tier).toBe("x-x");
	});
});
