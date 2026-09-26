import { describe, expect, it } from "vitest";
import {
	inferImageField,
	inferQrField,
	inferStringField,
	isWholeMustacheToken,
	kebabToSnake,
	parseMustacheTokens,
	titleCase,
} from "~/lib/figma/transpiler/fields";

describe("parseMustacheTokens", () => {
	it("extracts every token from a string", () => {
		expect(parseMustacheTokens("Hello {{first}} and {{second}}!")).toEqual([
			"first",
			"second",
		]);
	});

	it("returns empty array on no tokens", () => {
		expect(parseMustacheTokens("Hello world")).toEqual([]);
	});

	it("trims whitespace inside braces", () => {
		expect(parseMustacheTokens("{{  spaced  }}")).toEqual(["spaced"]);
	});

	it("ignores invalid identifiers", () => {
		expect(parseMustacheTokens("{{1abc}} {{a-b}} {{ok_one}}")).toEqual([
			"ok_one",
		]);
	});
});

describe("kebabToSnake", () => {
	it("converts dashes to underscores", () => {
		expect(kebabToSnake("user-avatar")).toBe("user_avatar");
		expect(kebabToSnake("plain")).toBe("plain");
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

describe("inferStringField / inferImageField / inferQrField", () => {
	it("inferStringField returns title", () => {
		expect(inferStringField("display_name")).toEqual({
			type: "string",
			title: "Display Name",
		});
	});

	it("inferImageField sets format and aspect when provided", () => {
		expect(inferImageField("user_avatar", [1, 1])).toEqual({
			type: "string",
			format: "image",
			title: "User Avatar",
			"x-image-aspect": [1, 1],
		});
	});

	it("inferImageField omits aspect when not provided", () => {
		expect(inferImageField("banner")).toEqual({
			type: "string",
			format: "image",
			title: "Banner",
		});
	});

	it("inferQrField sets x-widget", () => {
		expect(inferQrField("link")).toEqual({
			type: "string",
			title: "Link",
			"x-widget": "url",
		});
	});
});
