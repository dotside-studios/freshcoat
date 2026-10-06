import { describe, expect, it } from "vitest";
import {
	collectFontDescriptors,
	googleCss2Url,
} from "~/lib/figma/transpiler/fonts";

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

describe("googleCss2Url", () => {
	it("builds a css2 url with sorted weights", () => {
		expect(googleCss2Url("Open Sans", [700, 400], false)).toBe(
			"https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap",
		);
	});
	it("adds the ital axis when italic is used", () => {
		expect(googleCss2Url("Inter", [400], true)).toBe(
			"https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,400&display=swap",
		);
	});
});

describe("collectFontDescriptors", () => {
	it("emits google descriptors for all non-system families", () => {
		const td = [
			frame("front", [
				textEl("Comfortaa", 700),
				textEl("Inter", 400, "italic"),
			]),
		];
		const fonts = collectFontDescriptors(td);
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
		const fonts = collectFontDescriptors(td);
		// Arial is a system font — filtered out. Comfortaa is declared as Google.
		expect(fonts.map((f) => f.family)).toEqual(["Comfortaa"]);
		expect(fonts[0]).toMatchObject({ kind: "google", family: "Comfortaa" });
	});

	it("treats non-system custom fonts (e.g. Proxima Nova) as Google — no warning", () => {
		const td = [
			frame("front", [textEl("Comfortaa", 700), textEl("Proxima Nova", 400)]),
		];
		const fonts = collectFontDescriptors(td);
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
		const fonts = collectFontDescriptors(td);
		expect(fonts.map((f) => f.family).sort()).toEqual(["Comfortaa", "Poppins"]);
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
		const fonts = collectFontDescriptors(td);
		expect(fonts.map((f) => f.family).sort()).toEqual(["Comfortaa", "Lobster"]);
	});
});
