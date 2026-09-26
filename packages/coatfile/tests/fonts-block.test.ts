import { describe, expect, test } from "vitest";
import { validate } from "../src/validate";

const baseTemplateNoFonts = {
	format_version: "1.0",
	version: "1.0.0",
	id: "t",
	name: "T",
	product: "card_cr80",
	width: 100,
	height: 60,
	fields: { type: "object", properties: { displayName: { type: "string" } } },
	template_data: [
		{
			name: "front",
			background: {
				id: "bg",
				type: "rect",
				pos: { x: 0, y: 0 },
				size: { width: 100, height: 60 },
				properties: { fill: "#fff" },
			},
			elements: [
				{
					id: "title",
					type: "text",
					pos: { x: 0, y: 0 },
					size: { width: 100, height: 30 },
					properties: {
						value: "{{displayName}}",
						font: { family: "Comfortaa", size: 16 },
						color: "#000",
					},
				},
			],
		},
	],
};

describe("fonts block — descriptor parsing", () => {
	test("template with no fonts block validates (by-name path)", () => {
		const result = validate(baseTemplateNoFonts);
		expect(result.ok).toBe(true);
	});

	test("kind: google descriptor parses", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [
				{
					kind: "google",
					family: "Comfortaa",
					url: "https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;700&display=swap",
				},
			],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.fonts).toEqual(tpl.fonts);
		}
	});

	test("kind: fontsource descriptor parses", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [
				{
					kind: "fontsource",
					family: "Comfortaa",
					url: "https://cdn.jsdelivr.net/fontsource/fonts/comfortaa@latest/index.css",
				},
			],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(true);
	});

	test("kind: local descriptor with multiple weight files parses", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [
				{
					kind: "local",
					family: "Comfortaa",
					files: [
						{ weight: 400, src: "/fonts/comfortaa-400.woff2" },
						{
							weight: 700,
							style: "italic",
							src: "/fonts/comfortaa-700-italic.woff2",
						},
					],
				},
			],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(true);
	});
});

describe("fonts block — structural validation", () => {
	test("empty family on entry → font_family_required", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [{ kind: "google", family: "", url: "https://example.com/x.css" }],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.code === "font_family_required")).toBe(
				true,
			);
		}
	});

	test("empty url on google entry → stylesheet_font_url_required", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [{ kind: "google", family: "Comfortaa", url: "" }],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((e) => e.code === "stylesheet_font_url_required"),
			).toBe(true);
		}
	});

	test("empty url on fontsource entry → stylesheet_font_url_required", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [{ kind: "fontsource", family: "Comfortaa", url: "" }],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((e) => e.code === "stylesheet_font_url_required"),
			).toBe(true);
		}
	});

	test("empty files on local entry → local_font_files_required", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [{ kind: "local", family: "Comfortaa", files: [] }],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((e) => e.code === "local_font_files_required"),
			).toBe(true);
		}
	});

	test("empty src on a local file entry → local_font_file_src_required", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [
				{
					kind: "local",
					family: "Comfortaa",
					files: [{ weight: 400, src: "" }],
				},
			],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((e) => e.code === "local_font_file_src_required"),
			).toBe(true);
		}
	});

	test("two entries with the same family → duplicate_font_family", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [
				{
					kind: "google",
					family: "Comfortaa",
					url: "https://example.com/a.css",
				},
				{
					kind: "google",
					family: "Comfortaa",
					url: "https://example.com/b.css",
				},
			],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((e) => e.code === "duplicate_font_family"),
			).toBe(true);
		}
	});
});

describe("fonts block — cross-reference validation", () => {
	test("partial fonts block (omits a referenced family) is valid — lax mode", () => {
		// baseTemplateNoFonts uses font.family "Comfortaa"; fonts block only declares
		// "Plus Jakarta Sans". A partial block must NOT emit unknown_font_reference.
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [
				{
					kind: "google",
					family: "Plus Jakarta Sans",
					url: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans&display=swap",
				},
			],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			expect(
				result.errors.some((e) => e.code === "unknown_font_reference"),
			).toBe(false);
		}
	});

	test("declared family covering all text-element usages validates", () => {
		const tpl = {
			...baseTemplateNoFonts,
			fonts: [
				{
					kind: "google",
					family: "Comfortaa",
					url: "https://fonts.googleapis.com/css2?family=Comfortaa&display=swap",
				},
			],
		};
		const result = validate(tpl);
		expect(result.ok).toBe(true);
	});

	test("missing fonts block: no font-reference checking", () => {
		// baseTemplateNoFonts uses "Comfortaa" but has no fonts block.
		// Validation must NOT emit unknown_font_reference (by-name mode).
		const result = validate(baseTemplateNoFonts);
		expect(result.ok).toBe(true);
	});
});
