import { describe, expect, test } from "vitest";
import { uniquifyElementIds, unwrapLegacyBundle } from "../src/normalize";

describe("uniquifyElementIds", () => {
	test("leaves already-unique ids untouched (same references)", () => {
		const els = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const out = uniquifyElementIds(els);
		expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
		expect(out[0]).toBe(els[0]);
	});

	test("suffixes repeated ids in occurrence order", () => {
		const out = uniquifyElementIds([
			{ id: "Vector" },
			{ id: "Vector" },
			{ id: "Vector" },
		]);
		expect(out.map((e) => e.id)).toEqual(["Vector", "Vector_2", "Vector_3"]);
	});

	test("keeps the first occurrence's id, renames only later collisions", () => {
		const a = { id: "x", keep: 1 };
		const out = uniquifyElementIds([a, { id: "x", keep: 2 }]);
		expect(out[0]).toBe(a);
		expect(out[1]).toEqual({ id: "x_2", keep: 2 });
	});

	test("does not collide with a literal id that matches a generated suffix", () => {
		const out = uniquifyElementIds([
			{ id: "Vector" },
			{ id: "Vector" },
			{ id: "Vector_2" },
		]);
		const ids = out.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length); // all unique
		expect(ids).toContain("Vector_2"); // the generated one
	});
});

describe("unwrapLegacyBundle", () => {
	const template = { id: "aurora", template_data: [] };

	test("lifts a v1 bundle's template and its side-car fields to the top level", () => {
		const out = unwrapLegacyBundle({
			schemaVersion: 1,
			template,
			source: { kind: "figma", fileKey: "abc" },
			assets: [{ sha256: "a", base64: "AAAA", contentType: "image/png" }],
			warnings: [{ severity: "warn", code: "x", message: "y" }],
		}) as Record<string, unknown>;

		expect(out.id).toBe("aurora");
		expect(out.source).toEqual({ kind: "figma", fileKey: "abc" });
		expect(out.assets).toHaveLength(1);
		expect(out.warnings).toHaveLength(1);
		expect(out.schemaVersion).toBeUndefined();
		expect(out.template).toBeUndefined();
	});

	test("omits empty side-car arrays rather than writing empty ones", () => {
		const out = unwrapLegacyBundle({
			schemaVersion: 1,
			template,
			assets: [],
			warnings: [],
		}) as Record<string, unknown>;
		expect(out.assets).toBeUndefined();
		expect(out.warnings).toBeUndefined();
	});

	test("passes a current-shape template through untouched", () => {
		const current = { id: "aurora", template_data: [], assets: [] };
		expect(unwrapLegacyBundle(current)).toBe(current);
	});

	test("leaves anything that is not a v1 bundle alone", () => {
		const other = { schemaVersion: 2, template };
		expect(unwrapLegacyBundle(other)).toBe(other);
		const noTemplate = { schemaVersion: 1 };
		expect(unwrapLegacyBundle(noTemplate)).toBe(noTemplate);
		expect(unwrapLegacyBundle(null)).toBe(null);
		expect(unwrapLegacyBundle("nope")).toBe("nope");
	});

	test("is idempotent", () => {
		const once = unwrapLegacyBundle({ schemaVersion: 1, template });
		expect(unwrapLegacyBundle(once)).toBe(once);
	});
});
