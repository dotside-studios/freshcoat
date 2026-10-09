import { describe, expect, test } from "vitest";
import { applyCase } from "../src/text-case";

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
