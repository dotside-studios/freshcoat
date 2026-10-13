import { YMCKO_DYE_SUB } from "@freshcoat-js/for-print";
import { describe, expect, it } from "vitest";
import { printRenderOptions, printRequest } from "./print";

describe("print target", () => {
	it("is left to the default when the preset names none", () => {
		expect(printRequest({ enabled: true })).toEqual({ analyze: true });
		expect(printRenderOptions({ analyze: true })).toEqual({ analyze: true });
	});

	it("resolves a named target", () => {
		expect(printRequest({ enabled: true, target: "ymcko-dye-sub" })).toEqual({
			analyze: true,
			target: "ymcko-dye-sub",
		});
		expect(
			printRenderOptions({ analyze: true, target: "ymcko-dye-sub" }).target,
		).toBe(YMCKO_DYE_SUB);
	});

	it("refuses a target this build does not know", () => {
		expect(() =>
			printRenderOptions({ analyze: true, target: "unknown" }),
		).toThrow('Unknown print target "unknown"');
	});
});
