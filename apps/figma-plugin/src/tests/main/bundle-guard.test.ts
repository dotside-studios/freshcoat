import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// barcode-name.ts pulls SYMBOLOGIES into the main thread from this module.
const source = readFileSync(
	createRequire(import.meta.url).resolve(
		"@freshcoat-js/coatfile/barcode-encoder",
	),
	"utf8",
);

describe("coatfile/barcode-encoder", () => {
	it("has only type imports", () => {
		const imports = source.match(/^\s*(import|export)\b[^;]*?\bfrom\s/gm) ?? [];
		expect(imports.length).toBeGreaterThan(0);
		for (const statement of imports)
			expect(statement).toMatch(/^\s*(import|export) type\b/);
		expect(source).not.toMatch(/\bimport\s*\(/);
		expect(source).not.toMatch(/^\s*import\s+["']/m);
	});
});
