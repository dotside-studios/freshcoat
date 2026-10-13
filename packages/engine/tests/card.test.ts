import { describe, expect, test } from "vitest";
import {
	CR80_LONG_MM,
	CR80_SHORT_MM,
	cr80Pixels,
	MM_PER_INCH,
} from "../src/card";

describe("cr80Pixels", () => {
	test("is 1012 x 638 at 300 dpi", () => {
		expect(cr80Pixels(300)).toEqual({ long: 1012, short: 638 });
	});

	test("covers the whole card at any density", () => {
		for (const dpi of [72, 150, 300, 600]) {
			const { long, short } = cr80Pixels(dpi);
			expect(long).toBeGreaterThanOrEqual((CR80_LONG_MM / MM_PER_INCH) * dpi);
			expect(long - 1).toBeLessThan((CR80_LONG_MM / MM_PER_INCH) * dpi);
			expect(short).toBeGreaterThanOrEqual((CR80_SHORT_MM / MM_PER_INCH) * dpi);
			expect(short - 1).toBeLessThan((CR80_SHORT_MM / MM_PER_INCH) * dpi);
		}
	});
});
