import { describe, expect, it } from "vitest";
import { slug } from "~/lib/slug";

describe("slug", () => {
	it("lowercases and dashes", () => {
		expect(slug("Amber")).toBe("amber");
		expect(slug("Sky / L")).toBe("sky-l");
		expect(slug("  --Hi there--  ")).toBe("hi-there");
	});
	it("joins with `_` when asked", () => {
		expect(slug("Display Name!", { sep: "_" })).toBe("display_name");
		expect(slug("__a-b__", { sep: "_" })).toBe("a_b");
	});
	it("falls back when empty", () => {
		expect(slug("  ")).toBe("");
		expect(slug("  ", { fallback: "variant" })).toBe("variant");
	});
});
