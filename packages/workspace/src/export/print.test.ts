import { YMCKO_DYE_SUB } from "@freshcoat-js/for-print";
import { describe, expect, it } from "vitest";
import {
	printProfileMismatch,
	printRenderOptions,
	printRequest,
} from "./print";

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

describe("print profile mismatch", () => {
	const profile = { name: "Printer" };

	it("is null when print is off, there is no profile, or the targets agree", () => {
		expect(printProfileMismatch(undefined)).toBeNull();
		expect(
			printProfileMismatch({
				enabled: false,
				profile: { ...profile, target: "x" },
			}),
		).toBeNull();
		expect(printProfileMismatch({ enabled: true })).toBeNull();
		expect(printProfileMismatch({ enabled: true, profile })).toBeNull();
		expect(
			printProfileMismatch({
				enabled: true,
				target: "other",
				profile: { ...profile, target: "other" },
			}),
		).toBeNull();
	});

	it("names both targets when the profile was measured on another", () => {
		expect(
			printProfileMismatch({
				enabled: true,
				profile: { ...profile, target: "other" },
			}),
		).toEqual({ profileTarget: "other", presetTarget: "ymcko-dye-sub" });
		expect(
			printProfileMismatch({ enabled: true, target: "other", profile }),
		).toEqual({ profileTarget: "ymcko-dye-sub", presetTarget: "other" });
	});
});
