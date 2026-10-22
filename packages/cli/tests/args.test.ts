import { describe, expect, test } from "bun:test";
import { PRESET_SCALE } from "@freshcoat-js/workspace";
import {
	ArgumentError,
	collectCutSpot,
	collectFilter,
	collectScale,
	collectSetting,
	parseCopies,
	parseJobs,
	parseLength,
	parseMarks,
	parseMaxEdge,
	parseOffset,
	parsePaper,
	parseQuality,
	parseScale,
} from "../src/args";

describe("argument parsers", () => {
	test("read the values they take", () => {
		expect(collectSetting("name=Ana=B", { motto: "Hi" })).toEqual({
			motto: "Hi",
			name: "Ana=B",
		});
		expect(collectScale("2", [1])).toEqual([1, 2]);
		expect(parseScale(String(PRESET_SCALE.min))).toBe(PRESET_SCALE.min);
		expect(parseScale("2.5")).toBe(2.5);
		expect(parseScale(String(PRESET_SCALE.max))).toBe(PRESET_SCALE.max);
		expect(parseMaxEdge("2048")).toBe(2048);
		expect(
			collectFilter("points>=10", [{ column: "tier", op: "empty" }]),
		).toEqual([
			{ column: "tier", op: "empty" },
			{ column: "points", op: "gte", value: "10" },
		]);
		expect(parseQuality("0")).toBe(0);
		expect(parseJobs("3")).toBe(3);
		expect(parseLength("0")).toBe(0);
		expect(parseOffset("-1.5, 2")).toEqual({ x: -1.5, y: 2 });
		expect(parseOffset("50,-50")).toEqual({ x: 50, y: -50 });
		expect(parsePaper("A4")).toBe("a4");
		expect(parsePaper("a5")).toBe("a5");
		expect(parsePaper("A6")).toBe("a6");
		expect(parseCopies("10")).toBe(10);
		expect(parseCopies("Fill")).toBe("fill");
		expect(parsePaper("297x210")).toEqual({ widthMm: 210, heightMm: 297 });
		expect(parseMarks("Crop, registration,slug,crop")).toEqual([
			"crop",
			"registration",
			"slug",
		]);
		expect(parseMarks("none")).toEqual([]);
		expect(collectCutSpot(" Thru Cut ")).toEqual({ through: "Thru Cut" });
		expect(collectCutSpot("kiss=Kiss", { through: "A" })).toEqual({
			through: "A",
			kiss: "Kiss",
		});
	});

	test("refuse the rest with an ArgumentError", () => {
		const refusals: [() => unknown, string][] = [
			[() => collectSetting("name"), "Expected key=value."],
			[
				() => collectFilter("tier"),
				"Expected <column><op><value>, with = != ~ !~ < <= > or >= as the op.",
			],
			[() => collectScale("0"), "Expected a number from 1 to 4."],
			[() => collectScale("4.5"), "Expected a number from 1 to 4."],
			[() => parseScale(""), "Expected a number from 1 to 4."],
			[
				() => parseMaxEdge("0"),
				"Expected a whole number of pixels, 1 or more.",
			],
			[
				() => parseMaxEdge("1.5"),
				"Expected a whole number of pixels, 1 or more.",
			],
			[
				() => collectCutSpot("through=All"),
				'"All" is reserved by PDF for every or no plate; name the cut spot something else.',
			],
			[
				() => collectCutSpot("none"),
				'"none" is reserved by PDF for every or no plate; name the cut spot something else.',
			],
			[() => parseQuality("101"), "Expected a whole number from 0 to 100."],
			[() => parseJobs("1.5"), "Expected a whole number, 1 or more."],
			[() => parseLength("-1"), "Expected millimetres, 0 or more."],
			[
				() => parseOffset("1"),
				"Expected <x>,<y> in millimetres, such as 0.5,-1.",
			],
			[
				() => parseOffset("1,"),
				"Expected <x>,<y> in millimetres, such as 0.5,-1.",
			],
			[
				() => parseOffset("1,2,3"),
				"Expected <x>,<y> in millimetres, such as 0.5,-1.",
			],
			[
				() => parseOffset("500,0"),
				"Expected <x>,<y> each from -50 to 50 millimetres.",
			],
			[
				() => parseOffset("0,-50.5"),
				"Expected <x>,<y> each from -50 to 50 millimetres.",
			],
			[
				() => parseMarks("crop,bleed"),
				"Expected none, or a list of crop, registration, colorbar, slug.",
			],
			[
				() => parseMarks(""),
				"Expected none, or a list of crop, registration, colorbar, slug.",
			],
			[() => parseCopies("0"), "Expected a whole number, 1 or more, or fill."],
			[
				() => parseCopies("2.5"),
				"Expected a whole number, 1 or more, or fill.",
			],
			[
				() => collectCutSpot("fold=Fold"),
				'Expected through, kiss, score or perforate before =, got "fold".',
			],
			[() => collectCutSpot("score= "), "Expected a spot colour name."],
			[
				() => parsePaper("b5"),
				"Expected a4, a5, a6, letter, legal, a3, tabloid or <width>x<height> in millimetres.",
			],
		];
		for (const [parse, message] of refusals) {
			expect(parse).toThrow(ArgumentError);
			expect(parse).toThrow(message);
		}
	});
});
