import { googleCss2Url } from "@freshcoat-js/coatfile/fonts";
import { describe, expect, it } from "vitest";
import { collectFontDescriptors } from "~/lib/figma/transpiler/fonts";

// Minimal template_data shapes (only the fields collectFontDescriptors reads).
const textEl = (family: string, weight = 400, style?: "italic") => ({
	id: "t",
	type: "text",
	properties: {
		font: { family, size: 24, weight, ...(style ? { style } : {}) },
		color: "#000",
	},
});
const frame = (name: string, elements: unknown[]) => ({
	name,
	background: {},
	elements,
});

describe("collectFontDescriptors", () => {
	it("emits google descriptors for all non-system families", () => {
		const td = [
			frame("front", [
				textEl("Comfortaa", 700),
				textEl("Inter", 400, "italic"),
			]),
		];
		const fonts = collectFontDescriptors({ template_data: td });
		expect(fonts.map((f) => f.family).sort()).toEqual(["Comfortaa", "Inter"]);
		expect(
			fonts.every(
				(f) => f.kind === "google" && f.url.includes("fonts.googleapis.com"),
			),
		).toBe(true);
		const inter = fonts.find((f) => f.family === "Inter");
		expect(inter?.url).toContain("ital,wght@");
	});

	it("filters system fonts out, declares only non-system families", () => {
		const td = [
			frame("front", [textEl("Comfortaa", 700), textEl("Arial", 400)]),
		];
		const fonts = collectFontDescriptors({ template_data: td });
		// Arial is a system font — filtered out. Comfortaa is declared as Google.
		expect(fonts.map((f) => f.family)).toEqual(["Comfortaa"]);
		expect(fonts[0]).toMatchObject({ kind: "google", family: "Comfortaa" });
	});

	it("treats non-system custom fonts (e.g. Proxima Nova) as Google — no warning", () => {
		const td = [
			frame("front", [textEl("Comfortaa", 700), textEl("Proxima Nova", 400)]),
		];
		const fonts = collectFontDescriptors({ template_data: td });
		// Both declared as Google; no warnings, no special handling.
		expect(fonts.map((f) => f.family).sort()).toEqual([
			"Comfortaa",
			"Proxima Nova",
		]);
		expect(fonts.every((f) => f.kind === "google")).toBe(true);
	});

	it("collects families from spans and frame children too", () => {
		const spanEl = {
			id: "s",
			type: "text",
			properties: {
				font: { family: "Comfortaa", size: 20, weight: 400 },
				spans: [{ text: "a", font: { family: "Poppins", weight: 700 } }],
				color: "#000",
			},
		};
		const td = [
			frame("front", [
				{ id: "g", type: "frame", properties: { children: [spanEl] } },
			]),
		];
		const fonts = collectFontDescriptors({ template_data: td });
		expect(fonts.map((f) => f.family).sort()).toEqual(["Comfortaa", "Poppins"]);
	});

	it("adds a span's weight and italic to the base family when it names none", () => {
		const td = [
			frame("front", [
				{
					id: "t",
					type: "text",
					properties: {
						font: { family: "Comfortaa", size: 20, weight: 400 },
						spans: [
							{ text: "a", font: { weight: 700 } },
							{ text: "b", font: { style: "italic" } },
						],
						color: "#000",
					},
				},
			]),
		];
		const fonts = collectFontDescriptors({ template_data: td });
		expect(fonts).toEqual([
			{
				kind: "google",
				family: "Comfortaa",
				url: googleCss2Url("Comfortaa", [400, 700], true),
			},
		]);
	});

	it("collects families inside a mask's shape and content", () => {
		const td = [
			frame("front", [
				{
					id: "m",
					type: "mask",
					pos: { x: 0, y: 0 },
					size: { width: 10, height: 10 },
					properties: {
						mask: { ...textEl("Lobster"), pos: { x: 0, y: 0 } },
						children: [
							{
								id: "f",
								type: "frame",
								properties: { children: [textEl("Comfortaa", 700)] },
							},
						],
					},
				},
			]),
		];
		const fonts = collectFontDescriptors({ template_data: td });
		expect(fonts.map((f) => f.family).sort()).toEqual(["Comfortaa", "Lobster"]);
	});

	it("declares a family only a variant uses", () => {
		const td = [frame("front", [{ ...textEl("Comfortaa"), id: "a" }])];
		const variants = [
			{
				id: "alt",
				label: "Alt",
				overrides: [
					{
						name: "front",
						elements: [
							{
								id: "a",
								properties: {
									font: { family: "Playfair Display", weight: 700 },
								},
							},
						],
					},
				],
			},
		];
		const fonts = collectFontDescriptors({ template_data: td, variants });
		expect(fonts).toContainEqual({
			kind: "google",
			family: "Playfair Display",
			url: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap",
		});
	});

	it("declares a barcode's font", () => {
		const td = [
			frame("front", [
				textEl("Comfortaa", 700),
				{ id: "b", type: "barcode", properties: { fontFamily: "Vend Sans" } },
			]),
		];
		const fonts = collectFontDescriptors({ template_data: td });
		expect(fonts.find((f) => f.family === "Vend Sans")?.url).toBe(
			googleCss2Url("Vend Sans", [400]),
		);
	});
});
