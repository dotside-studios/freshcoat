import { describe, expect, test } from "vitest";
import {
	FIELD_ID,
	fieldKeyFrom,
	hasToken,
	parseMustache,
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

describe("parseMustache", () => {
	test("splits text and refs with their offsets", () => {
		expect(parseMustache("Hi {{ name }}!")).toEqual([
			{ kind: "text", value: "Hi ", start: 0, end: 3 },
			{ kind: "ref", id: "name", raw: "{{ name }}", start: 3, end: 13 },
			{ kind: "text", value: "!", start: 13, end: 14 },
		]);
	});

	test("returns nothing for an empty string", () => {
		expect(parseMustache("")).toEqual([]);
	});

	test("keeps malformed tokens as text", () => {
		expect(parseMustache("{{a-b}} {{name")).toEqual([
			{ kind: "text", value: "{{a-b}} {{name", start: 0, end: 14 },
		]);
	});

	test("finds a ref after a stray brace", () => {
		expect(parseMustache("{{{a}}}")).toEqual([
			{ kind: "text", value: "{", start: 0, end: 1 },
			{ kind: "ref", id: "a", raw: "{{a}}", start: 1, end: 6 },
			{ kind: "text", value: "}", start: 6, end: 7 },
		]);
	});

	test("segments cover the input exactly", () => {
		const s = "x{{a}}{{b}} {{ c}}y{{";
		const segs = parseMustache(s);
		expect(
			segs.map((seg) => (seg.kind === "text" ? seg.value : seg.raw)).join(""),
		).toBe(s);
		segs.forEach((seg, i) => {
			expect(s.slice(seg.start, seg.end)).toBe(
				seg.kind === "text" ? seg.value : seg.raw,
			);
			if (i > 0) expect(seg.start).toBe(segs[i - 1]?.end);
		});
	});
});

describe("parser matches the reference regex", () => {
	const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
	const WHOLE = new RegExp(`^${TOKEN.source}$`);
	const ALPHABET = ["{", "}", "{{", "}}", "a", "Z", "_", "1", "-", ".", " ", "\t", "\u00a0", "x"];

	let seed = 0x2545f491;
	const next = () => {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		return (seed >>> 0) / 0x100000000;
	};
	const sample = () => {
		const n = Math.floor(next() * 16);
		let s = "";
		for (let i = 0; i < n; i++)
			s += ALPHABET[Math.floor(next() * ALPHABET.length)];
		return s;
	};

	test("on random input", () => {
		for (let i = 0; i < 20000; i++) {
			const s = sample();
			const ctx = { a: "<A>", Z: "<Z>", a1: "<a1>", _: "<_>" };
			expect(tokenIds(s)).toEqual(Array.from(s.matchAll(TOKEN), (m) => m[1]));
			expect(wholeToken(s)).toBe(WHOLE.exec(s)?.[1]);
			expect(hasToken(s)).toBe(new RegExp(TOKEN.source).test(s));
			expect(substitute(s, ctx)).toBe(
				s.replace(TOKEN, (_m, id: string) => (ctx as Record<string, string>)[id] ?? ""),
			);
			expect(renameToken(s, "a", "b")).toBe(
				s.replace(TOKEN, (m, id: string) => (id === "a" ? m.replace(id, "b") : m)),
			);
		}
	});
});

describe("fieldKeyFrom", () => {
	test("joins words with underscores", () => {
		expect(fieldKeyFrom("First Name")).toBe("first_name");
		expect(fieldKeyFrom("  E-mail address ")).toBe("e_mail_address");
	});

	test("splits camelCase", () => {
		expect(fieldKeyFrom("firstName")).toBe("first_name");
		expect(fieldKeyFrom("line2Text")).toBe("line2_text");
	});

	test("prefixes a leading digit", () => {
		expect(fieldKeyFrom("2nd")).toBe("_2nd");
		expect(fieldKeyFrom("2nd line")).toBe("_2nd_line");
	});

	test("drops accents", () => {
		expect(fieldKeyFrom("Año")).toBe("ano");
		expect(fieldKeyFrom("Café crème")).toBe("cafe_creme");
	});

	test("falls back when nothing is left", () => {
		expect(fieldKeyFrom("")).toBe("field");
		expect(fieldKeyFrom("%%%")).toBe("field");
		expect(fieldKeyFrom("  ", "name")).toBe("name");
	});

	test("always gives a key FIELD_ID accepts", () => {
		for (const s of ["", "2nd", "firstName", "Año", "日本", "_x_", "a.b", "9"])
			expect(FIELD_ID.test(fieldKeyFrom(s))).toBe(true);
	});
});
