import { describe, expect, test } from "vitest";
import {
	CR80_LONG,
	CR80_SHORT,
	cr80Dimensions,
	defaultCropRegion,
	detectOrientation,
	fitCr80CropToImage,
} from "../src/geometry";

describe("geometry", () => {
	test("detectOrientation by aspect", () => {
		expect(detectOrientation(2000, 1000)).toBe("landscape");
		expect(detectOrientation(1000, 2000)).toBe("portrait");
		expect(detectOrientation(500, 500)).toBe("landscape"); // square -> landscape
	});

	test("cr80Dimensions swaps by orientation", () => {
		expect(cr80Dimensions("landscape")).toEqual({
			width: CR80_LONG,
			height: CR80_SHORT,
		});
		expect(cr80Dimensions("portrait")).toEqual({
			width: CR80_SHORT,
			height: CR80_LONG,
		});
	});

	test("fitCr80CropToImage centers a wide image horizontally", () => {
		// 2000x1000 is wider than CR80 landscape aspect (~1.586): crop width.
		const crop = fitCr80CropToImage(2000, 1000);
		expect(crop.orientation).toBe("landscape");
		expect(crop.height).toBe(1);
		expect(crop.width).toBeLessThan(1);
		expect(crop.width).toBeGreaterThan(0);
		// symmetric horizontal inset
		expect(crop.x).toBeCloseTo((1 - crop.width) / 2, 10);
		expect(crop.y).toBe(0);
	});

	test("fitCr80CropToImage centers a tall image vertically", () => {
		// 1000x2000 portrait, taller than CR80 portrait aspect: crop height.
		const crop = fitCr80CropToImage(1000, 2000);
		expect(crop.orientation).toBe("portrait");
		expect(crop.width).toBe(1);
		expect(crop.height).toBeLessThan(1);
		expect(crop.y).toBeCloseTo((1 - crop.height) / 2, 10);
		expect(crop.x).toBe(0);
	});

	test("defaultCropRegion is the full frame", () => {
		expect(defaultCropRegion()).toEqual({
			x: 0,
			y: 0,
			width: 1,
			height: 1,
			orientation: "landscape",
		});
	});
});
