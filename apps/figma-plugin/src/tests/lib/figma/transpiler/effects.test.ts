import { describe, expect, it } from "vitest";
import { extractEffects } from "~/lib/figma/transpiler/effects";

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
		expect(fx.shadow).toEqual({
			color: "rgba(0, 0, 0, 0.4)",
			dx: 0,
			dy: 8,
			blur: 16,
		});
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
		expect((fx.shadow as { color: string }).color).toBe("#000000");
	});

	it("LAYER_BLUR → blur scaled with ratio", () => {
		const fx = extractEffects(
			[{ type: "LAYER_BLUR", visible: true, radius: 6 }],
			2,
		);
		expect(fx.blur).toBe(12);
	});

	it("BACKGROUND_BLUR → backdropBlur scaled with ratio", () => {
		const fx = extractEffects(
			[
				{ type: "BACKGROUND_BLUR", visible: true, radius: 8 },
				{ type: "BACKGROUND_BLUR", visible: true, radius: 2 },
			],
			2,
		);
		expect(fx.backdropBlur).toBe(16);
		expect(fx.blur).toBeUndefined();
	});

	it("a hidden BACKGROUND_BLUR is dropped", () => {
		const fx = extractEffects(
			[{ type: "BACKGROUND_BLUR", visible: false, radius: 8 }],
			1,
		);
		expect(fx.backdropBlur).toBeUndefined();
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
		expect(fx.shadow).toEqual({
			color: "#ffffff",
			dx: 0,
			dy: 1,
			blur: 4,
			spread: 2,
			inset: true,
		});
		expect(fx.blur).toBeUndefined();
		expect(fx.backdropBlur).toBe(8);
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
		expect(fx.shadow).toMatchObject({ blur: 8, spread: 6 });
	});

	it("invisible effects are skipped", () => {
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
		expect(fx).toEqual({});
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
		expect(fx.shadow).toEqual([
			{ color: "#000000", dx: 0, dy: 2, blur: 4 },
			{ color: "#ff0000", dx: 0, dy: 8, blur: 16 },
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
		expect(extractEffects(shadow, 1, 90).shadow).toEqual({
			color: "#000000",
			dx: 4,
			dy: 0,
			blur: 8,
		});
		expect(extractEffects(shadow, 1, -90).shadow).toEqual({
			color: "#000000",
			dx: -4,
			dy: 0,
			blur: 8,
		});
		expect(extractEffects(shadow, 1, 180).shadow).toEqual({
			color: "#000000",
			dx: 0,
			dy: -4,
			blur: 8,
		});
	});

	it("leaves an unrotated element's offset exactly as authored", () => {
		expect(extractEffects(shadow, 1).shadow).toEqual({
			color: "#000000",
			dx: 0,
			dy: 4,
			blur: 8,
		});
	});

	it("scales the offset before un-rotating it", () => {
		expect(extractEffects(shadow, 2, 90).shadow).toMatchObject({
			dx: 8,
			dy: 0,
			blur: 16,
		});
	});
});
