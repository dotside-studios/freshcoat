import { describe, expect, it } from "vitest";
import {
	clampRasterScale,
	RASTER_DENSITY,
	RASTER_MAX_DIMENSION,
	rasterScaleFor,
} from "~/lib/figma/transpiler/raster-scale";

describe("rasterScaleFor", () => {
	it("exports at the base density when the design measures the canvas", () => {
		expect(rasterScaleFor(1)).toBe(RASTER_DENSITY);
	});

	it("scales the export up for a design drawn smaller than the canvas", () => {
		// The bug this guards: a card mocked at half the product's print size got
		// a flat 3x export, landing 1.5 bitmap pixels per author unit on a card
		// that prints at its native pixels — visibly soft.
		expect(rasterScaleFor(2)).toBe(RASTER_DENSITY * 2);
		expect(rasterScaleFor(3)).toBe(RASTER_DENSITY * 3);
	});

	it("scales the export down for a design drawn larger than the canvas", () => {
		expect(rasterScaleFor(0.5)).toBe(RASTER_DENSITY / 2);
	});

	it("falls back to the base density for a nonsense scale", () => {
		expect(rasterScaleFor(0)).toBe(RASTER_DENSITY);
		expect(rasterScaleFor(-1)).toBe(RASTER_DENSITY);
		expect(rasterScaleFor(Number.NaN)).toBe(RASTER_DENSITY);
	});
});

describe("clampRasterScale", () => {
	it("leaves a scale alone when both exported axes fit", () => {
		expect(clampRasterScale(3, 200, 100)).toBe(3);
	});

	it("clamps on the longest axis so exportAsync doesn't reject outright", () => {
		const clamped = clampRasterScale(6, 2000, 500);
		expect(clamped).toBe(RASTER_MAX_DIMENSION / 2000);
		expect(clamped * 2000).toBeLessThanOrEqual(RASTER_MAX_DIMENSION);
	});

	it("clamps on height when that is the longest axis", () => {
		expect(clampRasterScale(6, 500, 2048)).toBe(RASTER_MAX_DIMENSION / 2048);
	});

	it("leaves a scale alone for a node with no measurable size", () => {
		expect(clampRasterScale(3, 0, 0)).toBe(3);
	});
});
