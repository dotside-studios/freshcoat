import { describe, expect, it } from "vitest";
import { exportPoolSize } from "./job";

describe("exportPoolSize", () => {
	it("is a worker per core but one, at most four, one per GB", () => {
		expect(exportPoolSize({ cores: 8, memoryGb: 8 })).toBe(4);
		expect(exportPoolSize({ cores: 4, memoryGb: 8 })).toBe(3);
		expect(exportPoolSize({ cores: 16, memoryGb: 2 })).toBe(2);
		expect(exportPoolSize({ cores: 1 })).toBe(1);
		expect(exportPoolSize({ cores: 8, memoryGb: 0.5 })).toBe(1);
		// no deviceMemory reads as 4 GB, no cores as 2
		expect(exportPoolSize({ cores: 16 })).toBe(4);
		expect(exportPoolSize({})).toBe(1);
	});

	it("caps at two workers when an image is over 24 MP", () => {
		expect(
			exportPoolSize({ cores: 8, memoryGb: 8, largestImagePixels: 24e6 }),
		).toBe(4);
		expect(
			exportPoolSize({ cores: 8, memoryGb: 8, largestImagePixels: 24e6 + 1 }),
		).toBe(2);
		expect(
			exportPoolSize({ cores: 2, memoryGb: 8, largestImagePixels: 50e6 }),
		).toBe(1);
	});
});
