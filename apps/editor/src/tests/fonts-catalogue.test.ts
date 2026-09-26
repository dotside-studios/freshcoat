import { describe, expect, test } from "vitest";
import {
	CATEGORIES,
	filterFamilies,
	fuzzyScore,
	type GoogleFontRow,
	googleDescriptor,
	loadCatalogue,
	nearestWeight,
	previewCssUrl,
} from "~/fonts/catalogue";

const row = (f: string, extra: Partial<GoogleFontRow> = {}): GoogleFontRow => ({
	f,
	c: "sans",
	w: [400, 700],
	i: false,
	v: false,
	p: 1,
	s: ["latin"],
	...extra,
});

describe("the bundled catalogue", () => {
	test("has a date and rows of the documented shape", async () => {
		const cat = await loadCatalogue();
		expect(cat.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(cat.families.length).toBeGreaterThan(1500);
		const categories = new Set(CATEGORIES.map(([c]) => c));
		const ranks = new Set<number>();
		for (const r of cat.families) {
			expect(Object.keys(r).sort()).toEqual([
				"c",
				"f",
				"i",
				"p",
				"s",
				"v",
				"w",
			]);
			expect(typeof r.f).toBe("string");
			expect(categories.has(r.c)).toBe(true);
			expect(r.w.length).toBeGreaterThan(0);
			expect([...r.w].sort((a, b) => a - b)).toEqual(r.w);
			expect(typeof r.i).toBe("boolean");
			expect(typeof r.v).toBe("boolean");
			expect(Array.isArray(r.s)).toBe(true);
			ranks.add(r.p);
		}
		expect(ranks.size).toBe(cat.families.length);
	});

	test("lists the popular families", async () => {
		const { families } = await loadCatalogue();
		const byName = new Map(families.map((r) => [r.f, r]));
		for (const f of ["Inter", "Roboto", "Playfair Display"])
			expect(byName.get(f)?.p).toBeLessThan(100);
		expect(byName.get("Playfair Display")?.c).toBe("serif");
		expect(byName.get("Inter")?.v).toBe(true);
	});

	test("loads once", async () => {
		expect(await loadCatalogue()).toBe(await loadCatalogue());
	});
});

describe("search, filter and sort", () => {
	const rows = [
		row("Roboto", { p: 1 }),
		row("Roboto Mono", { c: "mono", p: 9 }),
		row("Playfair Display", { c: "serif", p: 20 }),
		row("Playfair", { c: "serif", p: 300 }),
		row("Poppins", { p: 5 }),
		row("Open Sans", { p: 2 }),
	];

	test("an empty query lists by popularity, or by name", () => {
		expect(filterFamilies(rows, {}).map((r) => r.f)).toEqual([
			"Roboto",
			"Open Sans",
			"Poppins",
			"Roboto Mono",
			"Playfair Display",
			"Playfair",
		]);
		expect(filterFamilies(rows, { sort: "name" }).map((r) => r.f)[0]).toBe(
			"Open Sans",
		);
	});

	test("a category narrows the list", () => {
		expect(filterFamilies(rows, { category: "serif" }).map((r) => r.f)).toEqual(
			["Playfair Display", "Playfair"],
		);
		expect(filterFamilies(rows, { category: "mono" }).map((r) => r.f)).toEqual([
			"Roboto Mono",
		]);
	});

	test("search is fuzzy, and the exact and prefix matches come first", () => {
		expect(filterFamilies(rows, { query: "playfair" }).map((r) => r.f)).toEqual(
			["Playfair", "Playfair Display"],
		);
		expect(filterFamilies(rows, { query: "pfd" }).map((r) => r.f)).toEqual([
			"Playfair Display",
		]);
		expect(filterFamilies(rows, { query: "mono" }).map((r) => r.f)).toEqual([
			"Roboto Mono",
		]);
		expect(filterFamilies(rows, { query: "zzz" })).toEqual([]);
		expect(fuzzyScore("Open Sans", "sans")).toBeGreaterThan(
			fuzzyScore("Open Sans", "osn"),
		);
	});
});

describe("descriptors", () => {
	test("weights move to the nearest the family has", () => {
		expect(nearestWeight([400, 700], 500)).toBe(400);
		expect(nearestWeight([400, 700], 600)).toBe(700);
		expect(nearestWeight([300, 500], 400)).toBe(500);
		expect(nearestWeight([400], 900)).toBe(400);
	});

	test("carry the weights in use, and italics when used and available", () => {
		const playfair = row("Playfair Display", {
			w: [400, 500, 600, 700, 800, 900],
			i: true,
		});
		expect(googleDescriptor(playfair, [700, 400, 400]).url).toBe(
			"https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap",
		);
		expect(googleDescriptor(playfair, [400], true).url).toBe(
			"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&display=swap",
		);
		expect(googleDescriptor(row("Lobster", { w: [400] }), [400, 700])).toEqual({
			kind: "google",
			family: "Lobster",
			url: "https://fonts.googleapis.com/css2?family=Lobster:wght@400&display=swap",
		});
	});

	test("a preview asks only for the glyphs of the name", () => {
		expect(previewCssUrl("Playfair Display")).toBe(
			"https://fonts.googleapis.com/css2?family=Playfair+Display&text=Playfair%20Display",
		);
	});
});
