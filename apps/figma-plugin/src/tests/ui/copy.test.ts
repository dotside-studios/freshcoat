import { describe, expect, it } from "vitest";
import { formatBytes, listOf, plural } from "~/ui/copy";

describe("copy helpers", () => {
	it("counts with the right noun", () => {
		expect(plural(0, "field")).toBe("0 fields");
		expect(plural(1, "field")).toBe("1 field");
		expect(plural(3, "warning")).toBe("3 warnings");
		expect(plural(2, "more", "more")).toBe("2 more");
	});

	it("sizes files in decimal units", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(42_300)).toBe("42 KB");
		expect(formatBytes(1_250_000)).toBe("1.3 MB");
	});

	it("joins a list for a sentence", () => {
		expect(listOf(["name"])).toBe("name");
		expect(listOf(["first", "last"])).toBe("first and last");
		expect(listOf(["a", "b", "c"])).toBe("a, b and c");
	});
});
