import { describe, expect, it } from "vitest";
import { isWholeMustacheToken, titleCase } from "~/lib/figma/transpiler/fields";

describe("isWholeMustacheToken", () => {
	it("matches a clean token", () => {
		expect(isWholeMustacheToken("{{name}}")).toEqual({ ok: true, id: "name" });
	});

	it("matches with surrounding whitespace", () => {
		expect(isWholeMustacheToken("  {{name}}  ")).toEqual({
			ok: true,
			id: "name",
		});
	});

	it("rejects token with extra literal text", () => {
		expect(isWholeMustacheToken("Hi {{name}}")).toEqual({ ok: false });
	});
});

describe("titleCase", () => {
	it("converts snake_case to Title Case", () => {
		expect(titleCase("display_name")).toBe("Display Name");
		expect(titleCase("user_avatar")).toBe("User Avatar");
		expect(titleCase("name")).toBe("Name");
	});
});
