import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import { linearGradientAngle, linearGradientPoints } from "../src/gradient";
import { templateJsonSchema } from "../src/json-schema";
import type { Fill, RectNode, Template } from "../src/types";
import { validate } from "../src/validate";

function withFill(fill: Fill, nested = false): Template {
	const rect = {
		id: "r",
		type: "rect" as const,
		pos: { x: 10, y: 10 },
		size: { width: 80, height: 40 },
		properties: { fill },
	};
	return {
		format_version: "1.2",
		id: "g",
		name: "G",
		width: 100,
		height: 60,
		fields: { type: "object", properties: {} },
		template_data: [
			{
				name: "front",
				background: { id: "bg", type: "rect", properties: { fill: "#fff" } },
				elements: nested
					? [
							{
								id: "f",
								type: "frame",
								size: { width: 100, height: 60 },
								properties: { children: [rect] },
							},
						]
					: [rect],
			},
		],
	};
}

const stops = [
	{ offset: 0, color: "#000" },
	{ offset: 1, color: "#fff" },
];

function resolvedLinear(fill: Fill) {
	const compiled = compile(withFill(fill), {}, { width: 100, height: 60 });
	const rect = compiled.frames[0].root.children[1] as RectNode;
	return rect.fills?.[0];
}

describe("linear gradient points", () => {
	test("from and to resolve exactly, overriding angle", () => {
		expect(
			resolvedLinear({
				kind: "linear",
				angle: 0,
				from: [0.1, 0.9],
				to: [1.25, -0.5],
				stops,
			}),
		).toEqual({
			kind: "linear",
			stops,
			from: { x: 0.1, y: 0.9 },
			to: { x: 1.25, y: -0.5 },
		});
	});

	test("an angle-only fill resolves through the centre as before", () => {
		const right = resolvedLinear({ kind: "linear", angle: 0, stops });
		expect(right).toEqual({
			kind: "linear",
			stops,
			from: { x: 0, y: 0.5 },
			to: { x: 1, y: 0.5 },
		});
		const down = resolvedLinear({ kind: "linear", angle: 90, stops });
		if (down?.kind !== "linear") throw new Error("expected linear");
		expect(down.from.x).toBeCloseTo(0.5, 12);
		expect(down.from.y).toBeCloseTo(0, 12);
		expect(down.to.x).toBeCloseTo(0.5, 12);
		expect(down.to.y).toBeCloseTo(1, 12);
	});

	test("only one of from and to falls back to angle", () => {
		const r = resolvedLinear({ kind: "linear", angle: 0, from: [0, 0], stops });
		expect(r).toMatchObject({ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } });
	});

	test("points outside the box validate", () => {
		const v = validate(
			withFill({ kind: "linear", angle: 0, from: [-2, 0.5], to: [3, 0.5], stops }),
		);
		expect(v.ok).toBe(true);
	});

	test("equal points are gradient_degenerate, nested or not", () => {
		for (const nested of [false, true]) {
			const v = validate(
				withFill(
					{ kind: "linear", angle: 0, from: [0.3, 0.3], to: [0.3, 0.3], stops },
					nested,
				),
			);
			expect(v.ok).toBe(false);
			if (!v.ok) {
				expect(v.errors.map((e) => e.code)).toContain("gradient_degenerate");
			}
		}
	});

	test("non-finite points are rejected", () => {
		const v = validate(
			withFill({
				kind: "linear",
				angle: 0,
				from: [0, Number.POSITIVE_INFINITY],
				to: [1, 1],
				stops,
			}),
		);
		expect(v.ok).toBe(false);
	});

	test("angle and points convert both ways", () => {
		for (const angle of [0, 30, 90, 135, 180, 270, 315]) {
			const { from, to } = linearGradientPoints(angle);
			expect(linearGradientAngle(from, to)).toBeCloseTo(angle, 9);
		}
		expect(linearGradientAngle([0, 0], [0, -1])).toBeCloseTo(270, 9);
	});

	test("the JSON Schema carries the points", () => {
		const text = JSON.stringify(templateJsonSchema());
		expect(text).toContain('"from"');
		expect(text).toContain('"to"');
	});
});
