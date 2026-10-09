import { describe, expect, test } from "vitest";
import {
	parseSymbology,
	SYMBOLOGIES,
	symbologyLabel,
} from "../src/barcode-encoder";

describe("parseSymbology", () => {
	test("reads every id and label", () => {
		for (const s of SYMBOLOGIES) {
			expect(parseSymbology(s)).toBe(s);
			expect(parseSymbology(symbologyLabel(s))).toBe(s);
		}
	});

	test("ignores case, spaces, hyphens and underscores", () => {
		expect(parseSymbology("Code-128")).toBe("code128");
		expect(parseSymbology("EAN_13")).toBe("ean13");
		expect(parseSymbology(" data matrix ")).toBe("datamatrix");
	});

	test("reads common aliases", () => {
		expect(parseSymbology("UPC")).toBe("upca");
		expect(parseSymbology("ean")).toBe("ean13");
		expect(parseSymbology("ITF")).toBe("itf14");
		expect(parseSymbology("Aztec Code")).toBe("aztec");
	});

	test("is undefined for anything else", () => {
		expect(parseSymbology("qr")).toBeUndefined();
		expect(parseSymbology("")).toBeUndefined();
		expect(parseSymbology("code 93")).toBeUndefined();
	});
});
