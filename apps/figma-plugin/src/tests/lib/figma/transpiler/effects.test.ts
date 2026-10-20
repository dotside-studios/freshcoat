import { describe, expect, it } from "vitest";
import { extractEffects, noiseAmount } from "~/lib/figma/transpiler/effects";
import type { FigmaEffect } from "~/lib/figma/types";

describe("extractEffects", () => {
	it("returns empty when effects is undefined", () => {
		expect(extractEffects(undefined, 1)).toEqual({});
	});

	it("DROP_SHADOW → shadow with scaled offsets + blur", () => {
		const fx = extractEffects(
			[
				{
					type: "DROP_SHADOW",
					visible: true,
					color: { r: 0, g: 0, b: 0, a: 0.4 },
					offset: { x: 0, y: 4 },
					radius: 8,
				},
			],
			2,
		);
		expect(fx.effects).toEqual([
			{
				type: "shadow",
				color: "rgba(0, 0, 0, 0.4)",
				dx: 0,
				dy: 8,
				blur: 16,
			},
		]);
	});

	it("opaque shadow color emits hex (no rgba)", () => {
		const fx = extractEffects(
			[
				{
					type: "DROP_SHADOW",
					visible: true,
					color: { r: 0, g: 0, b: 0, a: 1 },
					offset: { x: 0, y: 0 },
					radius: 4,
				},
			],
			1,
		);
		expect(fx.effects).toMatchObject([{ color: "#000000" }]);
	});

	it("LAYER_BLUR → blur scaled with ratio", () => {
		const fx = extractEffects(
			[{ type: "LAYER_BLUR", visible: true, radius: 6 }],
			2,
		);
		expect(fx.effects).toEqual([{ type: "blur", radius: 12 }]);
	});

	it("BACKGROUND_BLUR → backdropBlur scaled with ratio", () => {
		const fx = extractEffects(
			[
				{ type: "BACKGROUND_BLUR", visible: true, radius: 8 },
				{ type: "BACKGROUND_BLUR", visible: true, radius: 2 },
			],
			2,
		);
		expect(fx.effects).toEqual([{ type: "backdropBlur", radius: 16 }]);
	});

	it("a hidden BACKGROUND_BLUR stays in the list as hidden", () => {
		const fx = extractEffects(
			[{ type: "BACKGROUND_BLUR", visible: false, radius: 8 }],
			1,
		);
		expect(fx.effects).toEqual([
			{ type: "backdropBlur", radius: 8, hidden: true },
		]);
	});

	it("INNER_SHADOW becomes an inset shadow beside a BACKGROUND_BLUR", () => {
		const fx = extractEffects(
			[
				{
					type: "INNER_SHADOW",
					visible: true,
					radius: 4,
					spread: 2,
					offset: { x: 0, y: 1 },
					color: { r: 1, g: 1, b: 1, a: 1 },
				},
				{ type: "BACKGROUND_BLUR", visible: true, radius: 8 },
			],
			1,
		);
		expect(fx.effects).toEqual([
			{
				type: "shadow",
				color: "#ffffff",
				dx: 0,
				dy: 1,
				blur: 4,
				spread: 2,
				inset: true,
			},
			{ type: "backdropBlur", radius: 8 },
		]);
	});

	it("scales spread with the ratio like every other length", () => {
		const fx = extractEffects(
			[
				{
					type: "DROP_SHADOW",
					visible: true,
					radius: 4,
					spread: 3,
					offset: { x: 0, y: 0 },
					color: { r: 0, g: 0, b: 0, a: 1 },
				},
			],
			2,
		);
		expect(fx.effects).toMatchObject([{ blur: 8, spread: 6 }]);
	});

	it("an invisible effect is kept as hidden", () => {
		const fx = extractEffects(
			[
				{
					type: "DROP_SHADOW",
					visible: false,
					color: { r: 0, g: 0, b: 0, a: 1 },
					offset: { x: 0, y: 4 },
					radius: 8,
				},
			],
			1,
		);
		expect(fx.effects).toEqual([
			{
				type: "shadow",
				color: "#000000",
				dx: 0,
				dy: 4,
				blur: 8,
				hidden: true,
			},
		]);
	});

	it("keeps only the first layer blur and background blur", () => {
		const fx = extractEffects(
			[
				{ type: "LAYER_BLUR", visible: true, radius: 2 },
				{ type: "LAYER_BLUR", visible: true, radius: 5 },
				{ type: "BACKGROUND_BLUR", visible: true, radius: 3 },
				{ type: "BACKGROUND_BLUR", visible: true, radius: 6 },
			],
			1,
		);
		expect(fx.effects).toEqual([
			{ type: "blur", radius: 2 },
			{ type: "backdropBlur", radius: 3 },
		]);
	});

	it("multiple shadows come across as a stack, in Figma's own order", () => {
		const fx = extractEffects(
			[
				{
					type: "DROP_SHADOW",
					visible: true,
					color: { r: 0, g: 0, b: 0, a: 1 },
					offset: { x: 0, y: 2 },
					radius: 4,
				},
				{
					type: "DROP_SHADOW",
					visible: true,
					color: { r: 1, g: 0, b: 0, a: 1 },
					offset: { x: 0, y: 8 },
					radius: 16,
				},
			],
			1,
		);
		expect(fx.effects).toEqual([
			{ type: "shadow", color: "#000000", dx: 0, dy: 2, blur: 4 },
			{ type: "shadow", color: "#ff0000", dx: 0, dy: 8, blur: 16 },
		]);
	});
});

