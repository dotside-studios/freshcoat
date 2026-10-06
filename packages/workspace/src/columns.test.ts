import { describe, expect, it } from "vitest";
import {
	coerce,
	compiledPattern,
	defaultValues,
	newRecord,
	PATTERN_CACHE_MAX,
	parseDateText,
	serialToIso,
	toTemplateValue,
	validateRecord,
} from "./columns";
import { photoSha } from "./test-fixtures";
import type { Column, ColumnType, DatasetAsset } from "./types";

const col = (type: ColumnType, extra: Partial<Column> = {}): Column => ({
	key: "c",
	type,
	...extra,
});

describe("coerce", () => {
	it("keeps text as typed, without carriage returns", () => {
		expect(coerce(col("text"), "007")).toEqual({ value: "007", ok: true });
		expect(coerce(col("text"), "a\r")).toEqual({ value: "a", ok: true });
		expect(coerce(col("text"), "")).toEqual({ value: null, ok: true });
		expect(coerce(col("text"), 12)).toEqual({ value: "12", ok: true });
	});

	it("normalises line breaks in long text", () => {
		expect(coerce(col("longText"), "a\r\nb")).toEqual({
			value: "a\nb",
			ok: true,
		});
	});

	it("reads numbers with separators and rejects the rest", () => {
		expect(coerce(col("number"), "1,234.5")).toEqual({
			value: 1234.5,
			ok: true,
		});
		expect(coerce(col("number"), " 1 000 ")).toEqual({ value: 1000, ok: true });
		expect(coerce(col("number"), "")).toEqual({ value: null, ok: true });
		expect(coerce(col("number"), 3)).toEqual({ value: 3, ok: true });
		expect(coerce(col("number"), "12abc")).toEqual({
			value: "12abc",
			ok: false,
			message: "Not a number",
		});
		expect(coerce(col("number"), Number.NaN).ok).toBe(false);
	});

	it("keeps a fractional integer as text", () => {
		expect(coerce(col("integer"), "42")).toEqual({ value: 42, ok: true });
		expect(coerce(col("integer"), "1.5")).toEqual({
			value: "1.5",
			ok: false,
			message: "Not a whole number",
		});
	});

	it("reads booleans from words", () => {
		for (const t of ["true", "YES", "y", "1", "on", "✓"]) {
			expect(coerce(col("boolean"), t)).toEqual({ value: true, ok: true });
		}
		for (const f of ["false", "No", "n", "0", "off", ""]) {
			expect(coerce(col("boolean"), f)).toEqual({ value: false, ok: true });
		}
		expect(coerce(col("boolean"), true)).toEqual({ value: true, ok: true });
		expect(coerce(col("boolean"), "maybe")).toEqual({
			value: "maybe",
			ok: false,
			message: "Not yes or no",
		});
	});

	it("reads dates in every accepted form", () => {
		const date = col("date");
		expect(coerce(date, "2024-02-29").value).toBe("2024-02-29");
		expect(coerce(date, "2024-3-5").value).toBe("2024-03-05");
		expect(coerce(date, "03/04/2025", { dateOrder: "dmy" }).value).toBe(
			"2025-04-03",
		);
		expect(coerce(date, "03/04/2025", { dateOrder: "mdy" }).value).toBe(
			"2025-03-04",
		);
		expect(coerce(date, 45000).value).toBe("2023-03-15");
		expect(coerce(date, "45000").value).toBe("2023-03-15");
		expect(coerce(date, new Date(Date.UTC(2020, 0, 31))).value).toBe(
			"2020-01-31",
		);
		expect(coerce(date, "2023-02-29")).toEqual({
			value: "2023-02-29",
			ok: false,
			message: "Not a date",
		});
		expect(coerce(date, "13/13/2020").ok).toBe(false);
		expect(coerce(date, "12").ok).toBe(false);
	});

	it("keeps colours, URLs and emails as typed", () => {
		expect(coerce(col("color"), " #FFaa00 ").value).toBe("#FFaa00");
		expect(coerce(col("url"), "https://x.test").value).toBe("https://x.test");
		expect(coerce(col("email"), "a@b.co").value).toBe("a@b.co");
	});

	it("rewrites an image named by an asset to its reference", () => {
		const assets: DatasetAsset[] = [
			{
				sha256: photoSha,
				contentType: "image/png",
				name: "Ana.PNG",
				size: 0,
				blob: new Blob([]),
			},
		];
		expect(coerce(col("image"), "ana.png", { assets }).value).toBe(
			`ws:${photoSha}`,
		);
		expect(coerce(col("image"), "ANA", { assets }).value).toBe(
			`ws:${photoSha}`,
		);
		expect(coerce(col("image"), "bob.png", { assets }).value).toBe("bob.png");
	});

	it("treats null and undefined as empty", () => {
		expect(coerce(col("number"), undefined)).toEqual({ value: null, ok: true });
		expect(coerce(col("boolean"), null)).toEqual({ value: false, ok: true });
	});
});

