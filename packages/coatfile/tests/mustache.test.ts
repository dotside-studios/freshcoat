import { describe, expect, test } from "vitest";
import {
	FIELD_ID,
	hasToken,
	renameToken,
	substitute,
	tokenIds,
	wholeToken,
} from "../src/mustache";

describe("substitute", () => {
	test("replaces a simple {{id}} token", () => {
		expect(substitute("Hi {{name}}", { name: "Alex" })).toBe("Hi Alex");
	});

	test("tolerates whitespace inside braces", () => {
		expect(substitute("Hi {{ name }}", { name: "Alex" })).toBe("Hi Alex");
	});

	test("missing field becomes empty string", () => {
		expect(substitute("Hi {{name}}", {})).toBe("Hi ");
	});

	test("multiple tokens in one string", () => {
		expect(substitute("{{a}}-{{b}}", { a: "1", b: "2" })).toBe("1-2");
	});

	test("non-string values pass through unchanged", () => {
		expect(substitute(42, { a: "x" })).toBe(42);
		expect(substitute(true, { a: "x" })).toBe(true);
		expect(substitute(null, { a: "x" })).toBe(null);
	});

	test("walks nested objects, replacing strings only", () => {
		const tree = {
			title: "Hi {{name}}",
			count: 7,
			nested: { handle: "@{{name}}" },
		};
		expect(substitute(tree, { name: "Alex" })).toEqual({
			title: "Hi Alex",
			count: 7,
			nested: { handle: "@Alex" },
		});
	});

	test("walks arrays, replacing string entries", () => {
		expect(substitute(["{{a}}", 2, "{{b}}"], { a: "x", b: "y" })).toEqual([
			"x",
			2,
			"y",
		]);
	});

	test("single-pass: substituted value is not re-evaluated", () => {
		expect(
			substitute("Hi {{name}}", { name: "{{secret}}", secret: "OOPS" }),
		).toBe("Hi {{secret}}");
	});

	test("identifier rules: only alphanumeric + underscore (no dots/spaces)", () => {
		expect(substitute("{{a.b}}", { "a.b": "x" })).toBe("{{a.b}}");
		expect(substitute("{{a-b}}", { "a-b": "x" })).toBe("{{a-b}}");
	});

	test("returns identical reference for objects with no string substitutions", () => {
		const tree = { count: 7, nested: { id: 42 } };
		expect(substitute(tree, {})).toEqual(tree);
	});

	test("leaves strings without tokens untouched", () => {
		const uri = `data:image/png;base64,${"A".repeat(1 << 16)}`;
		expect(substitute(uri, { A: "x" })).toBe(uri);
		expect(substitute("a {b} }}", { b: "x" })).toBe("a {b} }}");
		expect(substitute("{{ 1x }}", {})).toBe("{{ 1x }}");
	});
});

describe("FIELD_ID", () => {
	test("accepts identifiers and rejects everything else", () => {
		expect(FIELD_ID.test("first_name2")).toBe(true);
		expect(FIELD_ID.test("_x")).toBe(true);
		expect(FIELD_ID.test("1x")).toBe(false);
		expect(FIELD_ID.test("a-b")).toBe(false);
		expect(FIELD_ID.test("")).toBe(false);
	});
});

describe("tokenIds", () => {
	test("lists ids in order, repeats included", () => {
		expect(tokenIds("{{a}} {{ b }} {{a}}")).toEqual(["a", "b", "a"]);
	});

	test("skips invalid identifiers", () => {
		expect(tokenIds("{{1abc}} {{a-b}} {{a.b}} {{ok_one}}")).toEqual([
			"ok_one",
		]);
	});

	test("returns nothing for plain text", () => {
		expect(tokenIds("Hello world")).toEqual([]);
	});

	test("is safe to call repeatedly", () => {
		expect(tokenIds("{{a}}")).toEqual(["a"]);
		expect(tokenIds("{{a}}")).toEqual(["a"]);
	});
});

describe("wholeToken", () => {
	test("reads a string that is exactly one token", () => {
		expect(wholeToken("{{name}}")).toBe("name");
		expect(wholeToken("{{ name }}")).toBe("name");
	});

	test("rejects surrounding text or whitespace", () => {
		expect(wholeToken("Hi {{name}}")).toBeUndefined();
		expect(wholeToken(" {{name}}")).toBeUndefined();
		expect(wholeToken("{{a}}{{b}}")).toBeUndefined();
		expect(wholeToken("{{a-b}}")).toBeUndefined();
	});
});

describe("hasToken", () => {
	test("finds a token anywhere in a tree", () => {
		expect(hasToken("{{a}}")).toBe(true);
		expect(hasToken({ x: [1, { y: "Hi {{a}}" }] })).toBe(true);
	});

	test("ignores invalid tokens and non-strings", () => {
		expect(hasToken({ x: "{{a-b}}", y: 3, z: null })).toBe(false);
		expect(hasToken(undefined)).toBe(false);
	});

	test("gives the same answer on repeated calls", () => {
		expect(hasToken("{{a}}")).toBe(true);
		expect(hasToken("{{a}}")).toBe(true);
	});
});

describe("renameToken", () => {
	test("renames every matching token and keeps its spacing", () => {
		expect(renameToken("{{old}} and {{ old }}", "old", "new")).toBe(
			"{{new}} and {{ new }}",
		);
	});

	test("matches the whole id, not a prefix", () => {
		expect(renameToken("{{old_id}} {{old}}", "old", "new")).toBe(
			"{{old_id}} {{new}}",
		);
	});

	test("leaves other text untouched", () => {
		expect(renameToken("old {{other}}", "old", "new")).toBe("old {{other}}");
	});
});