describe("extractEffects (rotated elements)", () => {
	const shadow = [
		{
			type: "DROP_SHADOW" as const,
			visible: true,
			color: { r: 0, g: 0, b: 0, a: 1 },
			offset: { x: 0, y: 4 },
			radius: 8,
		},
	];

	// Figma measures the offset on the CANVAS; the painter applies the shadow
	// inside the rotation it wraps the element in. Left alone, a card turned 90°
	// exports every shadow pointing sideways.
	it("expresses the offset in the element's own frame", () => {
		expect(extractEffects(shadow, 1, 90).effects).toEqual([
			{ type: "shadow", color: "#000000", dx: 4, dy: 0, blur: 8 },
		]);
		expect(extractEffects(shadow, 1, -90).effects).toEqual([
			{ type: "shadow", color: "#000000", dx: -4, dy: 0, blur: 8 },
		]);
		expect(extractEffects(shadow, 1, 180).effects).toEqual([
			{ type: "shadow", color: "#000000", dx: 0, dy: -4, blur: 8 },
		]);
	});

	it("leaves an unrotated element's offset exactly as authored", () => {
		expect(extractEffects(shadow, 1).effects).toEqual([
			{ type: "shadow", color: "#000000", dx: 0, dy: 4, blur: 8 },
		]);
	});

	it("scales the offset before un-rotating it", () => {
		expect(extractEffects(shadow, 2, 90).effects).toMatchObject([
			{ dx: 8, dy: 0, blur: 16 },
		]);
	});
});

describe("extractEffects (duplicate blurs)", () => {
	const cases = [
		["LAYER_BLUR", "blur"],
		["BACKGROUND_BLUR", "backdropBlur"],
	] as const;
	describe.each(cases)("%s", (figma, kind) => {
		const fx = (radius: number, visible = true): FigmaEffect => ({
			type: figma,
			visible,
			radius,
		});

		it("exports the visible blur after a hidden one", () => {
			const out = extractEffects([fx(2, false), fx(5)], 1);
			expect(out.effects).toEqual([{ type: kind, radius: 5 }]);
			expect(out.droppedBlurs).toEqual([kind]);
		});

		it("exports the visible blur before a hidden one", () => {
			const out = extractEffects([fx(5), fx(2, false)], 1);
			expect(out.effects).toEqual([{ type: kind, radius: 5 }]);
			expect(out.droppedBlurs).toEqual([kind]);
		});

		it("exports the first of two visible blurs", () => {
			const out = extractEffects([fx(5), fx(9)], 1);
			expect(out.effects).toEqual([{ type: kind, radius: 5 }]);
			expect(out.droppedBlurs).toEqual([kind]);
		});

		it("keeps the first hidden blur when none is visible", () => {
			const out = extractEffects([fx(2, false), fx(9, false)], 1);
			expect(out.effects).toEqual([{ type: kind, radius: 2, hidden: true }]);
			expect(out.droppedBlurs).toEqual([kind]);
		});

		it("keeps the chosen blur where it sits among other effects", () => {
			const shadow: FigmaEffect = { type: "DROP_SHADOW", radius: 1 };
			const out = extractEffects([fx(2, false), shadow, fx(5)], 1);
			expect(out.effects?.map((e) => e.type)).toEqual(["shadow", kind]);
		});

		it("reports nothing for a single blur", () => {
			expect(extractEffects([fx(5)], 1).droppedBlurs).toBeUndefined();
		});
	});

	it("keeps one blur of each kind", () => {
		const out = extractEffects(
			[
				{ type: "LAYER_BLUR", radius: 1 },
				{ type: "BACKGROUND_BLUR", radius: 2 },
			],
			1,
		);
		expect(out.effects).toHaveLength(2);
		expect(out.droppedBlurs).toBeUndefined();
	});
});

