import { describe, expect, it } from "vitest";
import {
	extractTokens,
	isWholeMustacheToken,
	titleCase,
} from "~/lib/figma/transpiler/fields";

describe("extractTokens", () => {
	it("extracts every token from a string", () => {
		expect(extractTokens("Hello {{first}} and {{second}}!")).toEqual([
			"first",
			"second",
		]);
	});

	it("returns empty array on no tokens", () => {
		expect(extractTokens("Hello world")).toEqual([]);
	});

	it("trims whitespace inside braces", () => {
		expect(extractTokens("{{  spaced  }}")).toEqual(["spaced"]);
	});

	it("ignores invalid identifiers", () => {
		expect(extractTokens("{{1abc}} {{a-b}} {{ok_one}}")).toEqual(["ok_one"]);
	});
});

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
