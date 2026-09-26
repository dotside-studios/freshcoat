/**
 * Writes src/fonts/google-fonts.json, the Google Fonts catalogue the font
 * picker lists, from the metadata fonts.google.com serves its own site with.
 * That endpoint needs no key but refuses browser requests, which is why the
 * catalogue is a committed snapshot rather than a fetch.
 *
 *   bun run fonts:update
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "https://fonts.google.com/metadata/fonts";
const OUT = join(import.meta.dir, "../src/fonts/google-fonts.json");

const CATEGORY: Record<string, string> = {
	"Sans Serif": "sans",
	Serif: "serif",
	Display: "display",
	Handwriting: "handwriting",
	Monospace: "mono",
};

type Family = {
	family: string;
	category: string;
	fonts: Record<string, unknown>;
	axes?: { tag: string }[];
	popularity: number;
	subsets?: string[];
};

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE} answered ${res.status}`);
// The endpoint has served its JSON behind an XSSI guard; drop it if present.
const text = (await res.text()).replace(/^\)\]\}'\s*/, "");
const list = (JSON.parse(text) as { familyMetadataList: Family[] })
	.familyMetadataList;

const families = list
	.map((f) => {
		const styles = Object.keys(f.fonts);
		const weights = [
			...new Set(styles.map((s) => Number.parseInt(s, 10))),
		].filter(Number.isFinite);
		return {
			f: f.family,
			c: CATEGORY[f.category] ?? "display",
			w: weights.sort((a, b) => a - b),
			i: styles.some((s) => s.endsWith("i")),
			v: (f.axes ?? []).length > 0,
			p: f.popularity,
			s: (f.subsets ?? []).filter((s) => s !== "menu"),
		};
	})
	.filter((f) => f.w.length > 0)
	.sort((a, b) => a.p - b.p || a.f.localeCompare(b.f));

// Ranks from 1, in case the source's popularity numbers have gaps.
families.forEach((f, i) => {
	f.p = i + 1;
});

const generatedAt = new Date().toISOString().slice(0, 10);
// One family a line keeps the diff of an update readable.
const body = families.map((f) => `\t\t${JSON.stringify(f)}`).join(",\n");
writeFileSync(
	OUT,
	`{\n\t"generatedAt": "${generatedAt}",\n\t"families": [\n${body}\n\t]\n}\n`,
);
console.log(`${families.length} families written to ${OUT}`);
