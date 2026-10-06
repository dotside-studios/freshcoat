import { describe, expect, test } from "vitest";
import { substitute } from "../src/mustache";

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
