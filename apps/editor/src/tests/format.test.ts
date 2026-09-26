import { describe, expect, test } from "vitest";
import { formatBytes } from "~/app/format";

describe("formatBytes", () => {
	test("binary units, one decimal below 10", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(35 * 1024 + 300)).toBe("35 KB");
		expect(formatBytes(12.4 * 1024 ** 2)).toBe("12 MB");
		expect(formatBytes(1.2 * 1024 ** 3)).toBe("1.2 GB");
		expect(formatBytes(3 * 1024 ** 5)).toBe("3072 TB");
	});

	test("nothing for a size that is not one", () => {
		expect(formatBytes(-1)).toBe("");
		expect(formatBytes(Number.NaN)).toBe("");
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("");
	});
});
