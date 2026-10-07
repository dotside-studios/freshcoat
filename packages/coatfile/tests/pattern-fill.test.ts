import { PATTERN_DEFAULTS } from "@freshcoat-js/engine";
import { describe, expect, test } from "vitest";
import { compile } from "../src/compile";
import type { Fill, RectNode, Template } from "../src/types";
import { validate } from "../src/validate";

function withFill(fill: unknown): Template {
	return {
		format_version: "1.7",
		id: "p",
		name: "P",
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
						properties: { fill: fill as Fill },
					},
				],
			},
		],
	};
}

function resolved(fill: Fill, width = 100) {
	const compiled = compile(withFill(fill), {}, { width, height: width * 0.6 });
	const rect = compiled.frames[0].root.children[1] as RectNode;
	return rect.fills?.[0];
}

describe("pattern fill", () => {
	test("validates every kind", () => {
		for (const pattern of ["noise", "paper", "hatching", "dots"] as const)
			expect(validate(withFill({ kind: "pattern", pattern })).ok).toBe(true);
	});

	test("rejects unknown patterns and out-of-range parameters", () => {
		for (const fill of [
			{ kind: "pattern", pattern: "plaid" },
			{ kind: "pattern", pattern: "dots", scale: 0 },
			{ kind: "pattern", pattern: "dots", density: 1.5 },
			{ kind: "pattern", pattern: "noise", seed: 0.5 },
			{ kind: "pattern", pattern: "noise", colors: ["#fff"] },
		])
			expect(validate(withFill(fill)).ok).toBe(false);
	});

	test("compiles with the pattern's defaults", () => {
		expect(resolved({ kind: "pattern", pattern: "hatching" })).toEqual({
			kind: "pattern",
			pattern: "hatching",
			...PATTERN_DEFAULTS.hatching,
		});
	});

	test("keeps authored parameters", () => {
		expect(
			resolved({
				kind: "pattern",
				pattern: "noise",
				scale: 3,
				angle: 20,
				density: 0.7,
				seed: 9,
				colors: ["#000", "#fff"],
			}),
		).toEqual({
			kind: "pattern",
			pattern: "noise",
			scale: 3,
			angle: 20,
			density: 0.7,
			seed: 9,
			colors: ["#000", "#fff"],
		});
	});

	test("scale follows the target size like other lengths", () => {
		const fill: Fill = { kind: "pattern", pattern: "dots", scale: 10 };
		expect(resolved(fill, 300)).toMatchObject({ scale: 30 });
		expect(resolved(fill, 50)).toMatchObject({ scale: 5 });
	});
});
