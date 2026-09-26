import { describe, expect, it } from "vitest";
import {
	colorwayLabel,
	slugFromLabel,
	uniqueVariantId,
} from "~/lib/figma/transpiler/variants";

describe("colorwayLabel", () => {
	it("extracts the label after `<Card> / `", () => {
		expect(colorwayLabel("Aurora Card / Amber", "Aurora Card")).toBe("Amber");
	});
	it("trims whitespace around the label", () => {
		expect(colorwayLabel("Aurora Card /  Sky ", "Aurora Card")).toBe("Sky");
	});
	it("returns null when the prefix is not this card", () => {
		expect(colorwayLabel("Other Card / Amber", "Aurora Card")).toBeNull();
	});
	it("returns null for a bare instance name (no ` / label`)", () => {
		expect(colorwayLabel("Aurora Card", "Aurora Card")).toBeNull();
	});
	it("returns null for a Figma auto-suffixed duplicate", () => {
		expect(colorwayLabel("Aurora Card 2", "Aurora Card")).toBeNull();
	});
	it("keeps a multi-part label intact", () => {
		expect(colorwayLabel("Aurora Card / Amber / L", "Aurora Card")).toBe(
			"Amber / L",
		);
	});
});

describe("slugFromLabel", () => {
	it("lowercases and dashes", () => {
		expect(slugFromLabel("Amber")).toBe("amber");
		expect(slugFromLabel("Sky / L")).toBe("sky-l");
	});
	it("falls back to `variant` when empty", () => {
		expect(slugFromLabel("  ")).toBe("variant");
	});
});

describe("uniqueVariantId", () => {
	it("suffixes a slug already taken, starting at -2", () => {
		const taken = new Set(["default"]);
		expect(uniqueVariantId("Sky", taken)).toBe("sky");
		expect(uniqueVariantId("Sky!", taken)).toBe("sky-2");
		expect(uniqueVariantId("sky", taken)).toBe("sky-3");
		expect(uniqueVariantId("Default", taken)).toBe("default-2");
		expect([...taken]).toEqual([
			"default",
			"sky",
			"sky-2",
			"sky-3",
			"default-2",
		]);
	});
});
