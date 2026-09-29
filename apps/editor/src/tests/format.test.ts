import { afterEach, describe, expect, test, vi } from "vitest";
import { plural } from "~/app/copy";
import {
	formatBytes,
	formatDate,
	formatLocale,
	formatNumber,
	setFormatLocale,
} from "~/app/format";
import { profileLabel } from "~/export/print";

afterEach(() => {
	setFormatLocale("en-US");
	vi.unstubAllGlobals();
});

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

	test("the decimal follows the locale", () => {
		setFormatLocale("de-DE");
		expect(formatBytes(1536)).toBe("1,5 KB");
	});
});

describe("locale", () => {
	test("tests run pinned to en-US", () => {
		expect(formatLocale()).toBe("en-US");
		expect(formatNumber(2400)).toBe("2,400");
		expect(plural(2400, "record")).toBe("2,400 records");
	});

	test("numbers follow the pinned locale, the words stay English", () => {
		setFormatLocale("de-DE");
		expect(formatNumber(2400)).toBe("2.400");
		expect(plural(2400, "record")).toBe("2.400 records");
		expect(plural(1, "record")).toBe("1 record");
	});

	test("dates follow it too", () => {
		const at = new Date(2026, 8, 29, 14, 5);
		const day = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
		setFormatLocale("en-GB");
		expect(formatDate(at, day)).toBe("29/09/2026");
		expect(formatDate(at, { hour: "2-digit", minute: "2-digit" })).toBe(
			"14:05",
		);
		setFormatLocale("de-DE");
		expect(formatDate(at, day)).toBe("29.09.2026");
		expect(
			profileLabel({ name: "Card", measuredAt: at.toISOString() } as never)
				.date,
		).toBe(formatDate(at, { year: "numeric", month: "short", day: "numeric" }));
	});

	test("unpinned, it is the browser's language, or en-US if that is unusable", () => {
		setFormatLocale(undefined);
		vi.stubGlobal("navigator", { language: "fr-FR" });
		expect(formatLocale()).toBe("fr-FR");
		expect(formatNumber(2400)).toBe("2 400");
		vi.stubGlobal("navigator", { language: "not a locale!" });
		expect(formatLocale()).toBe("en-US");
	});
});