describe("extractEffects (noise)", () => {
	const noise = (overrides: Partial<FigmaEffect> = {}): FigmaEffect => ({
		type: "NOISE",
		noiseType: "MONOTONE",
		visible: true,
		color: { r: 0, g: 0, b: 0, a: 1 },
		noiseSize: 2,
		density: 1,
		...overrides,
	});

	it("maps a monotone noise to grain, its size scaled", () => {
		expect(extractEffects([noise()], 2).effects).toEqual([
			{ type: "grain", amount: 1, size: 4, blendMode: "normal" },
		]);
	});

	it.each([
		["NORMAL", "normal"],
		["OVERLAY", "overlay"],
		["SOFT_LIGHT", "soft-light"],
		["MULTIPLY", "multiply"],
		["SCREEN", "screen"],
	] as const)("carries the %s blend mode", (figma, grain) => {
		const [e] =
			extractEffects(
				[noise({ blendMode: figma, color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } })],
				1,
			).effects ?? [];
		expect(e).toMatchObject({ type: "grain", blendMode: grain });
	});

	it("scales the amount by alpha times the root of the density", () => {
		const [full] = extractEffects([noise()], 1).effects ?? [];
		const [faint] =
			extractEffects(
				[noise({ color: { r: 0, g: 0, b: 0, a: 0.5 }, density: 0.25 })],
				1,
			).effects ?? [];
		expect(full).toMatchObject({ amount: 1 });
		expect(faint).toMatchObject({ amount: 0.363 });
	});

	it("leaves out a noise it cannot map, and a hidden one", () => {
		expect(
			extractEffects(
				[
					noise({ color: { r: 1, g: 0, b: 0, a: 1 } }),
					noise({ noiseType: "DUOTONE" }),
					noise({ noiseSizeVector: { x: 2, y: 3 } }),
					noise({ blendMode: "COLOR_BURN" }),
					noise({ visible: false }),
				],
				1,
			),
		).toEqual({});
	});

	it("keeps only the first grain", () => {
		const fx = extractEffects([noise(), noise({ blendMode: "SCREEN" })], 1);
		expect(fx.effects).toHaveLength(1);
	});
});

describe("noiseAmount", () => {
	it("is 0 where Figma's noise leaves every tone alone", () => {
		expect(noiseAmount(1, 1, 1, "multiply")).toBeCloseTo(0, 9);
		expect(noiseAmount(0, 1, 1, "screen")).toBeCloseTo(0, 9);
		expect(noiseAmount(0.5, 1, 1, "overlay")).toBeCloseTo(0, 9);
		expect(noiseAmount(0.5, 1, 1, "soft-light")).toBeCloseTo(0, 9);
	});

	it("weakens a mid-grey normal noise against a black one", () => {
		expect(noiseAmount(0.5, 1, 1, "normal")).toBeCloseTo(0.667, 3);
		expect(noiseAmount(0, 1, 1, "normal")).toBe(1);
	});

	it("never passes 1", () => {
		expect(noiseAmount(0, 1, 4, "overlay")).toBe(1);
	});
});
