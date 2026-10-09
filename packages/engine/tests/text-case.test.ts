import { describe, expect, test } from "vitest";
import { applyCase, applySpanCase } from "../src/text-case";

describe("applyCase", () => {
	test("title-cases non-ASCII words once per word", () => {
		expect(applyCase("élan émile", "title")).toBe("Élan Émile");
		expect(applyCase("straße", "title")).toBe("Straße");
		expect(applyCase("café olé", "title")).toBe("Café Olé");
	});

	test("title case continues a word from the previous character", () => {
		expect(applyCase("ming", "title", "e")).toBe("ming");
		expect(applyCase("ming", "title", "é")).toBe("ming");
		expect(applyCase("ming", "title", " ")).toBe("Ming");
	});

	test("upper and lower case are unchanged", () => {
		expect(applyCase("straße émile", "upper")).toBe("STRASSE ÉMILE");
		expect(applyCase("ÉLAN Émile", "lower")).toBe("élan émile");
		expect(applyCase("straße", "upper", "", { preserveLength: true })).toBe(
			"STRAßE",
		);
	});

	test("other modes leave the text alone", () => {
		expect(applyCase("élan", "original")).toBe("élan");
		expect(applyCase("élan", undefined)).toBe("élan");
	});
});

describe("applySpanCase", () => {
	test("keeps one capital for a word split across spans", () => {
		const spans = [{ text: "hel" }, { text: "lo wor" }, { text: "ld" }];
		expect(applySpanCase(spans, "title").map((s) => s.text)).toEqual([
			"Hel",
			"lo Wor",
			"ld",
		]);
	});

	test("returns the spans as they are without a case", () => {
		const spans = [{ text: "abc" }];
		expect(applySpanCase(spans, "original")).toBe(spans);
	});
});
