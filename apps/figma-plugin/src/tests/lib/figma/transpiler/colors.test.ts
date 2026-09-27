import { linearGradientAngle } from "@freshcoat-js/coatfile";
import { describe, expect, it } from "vitest";
import {
	figmaColorToHex,
	figmaPaintToFill,
} from "~/lib/figma/transpiler/colors";
import type { FigmaGradientPaint, FigmaSolidPaint } from "~/lib/figma/types";

describe("figmaColorToHex", () => {
	it("converts opaque color to #RRGGBB", () => {
		expect(figmaColorToHex({ r: 1, g: 0, b: 0, a: 1 })).toBe("#ff0000");
	});

	it("rounds floating channels", () => {
		expect(figmaColorToHex({ r: 0.5, g: 0.5, b: 0.5, a: 1 })).toBe("#808080");
	});

	it("preserves alpha when not 1", () => {
		expect(figmaColorToHex({ r: 1, g: 0, b: 0, a: 0.5 })).toBe("#ff000080");
	});
});

describe("figmaPaintToFill (solid)", () => {
	it("returns string hex for opaque solid", () => {
		const paint: FigmaSolidPaint = {
			type: "SOLID",
			color: { r: 0, g: 0, b: 0, a: 1 },
		};
		expect(figmaPaintToFill(paint)).toEqual({
			kind: "solid",
			hex: "#000000",
			opacity: 1,
		});
	});

	it("hoists alpha into opacity for translucent solid", () => {
		const paint: FigmaSolidPaint = {
			type: "SOLID",
			color: { r: 1, g: 1, b: 1, a: 0.5 },
			opacity: 0.8,
		};
		// paint-level opacity multiplies channel alpha
		expect(figmaPaintToFill(paint)).toEqual({
			kind: "solid",
			hex: "#ffffff",
			opacity: 0.4,
		});
	});
});

