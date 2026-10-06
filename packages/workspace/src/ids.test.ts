import { describe, expect, it } from "vitest";
import { freshId, isValidKey, newId, slug, uniqueKey } from "./ids";

describe("ids", () => {
	it("mints prefixed 16-hex ids", () => {
		const a = newId("r");
		expect(a).toMatch(/^r_[0-9a-f]{16}$/);
		expect(newId("r")).not.toBe(a);
	});

	it("mints 200,000 unique ids", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 200_000; i++) ids.add(newId("r"));
		expect(ids.size).toBe(200_000);
	});

	it("skips taken ids", () => {
		const taken = new Set([newId("r")]);
		const id = freshId("r", taken);
		expect(taken.has(id)).toBe(false);
	});

	it("slugs any text into a valid key", () => {
		expect(slug("First Name")).toBe("first_name");
		expect(slug("firstName")).toBe("first_name");
		expect(slug("  E-mail address ")).toBe("e_mail_address");
		expect(slug("Año")).toBe("ano");
		expect(slug("2nd line")).toBe("_2nd_line");
		expect(slug("%%%")).toBe("column");
		for (const s of ["First Name", "2nd", "", "日本"]) {
			expect(isValidKey(slug(s))).toBe(true);
		}
	});

	it("finds a free key", () => {
		expect(uniqueKey("a", ["b"])).toBe("a");
		expect(uniqueKey("a", ["a", "a_2"])).toBe("a_3");
	});
});