describe("parseDateText and serialToIso", () => {
	it("reject what is not a date", () => {
		expect(parseDateText("tomorrow")).toBeNull();
		expect(serialToIso(0)).toBeNull();
		expect(serialToIso(1)).toBe("1899-12-31");
	});
});

describe("validateRecord patterns", () => {
	it("reuses compiled patterns and skips invalid ones", () => {
		const columns: Column[] = [
			{ key: "code", type: "text", pattern: "^\\p{Lu}+$" },
			{ key: "broken", type: "text", pattern: "([" },
		];
		for (let i = 0; i < 2; i++) {
			expect(validateRecord(columns, { code: "ÄB", broken: "x" })).toEqual([]);
			expect(validateRecord(columns, { code: "ab", broken: "x" })).toEqual([
				{ column: "code", message: "Does not match the pattern" },
			]);
		}
	});
});

describe("validateRecord", () => {
	const columns: Column[] = [
		{ key: "name", type: "text", required: true, minLength: 2, maxLength: 5 },
		{ key: "code", type: "text", pattern: "^[A-Z]+$" },
		{ key: "tier", type: "text", enum: ["gold", "silver"] },
		{ key: "age", type: "integer", minimum: 18, maximum: 99 },
		{ key: "score", type: "number" },
		{ key: "ok", type: "boolean" },
		{ key: "day", type: "date" },
		{ key: "color", type: "color" },
		{ key: "site", type: "url" },
		{ key: "mail", type: "email" },
		{ key: "photo", type: "image" },
	];

	it("accepts a valid record", () => {
		expect(
			validateRecord(columns, {
				name: "Ana",
				code: "AB",
				tier: "gold",
				age: 30,
				score: 1.5,
				ok: true,
				day: "2024-01-01",
				color: "rebeccapurple",
				site: "https://example.com",
				mail: "a@b.co",
				photo: "https://example.com/a.png",
			}),
		).toEqual([]);
	});

	it("reports each broken rule", () => {
		const issues = validateRecord(
			columns,
			{
				name: "A",
				code: "ab",
				tier: "bronze",
				age: 12,
				score: "x",
				ok: "maybe",
				day: "2023-02-30",
				color: "#12",
				site: "not a url",
				mail: "nope",
				photo: "ws:missing",
			},
			[],
		);
		expect(
			Object.fromEntries(issues.map((i) => [i.column, i.message])),
		).toEqual({
			name: "Shorter than 2 characters",
			code: "Does not match the pattern",
			tier: "Not one of gold, silver",
			age: "Less than 18",
			score: "Not a number",
			ok: "Not yes or no",
			day: "Not a date",
			color: "Not a colour",
			site: "Not a URL",
			mail: "Not an email address",
			photo: "Photo is not in this dataset",
		});
	});

	it("flags an empty required column only", () => {
		expect(validateRecord(columns, {})).toEqual([
			{ column: "name", message: "Required" },
		]);
		expect(validateRecord(columns, { name: "" })).toEqual([
			{ column: "name", message: "Required" },
		]);
	});

	it("flags the upper bound and a fraction", () => {
		expect(validateRecord(columns, { name: "Ana", age: 100 })).toEqual([
			{ column: "age", message: "More than 99" },
		]);
		expect(validateRecord(columns, { name: "Ana", age: 20.5 })).toEqual([
			{ column: "age", message: "Not a whole number" },
		]);
		expect(validateRecord(columns, { name: "Ana", photo: "a.png" })).toEqual([
			{ column: "photo", message: "No photo named a.png" },
		]);
	});
});

describe("toTemplateValue", () => {
	it("gives coatfile strings", () => {
		expect(toTemplateValue(col("boolean"), true)).toBe("true");
		expect(toTemplateValue(col("boolean"), false)).toBe("false");
		expect(toTemplateValue(col("number"), 1.25)).toBe("1.25");
		expect(toTemplateValue(col("text"), null)).toBe("");
		expect(toTemplateValue(col("text"), "x")).toBe("x");
	});
});

describe("defaults", () => {
	it("fills a new record from column defaults", () => {
		const columns: Column[] = [
			{ key: "a", type: "text", default: "x" },
			{ key: "b", type: "boolean" },
			{ key: "c", type: "number" },
		];
		expect(defaultValues(columns)).toEqual({ a: "x", b: false });
		const record = newRecord(columns, { c: 2 });
		expect(record.id).toMatch(/^r_[0-9a-f]{8}$/);
		expect(record).toMatchObject({
			status: "pending",
			values: { a: "x", b: false, c: 2 },
		});
	});
});

describe("compiledPattern", () => {
	it("reuses a compiled pattern and evicts the least recently used past its cap", () => {
		const first = compiledPattern("^a");
		expect(compiledPattern("^a")).toBe(first);
		const kept = compiledPattern("^kept");
		for (let i = 0; i < PATTERN_CACHE_MAX - 1; i++) {
			compiledPattern(`^p${i}`);
			if (i === 0) compiledPattern("^kept");
		}
		expect(compiledPattern("^kept")).toBe(kept);
		expect(compiledPattern("^a")).not.toBe(first);
	});
});
