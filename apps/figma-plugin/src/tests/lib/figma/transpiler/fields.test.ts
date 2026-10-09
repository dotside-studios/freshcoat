import { describe, expect, it } from "vitest";
import { titleCase } from "~/lib/figma/transpiler/fields";

describe("titleCase", () => {
	it("converts snake_case to Title Case", () => {
		expect(titleCase("display_name")).toBe("Display Name");
		expect(titleCase("user_avatar")).toBe("User Avatar");
		expect(titleCase("name")).toBe("Name");
	});
});
