import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import type { RectNode, Template } from "../src/types";
import { validate } from "../src/validate";

const stops = [
	{ offset: 0, color: "#ff0000" },
	{ offset: 1, color: "#0000ff" },
];

function withStroke(color: unknown): Template {
	return {
		format_version: "1.7",
		id: "s",
		name: "S",
		width: 100,
		height: 60,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements: [
					{
						id: "r",
						type: "rect",
						pos: { x: 10, y: 10 },
						size: { width: 80, height: 40 },
						properties: {
							stroke: { color, width: 4, dash: [6, 2] } as never,
						},
					},
				],
			},
		],
	};
}

function compiledStroke(color: unknown, width = 100) {
	const compiled = compile(
		withStroke(color),
		{},
		{ width, height: width * 0.6 },
	);
	return (compiled.frames[0].root.children[1] as RectNode).stroke;
}

describe("gradient stroke", () => {
	test("validates every gradient kind and a plain colour", () => {
		for (const color of [
			"#000",
			{ kind: "linear", angle: 0, stops },
			{ kind: "radial", center: [0.5, 0.5], radius: 0.5, stops },
			{ kind: "angular", center: [0.5, 0.5], rotation: 90, stops },
		])
			expect(validate(withStroke(color)).ok).toBe(true);
	});

	test("rejects patterns, lists, single stops and degenerate points", () => {
		for (const color of [
			{ kind: "pattern", pattern: "noise" },
			[{ kind: "linear", angle: 0, stops }],
			{ kind: "linear", angle: 0, stops: stops.slice(0, 1) },
			{ kind: "linear", angle: 0, from: [0, 0], to: [0, 0], stops },
		])
			expect(validate(withStroke(color)).ok).toBe(false);
	});

	test("a colour string compiles as before", () => {
		expect(compiledStroke("#123456")).toEqual({
			color: "#123456",
			width: 4,
			dash: [6, 2],
			cap: undefined,
			join: undefined,
			align: undefined,
		});
	});

	test("compiles each kind to the engine's gradient, first stop as the colour", () => {
		expect(compiledStroke({ kind: "linear", angle: 0, stops }, 200)).toEqual({
			color: "#ff0000",
			gradient: {
				kind: "linear",
				from: { x: 0, y: 0.5 },
				to: { x: 1, y: 0.5 },
				stops,
			},
			width: 8,
			dash: [12, 4],
			cap: undefined,
			join: undefined,
			align: undefined,
		});
		expect(
			compiledStroke({ kind: "radial", center: [0.25, 0.5], stops })?.gradient,
		).toEqual({
			kind: "radial",
			center: { x: 0.25, y: 0.5 },
			radius: 0.5,
			radiusY: 0.5,
			rotation: 0,
			stops,
		});
		expect(
			compiledStroke({ kind: "angular", rotation: 45, stops })?.gradient,
		).toEqual({
			kind: "angular",
			center: { x: 0.5, y: 0.5 },
			rotation: 45,
			stops,
		});
	});
});
