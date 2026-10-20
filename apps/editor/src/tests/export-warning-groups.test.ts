import { describe, expect, test } from "vitest";
import { warningGroups } from "~/export/checks";

describe("warningGroups", () => {
	test("groups by code, most files first, leaving lost spots to the spots check", () => {
		const low = { code: "image_low_dpi", message: "Image prints at 120 DPI" };
		const small = { code: "small_text", message: "Text is 4 pt" };
		const spot = { code: "spot_rasterized", message: "Spot colour Pink lost" };
		const groups = warningGroups([
			{ recordId: "r1", side: "front", warnings: [small, spot] },
			{ recordId: "r2", side: "front", warnings: [low] },
			{ recordId: "r2", side: "back", warnings: [low, spot] },
		]);
		expect(groups.map((g) => [g.code, g.count])).toEqual([
			["image_low_dpi", 2],
			["small_text", 1],
		]);
	});
});
