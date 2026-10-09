import { describe, expect, it } from "vitest";
import { colorwayLabel } from "~/lib/figma/transpiler/variants";

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
