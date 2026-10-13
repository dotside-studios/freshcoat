import { describe, expect, test } from "bun:test";
import {
	ArgumentError,
	collectFilter,
	collectScale,
	collectSetting,
	parseJobs,
	parseLength,
	parseOffset,
	parsePaper,
	parseQuality,
} from "../src/args";

describe("argument parsers", () => {
	test("read the values they take", () => {
		expect(collectSetting("name=Ana=B", { motto: "Hi" })).toEqual({ motto: "Hi", name: "Ana=B" });
		expect(collectScale("2", [1])).toEqual([1, 2]);
		expect(collectFilter("points>=10", [{ column: "tier", op: "empty" }])).toEqual([
			{ column: "tier", op: "empty" },
			{ column: "points", op: "gte", value: "10" },
		]);
		expect(parseQuality("0")).toBe(0);
		expect(parseJobs("3")).toBe(3);
		expect(parseLength("0")).toBe(0);
		expect(parseOffset("-1.5, 2")).toEqual({ x: -1.5, y: 2 });
		expect(parsePaper("A4")).toBe("a4");
		expect(parsePaper("297x210")).toEqual({ widthMm: 210, heightMm: 297 });
	});

	test("refuse the rest with an ArgumentError", () => {
		const refusals: [() => unknown, string][] = [
			[() => collectSetting("name"), "Expected key=value."],
			[() => collectFilter("tier"), "Expected <column><op><value>, with = != ~ !~ < <= > or >= as the op."],
			[() => collectScale("0"), "Expected a positive number."],
			[() => parseQuality("101"), "Expected a whole number from 0 to 100."],
			[() => parseJobs("1.5"), "Expected a whole number, 1 or more."],
			[() => parseLength("-1"), "Expected millimetres, 0 or more."],
			[() => parseOffset("1"), "Expected <x>,<y> in millimetres, such as 0.5,-1."],
			[() => parseOffset("1,"), "Expected <x>,<y> in millimetres, such as 0.5,-1."],
			[() => parseOffset("1,2,3"), "Expected <x>,<y> in millimetres, such as 0.5,-1."],
			[() => parsePaper("b5"), "Expected a4, letter, legal, a3, tabloid or <width>x<height> in millimetres."],
		];
		for (const [parse, message] of refusals) {
			expect(parse).toThrow(ArgumentError);
			expect(parse).toThrow(message);
		}
	});
});