describe("figmaPaintToFill (linear gradient)", () => {
	const stops: FigmaGradientPaint["gradientStops"] = [
		{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
		{ position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
	];
	const linear = (
		start: { x: number; y: number },
		end: { x: number; y: number },
	): FigmaGradientPaint => ({
		type: "GRADIENT_LINEAR",
		gradientHandlePositions: [start, end, { x: start.x, y: start.y + 0.5 }],
		gradientStops: stops,
	});

	it("writes the handles as from/to, with the angle pointing along them", () => {
		const fill = figmaPaintToFill(linear({ x: 0, y: 0.5 }, { x: 1, y: 0.5 }));
		expect(fill).toEqual({
			kind: "fill",
			value: {
				kind: "linear",
				angle: 0,
				from: [0, 0.5],
				to: [1, 0.5],
				stops: [
					{ offset: 0, color: "#ff0000" },
					{ offset: 1, color: "#0000ff" },
				],
			},
		});
	});

	it("keeps a short, off-centre gradient's length and offset", () => {
		const fill = figmaPaintToFill(
			linear({ x: 0.6, y: 0.2 }, { x: 0.8, y: 0.4 }),
		);
		expect(fill).toMatchObject({
			value: { from: [0.6, 0.2], to: [0.8, 0.4] },
		});
	});

	it("computes the angle with coatfile's linearGradientAngle", () => {
		const from: [number, number] = [0.9, 0.1];
		const to: [number, number] = [0.2, 0.7];
		const fill = figmaPaintToFill(
			linear({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }),
		);
		expect(fill.kind === "fill" && fill.value.kind === "linear").toBe(true);
		if (fill.kind !== "fill" || fill.value.kind !== "linear") return;
		expect(fill.value.angle).toBeCloseTo(linearGradientAngle(from, to), 2);
		// Top to bottom is 90 in coatfile's convention: 0 right, 90 down.
		const down = figmaPaintToFill(linear({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }));
		expect(down).toMatchObject({ value: { angle: 90 } });
	});

	it("rounds the points to four places", () => {
		const fill = figmaPaintToFill(
			linear({ x: 0.123456, y: 0.5 }, { x: 0.987654, y: 0.5 }),
		);
		expect(fill).toMatchObject({
			value: { from: [0.1235, 0.5], to: [0.9877, 0.5] },
		});
	});

	it("falls back to the angle only when the handles coincide", () => {
		const fill = figmaPaintToFill(
			linear({ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 }),
		);
		expect(fill).toEqual({
			kind: "fill",
			value: {
				kind: "linear",
				angle: 0,
				stops: [
					{ offset: 0, color: "#ff0000" },
					{ offset: 1, color: "#0000ff" },
				],
			},
		});
	});
});

describe("figmaPaintToFill (radial gradient)", () => {
	it("extracts center from first handle", () => {
		const paint: FigmaGradientPaint = {
			type: "GRADIENT_RADIAL",
			gradientHandlePositions: [
				{ x: 0.5, y: 0.5 },
				{ x: 1.0, y: 0.5 },
				{ x: 0.5, y: 1.0 },
			],
			gradientStops: [
				{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
				{ position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
			],
		};
		const fill = figmaPaintToFill(paint, { width: 400, height: 400 });
		expect(fill).toEqual({
			kind: "fill",
			value: {
				kind: "radial",
				center: [0.5, 0.5],
				radius: 0.5,
				stops: [
					{ offset: 0, color: "#ffffff" },
					{ offset: 1, color: "#000000" },
				],
			},
		});
	});

	const radial = (
		handles: Array<{ x: number; y: number }>,
	): FigmaGradientPaint => ({
		type: "GRADIENT_RADIAL",
		gradientHandlePositions: handles,
		gradientStops: [
			{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
			{ position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
		],
	});

	const radiusOf = (
		handles: Array<{ x: number; y: number }>,
		box?: { width: number; height: number },
	): number | undefined => {
		const fill = figmaPaintToFill(radial(handles), box);
		return fill.kind === "fill" && fill.value.kind === "radial"
			? fill.value.radius
			: undefined;
	};

	const AXIS_ALIGNED = [
		{ x: 0.5, y: 0.5 },
		{ x: 1, y: 0.5 },
		{ x: 0.5, y: 1 },
	];

	it("reports 0.5 for a gradient that just fills its shape, either orientation", () => {
		// The reach every template written before `radius` existed assumed, so a
		// full-bleed gradient must keep rendering exactly as it did.
		expect(radiusOf(AXIS_ALIGNED, { width: 800, height: 200 })).toBeCloseTo(
			0.5,
		);
		expect(radiusOf(AXIS_ALIGNED, { width: 200, height: 800 })).toBeCloseTo(
			0.5,
		);
	});

	it("carries a gradient that reaches past its shape", () => {
		// Handles well outside the box: the glow keeps fading long after the
		// shape's edge, which a fixed 0.5 renders as a hard-edged disc instead.
		expect(
			radiusOf(
				[
					{ x: 0.5, y: 0.5 },
					{ x: 1.5, y: 0.5 },
					{ x: 0.5, y: 1.5 },
				],
				{ width: 400, height: 400 },
			),
		).toBeCloseTo(1);
	});

	it("scales each handle by its own axis before comparing them", () => {
		// x is normalized by the width and y by the height, so on a wide box the
		// same normalized offset is a much longer reach horizontally.
		expect(
			radiusOf(
				[
					{ x: 0.5, y: 0.5 },
					{ x: 0.75, y: 0.5 },
					{ x: 0.5, y: 1 },
				],
				{ width: 1000, height: 100 },
			),
		).toBeCloseTo(0.25);
	});

	it("treats the handles as isotropic when no box is given", () => {
		expect(radiusOf(AXIS_ALIGNED)).toBeCloseTo(0.5);
	});

	const shapeOf = (
		handles: Array<{ x: number; y: number }>,
		box?: { width: number; height: number },
	) => {
		const fill = figmaPaintToFill(radial(handles), box);
		if (fill.kind !== "fill" || fill.value.kind !== "radial") throw new Error();
		return fill.value;
	};

	it("leaves radiusY and rotation off a circular gradient", () => {
		// A circle looks the same at every angle, so saying so twice is noise.
		const v = shapeOf(AXIS_ALIGNED, { width: 400, height: 400 });
		expect(v.radiusY).toBeUndefined();
		expect(v.rotation).toBeUndefined();
	});

	it("carries the secondary reach of an elliptical gradient", () => {
		// The certificate's fog: a tall narrow glow reaching far above the shape
		// and barely past its sides. Collapsed to a circle it washes sideways
		// across the whole design.
		const v = shapeOf(
			[
				{ x: 0.5, y: 0.5 },
				{ x: 0.5, y: 3 },
				{ x: 0.7, y: 0.5 },
			],
			{ width: 500, height: 500 },
		);
		// The longer axis leads, so `radius` stays the gradient's reach...
		expect(v.radius).toBeCloseTo(2.5);
		expect(v.radiusY).toBeCloseTo(0.2);
		// ...and rotation is the angle it reaches along — here, straight down.
		expect(v.rotation).toBeCloseTo(90);
	});

	it("treats a half turn as no rotation, float noise and all", () => {
		// An ellipse is symmetric about its centre, so 180 degrees lands it back on
		// itself. Figma's transforms carry noise — the certificate's fog arrives at
		// 179.99999999999932 — so an exact test leaves every axis-aligned gradient
		// claiming to be turned.
		const v = shapeOf(
			[
				{ x: 0.5, y: 0.5 },
				{ x: 0.5, y: 1.5 },
				// A hair off dead-left, exactly as the fog's handles come through.
				{ x: -1.5, y: 0.5 + 1e-14 },
			],
			{ width: 1080, height: 601 },
		);
		expect(v.radiusY).toBeDefined();
		expect(v.rotation).toBeUndefined();
	});

	it("reports an axis-aligned ellipse without a rotation", () => {
		// Primary along +x: nothing to turn, so the field stays off.
		const v = shapeOf(
			[
				{ x: 0.5, y: 0.5 },
				{ x: 1.5, y: 0.5 },
				{ x: 0.5, y: 0.75 },
			],
			{ width: 400, height: 400 },
		);
		expect(v.radius).toBeCloseTo(1);
		expect(v.radiusY).toBeCloseTo(0.25);
		expect(v.rotation).toBeUndefined();
	});

	it("folds a gradient paint's own opacity into every stop", () => {
		// A gradient has no single colour to hang paint opacity on, so dropping it
		// paints a half-faded wash at full strength.
		const fill = figmaPaintToFill({
			type: "GRADIENT_RADIAL",
			opacity: 0.5,
			gradientHandlePositions: AXIS_ALIGNED,
			gradientStops: [
				{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
				{ position: 1, color: { r: 0, g: 0, b: 0, a: 0.5 } },
			],
		} as FigmaGradientPaint);
		if (fill.kind !== "fill" || fill.value.kind !== "radial") throw new Error();
		expect(fill.value.stops.map((s) => s.color)).toEqual([
			"#ffffff80",
			"#00000040",
		]);
	});
});
