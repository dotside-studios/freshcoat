import { describe, expect, it } from "vitest";
import {
	addStop,
	colorAt,
	convertFill,
	fillsOf,
	fillsPatch,
	type Gradient,
	insertStop,
	linearPoints,
	moveStop,
	removeStop,
	reverseStops,
	rotateQuarter,
	withLinearAngle,
} from "../src/fills";
import type { Element } from "../src/types";

describe("fills of a layer", () => {
	const rect = {
		id: "r",
		type: "rect",
		properties: { fill: ["#111111", "#222222"] },
	} as Element;
	const text = {
		id: "t",
		type: "text",
		properties: { text: "Hi", color: "#333333" },
	} as unknown as Element;

	it("reads a shape's fill as a list and writes one back as a value", () => {
		expect(fillsOf(rect)).toEqual(["#111111", "#222222"]);
		expect(fillsPatch(rect, ["#ff0000"])).toEqual({ fill: "#ff0000" });
		expect(fillsPatch(rect, [])).toEqual({ fill: undefined });
		expect(fillsPatch(rect, ["#1", "#2"])).toEqual({ fill: ["#1", "#2"] });
	});

	it("reads text's color, and writes solids to color and gradients to fill", () => {
		expect(fillsOf(text)).toEqual(["#333333"]);
		expect(fillsPatch(text, ["#123456"])).toEqual({
			color: "#123456",
			fill: undefined,
		});
		const g = convertFill("#123456", "radial");
		expect(fillsPatch(text, [g])).toEqual({ fill: g });
		expect(fillsPatch(text, [])).toEqual({ color: undefined, fill: undefined });
	});
});

describe("gradient helpers", () => {
	const stops = [
		{ offset: 0, color: "#000000" },
		{ offset: 1, color: "#ff000080" },
	];

	it("converts a solid to a gradient fading to transparent and back", () => {
		const g = convertFill("#ff0000", "linear") as Gradient;
		expect(g).toEqual({
			kind: "linear",
			angle: 90,
			stops: [
				{ offset: 0, color: "#ff0000" },
				{ offset: 1, color: "#ff000000" },
			],
		});
		expect(convertFill(g, "solid")).toBe("#ff0000");
	});

	it("keeps gradients at two stops or more", () => {
		expect(addStop(stops).map((s) => s.offset)).toEqual([0, 0.5, 1]);
		expect(removeStop(stops, 0)).toEqual(stops);
		expect(removeStop(addStop(stops), 0)).toHaveLength(2);
	});

	it("interpolates colours between stops, alpha included", () => {
		expect(colorAt(stops, 0.5)).toBe("#800000c0");
		expect(colorAt(stops, -1)).toBe("#000000");
		expect(colorAt(stops, 2)).toBe("#ff000080");
		expect(
			colorAt(
				[
					{ offset: 0, color: "#000000" },
					{ offset: 1, color: "#ffffff" },
				],
				0.5,
			),
		).toBe("#808080");
		expect(
			colorAt([{ offset: 0, color: "{{c}}" }, ...stops.slice(1)], 0.2),
		).toBe("{{c}}");
	});

	it("inserts and moves stops keeping them in order", () => {
		const added = insertStop(stops, 0.25);
		expect(added.index).toBe(1);
		expect(added.stops[1]).toEqual({ offset: 0.25, color: "#400000df" });
		const moved = moveStop(added.stops, 0, 0.5);
		expect(moved.index).toBe(1);
		expect(moved.stops.map((s) => s.offset)).toEqual([0.25, 0.5, 1]);
	});

	it("reverses stops into rising offsets", () => {
		expect(
			reverseStops([...stops, { offset: 0.2, color: "#00ff00" }]).map(
				(s) => s.offset,
			),
		).toEqual([0, 0.8, 1]);
	});

	it("turns a linear gradient and its points a quarter clockwise", () => {
		const g: Gradient = {
			kind: "linear",
			angle: 0,
			from: [0, 0.5],
			to: [1, 0.5],
			stops,
		};
		expect(rotateQuarter(g)).toMatchObject({
			angle: 90,
			from: [0.5, 0],
			to: [0.5, 1],
		});
		expect(rotateQuarter({ kind: "linear", angle: 300, stops })).toMatchObject({
			angle: 30,
		});
	});

	it("points a gradient with points along a typed angle about their midpoint", () => {
		const g = withLinearAngle(
			{ kind: "linear", angle: 0, from: [0.2, 0.5], to: [0.6, 0.5], stops },
			90,
		);
		expect(g.kind === "linear" && g.from?.[0]).toBeCloseTo(0.4, 9);
		expect(g.kind === "linear" && g.from?.[1]).toBeCloseTo(0.3, 9);
		expect(g.kind === "linear" && g.to?.[1]).toBeCloseTo(0.7, 9);
	});

	it("places a linear gradient by its points, else its angle", () => {
		expect(
			linearPoints({ kind: "linear", angle: 0, from: [0, 0], to: [1, 1], stops }),
		).toEqual({ from: [0, 0], to: [1, 1] });
		const { from, to } = linearPoints({ kind: "linear", angle: 0, stops });
		expect(from).toEqual([0, 0.5]);
		expect(to).toEqual([1, 0.5]);
	});
});
